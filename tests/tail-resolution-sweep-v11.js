#!/usr/bin/env node
'use strict';
// finishPlan answers a SOLO question: "holding this speed, do I reach the finish
// and when?" It currently marches there in 0.5 s steps (up to 600 s) with the full
// 2-D solver, and budgetSpeed calls it 9 times per rider decision. Sweep the solo
// cruise resolution and report both the cost and whether the race outcome moves.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const base = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');
function variant(tailMaxDt) {
  const from = 'tailMaxDt:Number.isFinite(options.maxStep)?clamp(options.maxStep/Math.max(1,H.v||H.base),1/120,0.5):(options.tailMaxDt??0.5)});';
  if (!base.includes(from)) throw new Error('anchor missing');
  const to = `tailMaxDt:Number.isFinite(options.maxStep)?clamp(options.maxStep/Math.max(1,H.v||H.base),1/120,0.5):(options.tailMaxDt??${tailMaxDt})});`;
  const f = path.join(os.tmpdir(), 'tail-' + String(tailMaxDt).replace('.', '_') + '.js');
  fs.writeFileSync(f, base.replace(from, to));
  return f;
}
function horse(i) {
  const h = S.makeHorse(() => 0.5, { id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(),
    behavior: { forwardness: 0.4 + (i % 3) * 0.2, settle: 0.6, tractability: 0.7 },
    racePlan: { position: 0.4 + (i % 3) * 0.2, risk: 0.5, patience: 0.6 } });
  for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
  return h;
}
let S = null;
function run(file, length, n) {
  delete require.cache[require.resolve(file)];
  S = require(file);
  const r = S.createRace(Array.from({ length: n }, (_, i) => horse(i)), { length, profile: '平坦', rng: S.mulberry32(20261004) });
  const c0 = process.cpuUsage();
  let g = 0; while (!r.race.finished && g++ < 400000) r.step(1 / 30);
  const c = process.cpuUsage(c0);
  const rows = r.race.horses.map(h => ({ id: h.id, time: h.time, place: h.place, stamina: +h.stamina.toFixed(6), work: +h.statsSummary.workUsed.toFixed(6) }));
  return { cpu: (c.user + c.system) / 1000, raceT: r.race.t, digest: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16), times: r.race.horses.map(h => h.time).sort((a, b) => a - b).map(t => t.toFixed(2)).join(','), winner: r.race.horses.find(h => h.place === 1)?.id };
}
const files = [0.5, 1.0, 2.0, 4.0].map(v => [v, variant(v)]);
console.log('=== 16 horses @ 2400m: 单独巡航积分步长扫描 ===');
for (const [v, f] of files) {
  const r = run(f, 2400, 16);
  console.log(`  tailMaxDt=${String(v).padEnd(4)} CPU=${r.cpu.toFixed(1)}s (${(r.cpu / r.raceT).toFixed(3)} CPU/赛事秒)  完赛t=${r.raceT.toFixed(1)}  冠军=${r.winner}  digest=${r.digest}`);
  console.log(`     前六名用时: ${r.times}`);
}
