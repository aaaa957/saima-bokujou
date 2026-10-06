// 性能改动单变量 A/B：在**独立进程**中分别加载每个引擎副本并计时，消除同进程内的
// 堆/JIT 干扰。实测教训：在同一进程里连续 require 多个引擎副本时，测得 CPU 会
// **随副本在列表中的位置单调变慢**（1.14s → 1.94s），完全是工具伪影，
// 会把真实收益读成负收益，也会把负收益读成收益。
//
// 用法：node tests/perf-ab-v11.js <steps> <horses> <length> <course> <file1> <file2> ...
//   例：node tests/perf-ab-v11.js 300 12 2400 京都芝外A .perf/base.js .perf/p1b.js sim.js
// 环境变量：REPS=3（每个副本的轮数，取最小 CPU）
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const steps = process.argv[2] || '300';
const horses = process.argv[3] || '12';
const length = process.argv[4] || '2400';
const course = process.argv[5] || '';
const files = process.argv.slice(6);
if (!files.length) {
  console.error('用法: node tests/perf-ab-v11.js <steps> <horses> <length> <course> <file...>');
  process.exit(1);
}
const reps = process.env.REPS || '3';
const warmup = process.env.WARMUP || '400';
const one = path.join(__dirname, 'perf-ab-one-v11.js');

console.log(`场次 ${horses}匹 @${length}m ${course || '抽象'}  步数 ${steps}  预热 ${warmup} 步  每副本 ${reps} 轮取最小（独立进程 + 强制 GC）`);
console.log('');
console.log('引擎文件'.padEnd(28) + 'CPU(秒)'.padStart(9) + '相对'.padStart(9) + '   摘要            等价');

const results = [];
for (const f of files) {
  const r = spawnSync(process.execPath, ['--expose-gc', one, f, steps, horses, length, course || '-', reps, warmup],
    { encoding: 'utf8', timeout: 3600000 });
  if (r.status !== 0) { console.log(f.padEnd(28) + '  运行失败\n' + (r.stderr || '').slice(0, 800)); continue; }
  const m = /CPU ([\d.]+) DIGEST (\w+) RACE_T ([\d.]+)/.exec(r.stdout || '');
  if (!m) { console.log(f.padEnd(28) + '  输出异常: ' + (r.stdout || '').slice(0, 200)); continue; }
  results.push({ f, cpu: Number(m[1]), digest: m[2], raceT: Number(m[3]) });
}

if (results.length) {
  const base = results[0];
  for (const r of results) {
    console.log(
      r.f.padEnd(28) + r.cpu.toFixed(2).padStart(9) +
      (r.cpu / base.cpu).toFixed(3).padStart(8) + '×  ' + r.digest.padEnd(16) +
      (r.digest === base.digest ? '✅ 相同' : '❌ 不同'));
  }
}
