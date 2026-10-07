// 可信的 A/B 计时器（P0 修测量器）。
//
// 为什么需要它：现有规程（独立进程 + 批内预热取最小）只解决了「同一进程内后测者更慢」
// 这个**位置偏差**，没解决**环境漂移**。实测同一份 base.js 跨批次测得 9.78→12.078s（±12%）；
// 2026-10-07 早上更差：绝对耗时从 10.2s 涨到 16–21s，同一份代码的单对摆幅达 ±35%。
//
// 诊断出的环境干扰源（2026-10-07 实测）：
//   ① **电源方案 = 平衡** ⇒ CPU 随时降频。CPU 时间与频率成反比，降频是**一阶误差**，
//      配对无法抵消（频率漂移的时间尺度就是几十秒）。
//   ② **Windows Defender(MsMpEng) 实时扫描**（累计 CPU 710s，全机第一）⇒ 间歇性抢占，
//      表现为「偶发 35% 偏慢」。
//   ③ 其他常驻进程（WorkBuddy ×4、CCleaner 等）⇒ 超线程争用同样会推高进程 CPU 时间。
//
// 本工具的对抗手段（四件一起用）：
//   ① **配对相邻 + 顺序交替** ⇒ 抵消缓慢漂移与位置偏差
//   ② **环境速度探针归一化**（核心）：每次测量**前后各跑一段固定 CPU 负载**，
//      用 引擎耗时/探针耗时 把「当前机器跑多快」这个因子约掉
//      —— 这是对「降频 + 争用」这类乘性干扰的直接消解
//   ③ **取比值中位数** ⇒ 抗离群
//   ④ **开工前 A-vs-A 自检** ⇒ 门槛：比值中位数 ∈ [0.98, 1.02]
//
// 用法：
//   node [--expose-gc] tests/perf-ab-paired-v11.js <A> <B> <pairs> <steps> <horses> <length> <course> [warmup] [mode]
//     course 用 '-' 表示抽象场地（无 route）
//     mode: same（默认）| refresh（每次测量新实例）| proc（每次测量起独立进程）
// 例：
//   node --expose-gc tests/perf-ab-paired-v11.js .perf/base.js .perf/base.js 10 800 12 2400 京都芝外A 400
'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const [fileA, fileB, pairsArg, stepsArg, horsesArg, lengthArg, courseArg, warmupArg, modeArg] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('用法: node --expose-gc tests/perf-ab-paired-v11.js <A> <B> <pairs> <steps> <horses> <length> <course> [warmup] [same|refresh|proc]');
  process.exit(1);
}
const PAIRS = Number(pairsArg || 10);
const STEPS = Number(stepsArg || 800);
const HORSES = Number(horsesArg || 12);
const LEN = Number(lengthArg || 2400);
const COURSE = courseArg === '-' ? '' : (courseArg || '');
const WARMUP = Number(warmupArg || 400);
const MODE = modeArg || (process.env.AB_MODE || 'same');

const root = path.join(__dirname, '..');
const abs = f => (path.isAbsolute(f) ? f : path.join(root, f));
const ONE = path.join(__dirname, 'perf-ab-one-v11.js');

// ---------------- 环境速度探针 ----------------
// 固定 CPU 密集任务，无副作用、不可被消除（结果参与校验和）。
// 目标时长 ~1.0s：足够采样当前环境，又不至于占太多墙钟。
let REF_ITERS = 0;
function refOnce(iters) {
  const c0 = process.cpuUsage();
  let x = 0.1;
  for (let i = 0; i < iters; i++) x = Math.sqrt(x * 1.000001 + 1.234567) % 7.0;
  const c = process.cpuUsage(c0);
  return { sec: (c.user + c.system) / 1e6, x };
}
function calibrateRef(targetSec) {
  // 有界搜索：先**倍增**找到超过目标的规模，再**二分**收敛。
  // ⚠️ 教训：初版用「按比例放大」且把系数钳在 ≥1.15 ⇒ 一旦超出目标就**只能继续增大**，
  //    最终跑到上百亿次迭代（表现为进程像卡死）。故这里对探针次数封顶。
  let lo = 100000, hi = lo, best = refOnce(lo), steps = 1;
  while (best.sec < targetSec && steps < 16 && hi < 4e9) { lo = hi; hi = hi * 2; best = refOnce(hi); steps++; }
  for (let k = 0; k < 20 && Math.abs(best.sec - targetSec) / targetSec > 0.08; k++) {
    const mid = Math.round((lo + hi) / 2);
    if (mid <= lo || mid >= hi) break;
    const r = refOnce(mid);
    if (r.sec < targetSec) lo = mid; else hi = mid;
    best = r;
  }
  REF_ITERS = Math.max(10000, Math.round((lo + hi) / 2));
  return best.sec;
}

