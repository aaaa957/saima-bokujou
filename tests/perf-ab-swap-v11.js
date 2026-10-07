// 换序配对判定器（P0 修测量器 · 第二步）。
//
// 解决什么问题：perf-ab-paired-v11.js 的 chunk 模式把 A-vs-A 的摆幅从 ±15% 压到 ±6.8%，
// 但**仍未达标**（目标 ±2%），且 4 次自检里有 3 次出现「第二个加载的实例更快」的迹象。
// 若这种「槽位不对称」（第一个加载 vs 第二个加载）是**常数**，则可以用**换序**把它消掉：
//
//   设槽位偏差系数 m（对第二个加载者统一作用），两个引擎的真实成本因子为 f_A、f_B：
//     正常顺序（A 先加载）测得   r₁ = m · f_B / f_A
//     交换顺序（B 先加载）测得   r₂ = m · f_A / f_B
//   ⇒ 目标效果  f_B / f_A = √(r₁ / r₂)      ← m 被完全消掉
//   ⇒ 偏差诊断  m = √(r₁ · r₂)              ← 应≈1；若显著偏离 1 说明槽位偏差真实存在
//
// 该推导对 m 的**成因**不作假设（JIT 后台编译、代码缓存、槽位缓存局部性…皆可），
// 只要它在两次运行之间是稳定的。
//
// 用法：
//   node tests/perf-ab-swap-v11.js <A> <B> <pairs> <steps> <horses> <length> <course> [warmup] [repeats]
//     course 用 '-' 表示抽象场地
//     repeats：每个顺序重复几次（默认 1）。>1 时给出「顺序内离散度」，用于评估随机噪声。
// 例：
//   node tests/perf-ab-swap-v11.js .perf/base.js .perf/base.js 24 600 12 2400 京都芝外A 400 2
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [fileA, fileB, pairsArg, stepsArg, horsesArg, lengthArg, courseArg, warmupArg, repsArg] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('用法: node tests/perf-ab-swap-v11.js <A> <B> <pairs> <steps> <horses> <length> <course> [warmup] [repeats]');
  process.exit(1);
}
const PAIRS = pairsArg || '24';
const STEPS = stepsArg || '600';
const HORSES = horsesArg || '12';
const LEN = lengthArg || '2400';
const COURSE = courseArg || '-';
const WARMUP = warmupArg || '400';
const REPS = Number(repsArg || 1);

const root = path.join(__dirname, '..');
const abs = f => (path.isAbsolute(f) ? f : path.join(root, f));
const TOOL = path.join(__dirname, 'perf-ab-paired-v11.js');
const courseName = COURSE === '-' ? '抽象' : COURSE;

function runOrder(first, second) {
  const args = ['--expose-gc', TOOL, abs(first), abs(second), PAIRS, STEPS, HORSES, LEN, COURSE, WARMUP, 'chunk'];
  // 单次运行约 1–3 分钟，给足超时
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 7200000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`子进程失败（${path.basename(first)} vs ${path.basename(second)}）:\n` + (r.stderr || '').slice(0, 1200));
  const out = r.stdout || '';
  const mC = /累计比 B\/A（CPU 口径）= ([\d.]+)/.exec(out);
  const mW = /累计比 B\/A（墙钟口径）= ([\d.]+)/.exec(out);
  const d = /摘要：A=(\w+) B=(\w+) (✅ 相同|❌ 不同[^\n]*)/.exec(out);
  if (!mC || !mW) throw new Error('未找到「累计比」两行。输出片段:\n' + out.slice(-1500));
  const tot = /\[A ([\d.]+)s  B ([\d.]+)s\]/.exec(out);
  return {
    cpu: Number(mC[1]), wall: Number(mW[1]),
    digA: d ? d[1] : '?', digB: d ? d[2] : '?',
    same: d ? d[3].startsWith('✅') : null,
    totals: tot ? `${tot[1]}/${tot[2]}` : '?',
  };
}

