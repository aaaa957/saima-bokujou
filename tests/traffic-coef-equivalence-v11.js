// 验证「移除 trafficProgressCache」这一改动：
//   ① 逐位等价 —— 与改动前的引擎（HEAD 的 sim.js）跑完整比赛比对全场状态摘要
//   ② 性能 —— 同场次的 CPU 对比
// 只读：改动前的源码取自 git，写到临时文件，不改仓库。
//
// 用法：node tests/traffic-coef-equivalence-v11.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const root = path.join(__dirname, '..');

// 改动前的引擎（HEAD 里那一版，仍带缓存）
const before = execSync('git show HEAD:sim.js', { cwd: root }).toString();
const fBefore = path.join(os.tmpdir(), 'sim_before_tpc.js');
fs.writeFileSync(fBefore, before);

const DT = 1 / 30;
const mk = i => {
  const h = S.makeHorse(() => 0.5, { id: 'h' + i, level: 86, surface: '草地', special: '左右皆可', jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(), behavior: { forwardness: .4 + (i % 3) * .2, settle: .6, tractability: .7 }, racePlan: { position: .4 + (i % 3) * .2, risk: .5, patience: .6 } });
  for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
  return h;
};
let S;
function run(mod, n, len) {
  delete require.cache[require.resolve(mod)];
  S = require(mod);
  const r = S.createRace(Array.from({ length: n }, (_, i) => mk(i)), { length: len, profile: '平坦', rng: S.mulberry32(7) });
  const c0 = process.cpuUsage();
  let g = 0;
  while (!r.race.finished && g++ < 400000) r.step(DT);
  const c = process.cpuUsage(c0);
  const cpuSec = (c.user + c.system) / 1e6;         // 微秒 → 秒
  const rows = r.race.horses.map(h => ({ id: h.id, t: +h.time.toFixed(9), place: h.place, st: +h.stamina.toFixed(9), work: +h.statsSummary.workUsed.toFixed(9) }));
  const dig = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  return { cpuSec, dig, raceT: r.race.t };
}

const cases = [[8, 1200], [8, 2000], [16, 2400]];
console.log('=== 逐位等价 + 性能（移除 trafficProgressCache）===');
console.log('');
console.log('场次             改前CPU   改后CPU   加速     改前摘要         改后摘要         等价');
let totB = 0, totA = 0;
for (const [n, len] of cases) {
  const a = run(fBefore, n, len);          // before
  const b = run(path.join(root, 'sim.js'), n, len);  // after
  totB += a.cpuSec; totA += b.cpuSec;
  const eq = a.dig === b.dig;
  console.log(
    (n + '匹 @' + len + 'm').padEnd(16) +
    a.cpuSec.toFixed(2).padStart(8) + 's' + b.cpuSec.toFixed(2).padStart(9) + 's' +
    (a.cpuSec / b.cpuSec).toFixed(3).padStart(8) + '×  ' +
    a.dig.padEnd(16) + b.dig.padEnd(16) + (eq ? '✅ 相同' : '❌ 不同'));
  if (!eq) {
    console.log('   ⚠️ 摘要不同 —— 逐马对比：');
    console.log('   改前: ' + JSON.stringify(run(fBefore, n, len)));
    console.log('   改后: ' + JSON.stringify(run(path.join(root, 'sim.js'), n, len)));
  }
}
console.log('');
console.log('合计 CPU：改前 ' + totB.toFixed(1) + 's → 改后 ' + totA.toFixed(1) + 's   （' + (totB / totA).toFixed(3) + '×）');
