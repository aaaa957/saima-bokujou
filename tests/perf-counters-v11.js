// 计时 + 打印引擎内部计数器（计数器需由 tests/perf-instrument-v11.py 注入到引擎副本）。
// 用于回答「某处缓存命中率多少、某函数被调多少次」这类结构性问题 ——
// 这类问题靠 profile 的 self 时间是答不出来的。
//
// 用法：node [--expose-gc] tests/perf-counters-v11.js <file> <steps> <horses> <length> <course> <reps> [warmup]
'use strict';
const path = require('node:path');

const [file, stepsArg, horsesArg, lengthArg, courseArg, repsArg, warmupArg] = process.argv.slice(2);
const steps = Number(stepsArg), horses = Number(horsesArg), length = Number(lengthArg);
const course = courseArg === '-' ? '' : courseArg;
const reps = Number(repsArg || 1), warmup = Number(warmupArg || 0);

const root = path.join(__dirname, '..');
const S = require(path.isAbsolute(file) ? file : path.join(root, file));

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
if (warmup > 0) { const w = makeRace(); for (let i = 0; i < warmup; i++) w.step(1 / 30); }

let best = Infinity;
for (let r = 0; r < reps; r++) {
  if (global.gc) global.gc();
  const rc = makeRace();
  const c0 = process.cpuUsage();
  for (let i = 0; i < steps; i++) rc.step(1 / 30);
  const c = process.cpuUsage(c0);
  best = Math.min(best, (c.user + c.system) / 1e6);
}
const P = globalThis.__P || {};
const extra = Object.entries(P).map(([k, v]) => `${k}=${v}`).join('  ');
process.stdout.write(`CPU ${best.toFixed(3)}  ${extra}\n`);