const med = arr => { const s = [...arr].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const spread = arr => (Math.max(...arr) - Math.min(...arr)) / (arr.reduce((s, x) => s + x, 0) / arr.length);

console.log('='.repeat(74));
console.log('换序配对判定器');
console.log(`  A = ${fileA}`);
console.log(`  B = ${fileB}`);
console.log(`  场次 ${HORSES}匹 @${LEN}m ${courseName}  每序 ${PAIRS} 轮 × ${STEPS} 步（每块 ${Math.max(1, Math.round(Number(STEPS) / Number(PAIRS)))} 步）  预热 ${WARMUP}  每序重复 ${REPS} 次`);
console.log('='.repeat(74));

const r1s = [], r1c = [], r2s = [], r2c = [];
for (let i = 0; i < REPS; i++) {
  process.stdout.write(`\n[1/2] 正常顺序（A 先加载）第 ${i + 1}/${REPS} 次 … `);
  const x = runOrder(fileA, fileB);
  r1s.push(x.wall); r1c.push(x.cpu);
  console.log(`墙钟 r₁ = ${x.wall.toFixed(4)}   CPU ${x.cpu.toFixed(4)}   (A/B 总时 ${x.totals}s)`);
  process.stdout.write(`[2/2] 交换顺序（B 先加载）第 ${i + 1}/${REPS} 次 … `);
  const y = runOrder(fileB, fileA);
  r2s.push(y.wall); r2c.push(y.cpu);
  console.log(`墙钟 r₂ = ${y.wall.toFixed(4)}   CPU ${y.cpu.toFixed(4)}   (A/B 总时 ${y.totals}s)`);
  if (x.same === false || y.same === false) console.log('  ⚠️ 摘要不同 —— 两个引擎行为不等价，比较无意义');
}

const r1 = med(r1s), r2 = med(r2s);
const effect = Math.sqrt(r1 / r2);      // f_B / f_A（墙钟口径，主判据）
const slotBias = Math.sqrt(r1 * r2);    // m
const r1cM = med(r1c), r2cM = med(r2c);
const effectCpu = Math.sqrt(r1cM / r2cM);

console.log('');
console.log('--- 结果 ---------------------------------------------------------');
console.log(`r₁（正常顺序，墙钟）= ${r1s.map(v => v.toFixed(4)).join(', ')}   中位数 ${r1.toFixed(4)}`);
console.log(`r₂（交换顺序，墙钟）= ${r2s.map(v => v.toFixed(4)).join(', ')}   中位数 ${r2.toFixed(4)}`);
if (REPS > 1) {
  console.log(`顺序内离散度：r₁ ${(100 * spread(r1s)).toFixed(1)}%   r₂ ${(100 * spread(r2s)).toFixed(1)}%   ← 装置的本底噪声`);
}
console.log('');
console.log(`⭐ 效果 f_B/f_A = √(r₁/r₂) = ${effect.toFixed(4)}   （墙钟口径，主判据）`);
console.log(`   即 B 相对 A ${effect < 1 ? '快' : '慢'} ${(100 * Math.abs(1 - effect)).toFixed(1)}%`);
console.log(`   CPU 口径参考值 = ${effectCpu.toFixed(4)}（${effectCpu < 1 ? '快' : '慢'} ${(100 * Math.abs(1 - effectCpu)).toFixed(1)}%）—— 噪声更大，仅作对照`);
console.log(`   槽位偏差诊断 m = √(r₁·r₂) = ${slotBias.toFixed(4)}   ${Math.abs(slotBias - 1) < 0.02 ? '（≈1，无明显槽位偏差）' : '（显著偏离 1 ⇒ 槽位不对称真实存在，已被换序消除）'}`);
console.log('');
const same = Math.abs(effect - 1) < 0.02;
if (same) {
  console.log('判定：A 与 B 不可分辨（|效果−1| < 2%）—— 若这是 A-vs-A 自检，说明 ✅ 装置可用；');
  console.log('      若这是真实候选，说明该候选在本机不可判定（需要更长的窗口）。');
} else {
  console.log(`判定：可分辨出 ${(100 * Math.abs(1 - effect)).toFixed(1)}% 的差异。`);
  console.log(`      门槛参考：≥10% 可信；3–10% 需看「顺序内离散度」是否足够小；<3% 不要下结论。`);
}
console.log('');
console.log('（每序的单次运行内 A/B 摘要必须相同，否则以上全部无效。）');