// ---------------- 引擎装载与测量 ----------------
function mkHorses(S, n) {
  return Array.from({ length: n }, (_, i) => {
    const h = S.makeHorse(() => 0.5, {
      id: 'h' + i, level: 86, surface: '草地', special: '左右皆可', jockeyGrade: '优秀',
      '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(),
      behavior: { forwardness: .4 + (i % 3) * .2, settle: .6, tractability: .7 },
      racePlan: { position: .4 + (i % 3) * .2, risk: .5, patience: .6 },
    });
    for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
    return h;
  });
}
const digestOf = rc => crypto.createHash('sha256')
  .update(JSON.stringify(rc.race.horses.map(h => [+h.s.toFixed(9), +h.v.toFixed(9), +h.t.toFixed(9), +h.stamina.toFixed(9)])))
  .digest('hex').slice(0, 16);

function loadEngine(file) {
  const mod = abs(file);
  delete require.cache[require.resolve(mod)];   // 强制取得一份新的模块实例
  return require(mod);
}
const optsFor = S => { const o = { length: LEN, rng: S.mulberry32(7) }; if (COURSE) o.course = COURSE; else o.profile = '平坦'; return o; };
const warmEngine = S => { const rc = S.createRace(mkHorses(S, HORSES), optsFor(S)); for (let i = 0; i < WARMUP; i++) rc.step(1 / 30); };
function engineOnce(S) {
  const rc = S.createRace(mkHorses(S, HORSES), optsFor(S));
  if (global.gc) global.gc();
  const c0 = process.cpuUsage();
  for (let i = 0; i < STEPS; i++) rc.step(1 / 30);
  const c = process.cpuUsage(c0);
  return { cpu: (c.user + c.system) / 1e6, digest: digestOf(rc) };
}
// 带环境探针的测量：ref → 引擎 → ref，用前后探针均值归一化
function measureWithProbe(S) {
  const r0 = refOnce(REF_ITERS);
  const e = engineOnce(S);
  const r1 = refOnce(REF_ITERS);
  const refAvg = (r0.sec + r1.sec) / 2;
  return { cpu: e.cpu, digest: e.digest, ref: refAvg, norm: e.cpu / refAvg };
}
function makeMeasureInProcess(S) { return () => measureWithProbe(S); }
function makeMeasureRefresh(file) {
  return () => { const S = loadEngine(file); warmEngine(S); return measureWithProbe(S); };
}
function makeMeasureSubprocess(file) {
  const target = abs(file);
  return () => {
    // 子进程模式：探针在子进程内测不了（跨进程），故只报原始 CPU。
    // 为公平，子进程模式也插入一段同等时长的空转？——不做，直接报原始值并标注。
    const args = [ONE, target, String(STEPS), String(HORSES), String(LEN), COURSE || '-', '1', String(WARMUP)];
    const r = spawnSync(process.execPath, ['--expose-gc', ...args], { encoding: 'utf8', timeout: 3600000 });
    if (r.status !== 0) throw new Error('子进程失败: ' + (r.stderr || '').slice(0, 400));
    const m = /CPU ([\d.]+) DIGEST (\w+)/.exec(r.stdout || '');
    if (!m) throw new Error('子进程输出异常: ' + (r.stdout || '').slice(0, 200));
    const cpu = Number(m[1]);
    return { cpu, digest: m[2], ref: NaN, norm: cpu };
  };
}

