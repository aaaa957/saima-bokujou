// 性能诊断的工作负载生成器（供 --cpu-prof 使用）。
// 目的：让「抽象场地」与「真实赛场」两条路径都能被单独 profile —— 二者的热点完全不同
// （抽象场地热点在 run/projectionMove；真实赛场热点在路线几何 routeTablePoint/routeArcState）。
//
// 用法（由 tests/perf-v11.sh 驱动）：
//   node --cpu-prof --cpu-prof-dir=.cprof tests/perf-run-v11.js <horses> <length> <course> <steps>
// 只读：不改仓库状态，不写任何赛车数据。
'use strict';
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const horses = Number(process.argv[2] || 12);
const length = Number(process.argv[3] || 2400);
const course = process.argv[4] || '';
const steps = Number(process.argv[5] || 300);

function mk(i) {
  const h = S.makeHorse(() => 0.5, {
    id: 'h' + i, level: 86, surface: '草地', special: '左右皆可', jockeyGrade: '优秀',
    '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
    physiology: S.neutralPhysiology(),
    behavior: { forwardness: .4 + (i % 3) * .2, settle: .6, tractability: .7 },
    racePlan: { position: .4 + (i % 3) * .2, risk: .5, patience: .6 },
  });
  for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
  return h;
}

const opts = { length, rng: S.mulberry32(7) };
if (course) opts.course = course;
const r = S.createRace(Array.from({ length: horses }, (_, i) => mk(i)), opts);

process.stderr.write(`[perf] horses=${horses} length=${length} course=${course || '(抽象)'} route=${!!r.race.geo.route}\n`);
const t0 = Date.now();
for (let i = 0; i < steps; i++) r.step(1 / 30);
const ms = Date.now() - t0;
process.stderr.write(`[perf] ${steps} 步耗时 ${ms} ms\n`);
