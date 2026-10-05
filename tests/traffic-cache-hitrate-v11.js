#!/usr/bin/env node
'use strict';
// The traffic coefficients are memoised with a Map keyed on the exact continuous
// lane position s and cleared at the start of every physics step. Whether that
// memoisation is worth its overhead is decided by its hit rate, so measure it
// instead of assuming: instrument a copy of the source and count calls and hits.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..');
let src = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

const FROM = `    function trafficProgressCoef(s,t) {
      let lane=trafficProgressCache.get(t);`;
const TO = `    function trafficProgressCoef(s,t) {
      globalThis.__tpcCalls=(globalThis.__tpcCalls||0)+1;
      let lane=trafficProgressCache.get(t);`;
const FROM2 = `      if(lane){const value=lane.get(s);if(value!==undefined)return value;}`;
const TO2 = `      if(lane){const value=lane.get(s);if(value!==undefined){globalThis.__tpcHits=(globalThis.__tpcHits||0)+1;return value;}}`;
const FROM3 = `      trafficProgressCache=new Map();trafficProgressCacheSize=0;`;
const TO3 = `      globalThis.__tpcClears=(globalThis.__tpcClears||0)+1;
      trafficProgressCache=new Map();trafficProgressCacheSize=0;`;
for (const [f, t] of [[FROM, TO], [FROM2, TO2], [FROM3, TO3]]) {
  if (!src.includes(f)) throw new Error('instrumentation anchor missing');
  src = src.replace(f, t);
}
const file = path.join(os.tmpdir(), 'tpc-instrumented.js');
fs.writeFileSync(file, src);
const S = require(file);
function horse(i) {
  const h = S.makeHorse(() => 0.5, { id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(),
    behavior: { forwardness: 0.5, settle: 0.6, tractability: 0.7 }, racePlan: { position: 0.5, risk: 0.5, patience: 0.6 } });
  for (const k of Object.keys(h.stats)) h.stats[k] = 86;
  return h;
}
for (const [n, len, steps] of [[8, 2000, 120], [16, 2400, 120]]) {
  globalThis.__tpcCalls = 0; globalThis.__tpcHits = 0; globalThis.__tpcClears = 0;
  const r = S.createRace(Array.from({ length: n }, (_, i) => horse(i)), { length: len, profile: '平坦', rng: S.mulberry32(20261004) });
  for (let i = 0; i < steps; i++) r.step(1 / 30);
  const c = globalThis.__tpcCalls, h = globalThis.__tpcHits;
  console.log(`${n} horses @ ${len}m over ${steps} steps:`);
  console.log(`  calls=${c}  hits=${h}  misses=${c - h}  hitRate=${(100 * h / c).toFixed(1)}%  cacheClears=${globalThis.__tpcClears} (one per step)`);
}