let msrA, msrB;
if (MODE === 'same') {
  const A = loadEngine(fileA), B = loadEngine(fileB);
  warmEngine(A); warmEngine(B);
  msrA = makeMeasureInProcess(A); msrB = makeMeasureInProcess(B);
} else if (MODE === 'refresh') {
  msrA = makeMeasureRefresh(fileA); msrB = makeMeasureRefresh(fileB);
} else if (MODE !== 'chunk') {
  msrA = makeMeasureSubprocess(fileA); msrB = makeMeasureSubprocess(fileB);
}

const refSec = MODE === 'chunk' ? NaN : calibrateRef(0.6);

// ---------------- chunk 模式：细粒度乒乓交替 ----------------
// 成对测量要跨 18–34 秒，而环境噪声在**秒级**尺度上就在变（探针自身离散度 18%）
// ⇒ 一对之内 A 与 B 处在不同的环境里。改为把总步数切成许多小块、A/B 逐块交替，
// 使环境波动成为两者的**共模**：块越细、块数越多，抵消越彻底。
// 两个变体各自维护一条**推进中的比赛**（同种子 ⇒ 每一块的步进量完全相同），
// 故块时间的总和可直接比较。
function runChunkMode() {
  const A = loadEngine(fileA), B = loadEngine(fileB);
  const CHUNK = Math.max(1, Math.round(STEPS / PAIRS));
  const ROUNDS = PAIRS;
  const SETTLE = Number(process.env.SETTLE || 3);   // 测量前的「安定轮」：丢弃，不计入
  const rcA = A.createRace(mkHorses(A, HORSES), optsFor(A));
  const rcB = B.createRace(mkHorses(B, HORSES), optsFor(B));
  // 预热：两条比赛各推进同样步数（同种子 ⇒ 状态一致）
  for (let i = 0; i < WARMUP; i++) { rcA.step(1 / 30); rcB.step(1 / 30); }

  console.log(`A = ${fileA}`);
  console.log(`B = ${fileB}`);
  console.log(`场次 ${HORSES}匹 @${LEN}m ${COURSE || '抽象'}  总步数 ${STEPS}（每块 ${CHUNK} 步 × ${ROUNDS} 轮）  预热 ${WARMUP}  安定 ${SETTLE} 轮  模式=chunk`);
  console.log('');

  // 一块：先强制 GC（两侧对称，消除「GC 偶然落在谁身上」的噪声），再计时。
  //
  // ⚠️ 同时记两种口径，这是 2026-10-07 的关键诊断：
  //   · cpu  = process.cpuUsage() —— 记的是**整个进程**的 CPU 时间，
  //            因此会把 V8 **后台线程**（并发标记 GC、并发优化编译）的时间算进来。
  //            这些线程是突发的、且 A/B 之间相关 ⇒ 单块比值曾出现 [0.23, 3.5] 的±100% 噪声。
  //   · wall = hrtime 墙钟 —— 只反映主线程的实际推进速度，不含后台线程 CPU，
  //            但含被抢占/等待的时间。
  //   两者对比即可判定噪声来源：若 wall 明显更稳 ⇒ 元凶是后台线程 CPU 记账。
  const runChunk = rc => {
    if (global.gc) global.gc();
    const w0 = process.hrtime.bigint();
    const c0 = process.cpuUsage();
    for (let i = 0; i < CHUNK; i++) rc.step(1 / 30);
    const c = process.cpuUsage(c0);
    const w = Number(process.hrtime.bigint() - w0) / 1e9;
    return { cpu: (c.user + c.system) / 1e6, wall: w };
  };
  const rec = (acc, x) => { acc.cpu += x.cpu; acc.wall += x.wall; };

  // ⭐ 安定轮（关键）：V8 的优化编译在**后台线程**进行，第二个加载的实例里
  //    部分热函数可能在测量期间才完成优化（此前跑在解释器/基线版上），
  //    这会同时造成**偏慢**与**巨大波动**。先跑几轮丢弃，让两份实例都充分优化。
  for (let r = 0; r < SETTLE; r++) {
    if (r % 2 === 0) { runChunk(rcA); runChunk(rcB); } else { runChunk(rcB); runChunk(rcA); }
  }

  console.log(' 轮  顺序     A块CPU   B块CPU   块比CPU    A块墙钟  B块墙钟  块比墙钟  累CPU比  累墙钟比');
  let cA = 0, cB = 0, wA = 0, wB = 0;
  const rCpu = [], rWall = [], aCpu = [], bCpu = [], aWall = [], bWall = [];
  for (let r = 0; r < ROUNDS; r++) {
    const order = r % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
    let ta = null, tb = null;
    for (const which of order) {
      const x = runChunk(which === 'A' ? rcA : rcB);
      if (which === 'A') ta = x; else tb = x;
    }
    cA += ta.cpu; cB += tb.cpu; wA += ta.wall; wB += tb.wall;
    rCpu.push(tb.cpu / ta.cpu); rWall.push(tb.wall / ta.wall);
    aCpu.push(ta.cpu); bCpu.push(tb.cpu); aWall.push(ta.wall); bWall.push(tb.wall);
    console.log(`${String(r + 1).padStart(3)}  ${(r % 2 === 0 ? 'A,B' : 'B,A').padEnd(6)}` +
      `${ta.cpu.toFixed(3).padStart(9)}${tb.cpu.toFixed(3).padStart(9)}${(tb.cpu / ta.cpu).toFixed(4).padStart(10)}` +
      `${ta.wall.toFixed(3).padStart(11)}${tb.wall.toFixed(3).padStart(9)}${(tb.wall / ta.wall).toFixed(4).padStart(10)}` +
      `${(cB / cA).toFixed(4).padStart(9)}${(wB / wA).toFixed(4).padStart(10)}`);
  }
  const digA = digestOf(rcA), digB = digestOf(rcB);
  const med = arr => { const s = [...arr].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const mn = arr => Math.min(...arr), mx = arr => Math.max(...arr), mean = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
  const rC = cB / cA, rW = wB / wA;
  console.log('');
  console.log('--- 汇总 ----------------------------------------------------');
  console.log(`累计比 B/A（CPU 口径）= ${rC.toFixed(4)}    [A ${cA.toFixed(2)}s  B ${cB.toFixed(2)}s]`);
  console.log(`累计比 B/A（墙钟口径）= ${rW.toFixed(4)}    [A ${wA.toFixed(2)}s  B ${wB.toFixed(2)}s]`);
  console.log(`块比中位数：CPU ${med(rCpu).toFixed(4)}（范围 [${mn(rCpu).toFixed(4)}, ${mx(rCpu).toFixed(4)}]）`);
  console.log(`            墙钟 ${med(rWall).toFixed(4)}（范围 [${mn(rWall).toFixed(4)}, ${mx(rWall).toFixed(4)}]）`);
  console.log(`A 块均值：CPU ${mean(aCpu).toFixed(3)} 墙钟 ${mean(aWall).toFixed(3)}    B 块均值：CPU ${mean(bCpu).toFixed(3)} 墙钟 ${mean(bWall).toFixed(3)}`);
  console.log(`摘要：A=${digA} B=${digB} ${digA === digB ? '✅ 相同' : '❌ 不同（比较无效）'}`);
  const okC = rC >= 0.98 && rC <= 1.02, okW = rW >= 0.98 && rW <= 1.02;
  console.log('');
  console.log(`判定：CPU 口径 ${rC.toFixed(4)} ${okC ? '∈' : '∉'} [0.98, 1.02]　墙钟口径 ${rW.toFixed(4)} ${okW ? '∈' : '∉'} [0.98, 1.02]`);
  console.log(`      ⇒ ${okC && okW ? '✅ 两种口径下 A 与 B 均不可分辨' : (okW && !okC ? '⚠️ 仅墙钟达标 ⇒ CPU 口径的噪声来自后台线程记账' : '❌ 至少一种口径未达标')}`);
  if (!okC && !okW) printSuggestions();
  return;
}

function printSuggestions() {
  console.log('');
  console.log('建议（按有效性排序）：');
  console.log('  1) 把电源方案从「平衡」改为「高性能」—— 消除 CPU 降频（一阶误差源）');
  console.log('  2) 给项目目录与 node.exe 加 Windows Defender 排除项 —— 消除实时扫描抢占');
  console.log('  3) 关掉其它常驻负载（多余的 WorkBuddy 窗口、CCleaner 等）');
  console.log('  4) 加大轮数或加长窗口（中位数误差 ~1/√n）');
}

if (MODE === 'chunk') { runChunkMode(); process.exit(0); }

