// 单个引擎副本的计时子进程（由 tests/perf-ab-v11.js 调用）。
// 每次只加载一个引擎，避免同进程内多个副本互相污染堆与 JIT 状态。
//
// 实测教训（务必保留）：
//  1) 在同一进程里连续 require 多个引擎副本时，测得 CPU 会**随副本位置单调变慢**，
//     完全是工具伪影。
//  2) 但即使改为独立进程，若测量窗口太短（如 300 步 ≈ 1.7s CPU），测到的其实是
//     JIT 预热方差：同一变体在两次运行里可以差 ±20%（p1b 曾读到 0.693× 与 1.123×）。
//     故这里先用 warmup 步把 JIT 跑热、再强制 GC，然后才测量，且测量窗口放长。
//
// 用法：node [--expose-gc] tests/perf-ab-one-v11.js <file> <steps> <horses> <length> <course> <reps> [warmup]
// 输出：单行  CPU <秒>  DIGEST <摘要>  RACE_T <秒>
'use strict';
const path = require('node:path'), crypto = require('node:crypto');

const [file, stepsArg, horsesArg, lengthArg, courseArg, repsArg, warmupArg] = process.argv.slice(2);
const steps = Number(stepsArg), horses = Number(horsesArg), length = Number(lengthArg);
const course = courseArg === '-' ? '' : courseArg;
const reps = Number(repsArg || 3);
const warmup = Number(warmupArg || 0);

const root = path.join(__dirname, '..');
const mod = path.isAbsolute(file) ? file : path.join(root, file);
const S = require(mod);

function mk(i) {
  const h = S.makeHorse(() => 0.5, {
    id: 'h' + i, level: 86, surface: '草地', special: '左右皆可', jockeyGrade: '优秀',
    '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(),
    behavior: { forwardness: .4 + (i % 3) * .2, settle: .6, tractability: .7 },
    racePlan: { position: .4 + (i % 3) * .2, risk: .5, patience: .6 },
  });
  for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
  return h;
}
function makeRace() {
  const opts = { length, rng: S.mulberry32(7) };
  if (course) opts.course = course; else opts.profile = '平坦';
  return S.createRace(Array.from({ length: horses }, (_, i) => mk(i)), opts);
}

// 预热：把 JIT 与堆推到稳态，测量阶段才代表真实性能。
if (warmup > 0) {
  const w = makeRace();
  for (let i = 0; i < warmup; i++) w.step(1 / 30);
}

let best = Infinity, first = null, raceT = null;
for (let r = 0; r < reps; r++) {
  if (global.gc) global.gc();
  const rc = makeRace();
  const c0 = process.cpuUsage();
  if (steps > 0) {
    for (let i = 0; i < steps; i++) rc.step(1 / 30);
  } else {
    // steps=0：跑到终点。摘要取「完整比赛结果」，这是最强的逐位等价检查。
    let g = 0;
    while (!rc.race.finished && g++ < 400000) rc.step(1 / 30);
  }
  const c = process.cpuUsage(c0);
  const sec = (c.user + c.system) / 1e6;
  if (sec < best) best = sec;
  if (!r) {
    first = steps > 0
      ? rc.race.horses.map(h => [+h.s.toFixed(9), +h.v.toFixed(9), +h.t.toFixed(9), +h.stamina.toFixed(9)])
      : rc.race.horses.map(h => [h.id, +h.time.toFixed(9), h.place, +h.stamina.toFixed(9), +h.statsSummary.workUsed.toFixed(9)]);
    raceT = rc.race.t;
  }
}
const digest = crypto.createHash('sha256').update(JSON.stringify(first)).digest('hex').slice(0, 16);
process.stdout.write(`CPU ${best.toFixed(3)} DIGEST ${digest} RACE_T ${raceT.toFixed(6)}\n`);
