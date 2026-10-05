#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
function bench(label, path) {
  const S = require(path);
  function horse(id) {
    const h = S.makeHorse(() => 0.5, { id, name: id, level: 86, surface: '草地', special: '左右皆可',
      jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
      physiology: S.neutralPhysiology ? S.neutralPhysiology() : undefined,
      behavior: { forwardness: 0.5, settle: 0.5, tractability: 0.7 },
      racePlan: { position: 0.5, risk: 0.5, patience: 0.6 } });
    for (const k of Object.keys(h.stats)) h.stats[k] = 86;
    return h;
  }
  const race = S.createRace(Array.from({ length: 8 }, (_, i) => horse('h' + i)),
    { length: 2000, profile: '平坦', rng: S.mulberry32(20261004) });
  const N = 60;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) race.step(1 / 30);
  const ms = (performance.now() - t0) / N;
  console.log(label + ': ' + ms.toFixed(1) + ' ms per step(dt=1/30), 8 horses @2000m');
  return ms;
}
const v11 = bench('v11 working tree', require('node:path').resolve('sim.js'));
const mainPath = require('node:path').join(require('node:os').tmpdir(), 'main-sim.js');
fs.writeFileSync(mainPath, require('node:child_process').execSync('git show main:sim.js', { cwd: require('node:path').resolve(__dirname, '..') }).toString());
const main = bench('main (线上引擎)  ', mainPath);
console.log('\n--- 玩家感知（页面 dt=1/30，步数 = 完赛用时 × 30）---');
const real = { '1200': 67.0, '1600': 92.3, '2000': 117.3, '2400': 141.8, '3000': 184.0, '3200': 194.2 };
for (const [d, t] of Object.entries(real)) {
  const steps = t * 30;
  const a = steps * v11 / 1000, b = steps * main / 1000;
  console.log(`${d}m  race ${t}s -> v11 needs ${a.toFixed(0)}s CPU (${(a / t).toFixed(2)}x real-time)  |  main needs ${b.toFixed(1)}s (${(b / t).toFixed(3)}x)`);
}
