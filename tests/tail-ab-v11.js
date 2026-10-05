#!/usr/bin/env node
'use strict';
// Controlled A/B of the stage-A change (solo cruise step 0.5 s vs 1.0 s) against the
// SAME current source, interleaved in one process so thermal drift and JIT state
// cannot masquerade as an effect. Reports cost and whether the race outcome moves.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');
const D1 = 'tailMaxDt=clamp(Number.isFinite(options.tailMaxDt)?options.tailMaxDt:1,1/120,1);';
const D05 = 'tailMaxDt=clamp(Number.isFinite(options.tailMaxDt)?options.tailMaxDt:0.5,1/120,1);';
const F1 = '(options.tailMaxDt??1)});';
const F05 = '(options.tailMaxDt??0.5)});';
for (const s of [D1, F1]) if (!src.includes(s)) throw new Error('anchor missing: ' + s);
const fileA = path.join(os.tmpdir(), 'abA-tail05.js');
const fileB = path.join(os.tmpdir(), 'abB-tail10.js');
fs.writeFileSync(fileA, src.replace(D1, D05).replace(F1, F05));
fs.writeFileSync(fileB, src);
let S = null;
function horse(i) {
  const h = S.makeHorse(() => 0.5, { id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(),
    behavior: { forwardness: 0.4 + (i % 3) * 0.2, settle: 0.6, tractability: 0.7 },
    racePlan: { position: 0.4 + (i % 3) * 0.2, risk: 0.5, patience: 0.6 } });
  for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
  return h;
}
function run(file, length, n) {
  delete require.cache[require.resolve(file)];
  S = require(file);
  const r = S.createRace(Array.from({ length: n }, (_, i) => horse(i)), { length, profile: '平坦', rng: S.mulberry32(20261004) });
  const c0 = process.cpuUsage(); const t0 = Date.now(); let g = 0;
  while (!r.race.finished && g++ < 400000) r.step(1 / 30);
  const c = process.cpuUsage(c0);
  const rows = r.race.horses.map(h => ({ id: h.id, time: h.time, place: h.place, w: +h.statsSummary.workUsed.toFixed(6), u: +h.statsSummary.unpaidWork.toFixed(9) }));
  return { cpu: (c.user + c.system) / 1e6, wall: (Date.now() - t0) / 1000, t: r.race.t,
    dig: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 12),
    unpaid: rows.filter(x => x.u > 1e-6).length, top: r.race.horses.map(h => h.time).sort((a, b) => a - b).slice(0, 5).map(x => x.toFixed(2)).join(',') };
}
const CASES = [[8, 2000], [16, 2400]];
for (const [n, len] of CASES) {
  const res = { A: [], B: [] };
  run(fileA, len, n); run(fileB, len, n);           // warm both
  for (let round = 0; round < 2; round++) {
    const order = round ? ['B', 'A'] : ['A', 'B'];
    for (const k of order) res[k].push(run(k === 'A' ? fileA : fileB, len, n));
  }
  const best = a => a.reduce((m, x) => (x.cpu < m.cpu ? x : m));
  const A = best(res.A), B = best(res.B);
  console.log(`\n=== ${n} horses @ ${len}m (2 rounds each, min CPU) ===`);
  console.log(`  A  尾段0.5s : CPU=${A.cpu.toFixed(1)}s wall=${A.wall.toFixed(1)}s 完赛t=${A.t.toFixed(1)} 冠军段=${A.top} 漏付=${A.unpaid} dig=${A.dig}`);
  console.log(`  B  尾段1.0s : CPU=${B.cpu.toFixed(1)}s wall=${B.wall.toFixed(1)}s 完赛t=${B.t.toFixed(1)} 冠军段=${B.top} 漏付=${B.unpaid} dig=${B.dig}`);
  console.log(`  => CPU ${(A.cpu / B.cpu).toFixed(2)}x  wall ${(A.wall / B.wall).toFixed(2)}x  结果${A.dig === B.dig ? '相同' : '不同'}`);
}
