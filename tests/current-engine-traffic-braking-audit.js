#!/usr/bin/env node
'use strict';
// Observe the frozen engine in memory. No physics or random calls are changed.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const A = require('./current-engine-population-audit');
const ROOT = path.resolve(__dirname, '..');
if (A.hash() !== A.EXPECTED) throw new Error('Frozen engine changed');
const {source,readArchived}=require('./helpers/frozen-v8');
const matrix = JSON.parse(readArchived(path.join(ROOT, 'docs/current-engine-population-audit-independent-2026-10-02.json')).toString('utf8'));
function replaceOnce(text, needle, replacement) {
  if (text.split(needle).length !== 2) throw new Error('Observation anchor changed');
  return text.replace(needle, replacement);
}
let observed = replaceOnce(source,
  'const move=motion.get(H), before=old.get(H);',
  'const move=motion.get(H), before=old.get(H); const auditProposal={...move}, auditCorrections=[];');
observed = replaceOnce(observed,
  'move.s=Math.max(before.s,Math.min(move.s,fm.s-clearance));H.blocked=true;',
  'auditCorrections.push({frontId:F.id,frontOld:{...old.get(F)},frontMove:{...fm},longitudinalClearance:clearance,lateralClearance:(horseWid(H)+horseWid(F))/2+0.1,moveBefore:{...move}}); move.s=Math.max(before.s,Math.min(move.s,fm.s-clearance));H.blocked=true;');
observed = replaceOnce(observed,
  'H.s=move.s;H.t=move.t;H.prevV=before.v;H.v=move.v;H.accel=(H.v-before.v)/dt;',
  'H.s=move.s;H.t=move.t;H.prevV=before.v;H.v=move.v;H.accel=(H.v-before.v)/dt; if(H.accel < -50) globalThis.__observeTraffic({time:race.t+dt,dt,id:H.id,gate:H.gate,place:H.place,before:{...before},proposal:auditProposal,after:{s:H.s,t:H.t,v:H.v,accel:H.accel},corrections:auditCorrections});');
const cases = [
  { context: 'healthy-flat', generationSeed: 3198315393, target: 'h7' },
  { context: 'equal-ability-flat', generationSeed: 3198943767, target: 'h6' },
];
const records = cases.map(c => {
  const reference = matrix.samples.find(r => r.context === c.context && r.generationSeed === c.generationSeed && r.length === 1200);
  if (!reference) throw new Error('Missing exact reference');
  const events = [], sandbox = { module: { exports: {} }, __observeTraffic: e => events.push(e) };
  vm.runInNewContext(observed, sandbox, { filename: 'frozen-sim-observed-in-memory.js' });
  const S = sandbox.module.exports, field = S.makeField(S.mulberry32(reference.seed), { n: reference.n, level: 70 });
  for (const h of field) {
    h.surface = '草地'; h.special = '左右皆可'; h['疲劳'] = 0; h['斗志'] = 50;
    h.jockeyGrade = '普通'; h.carriedWeight = 57; h.bodyMass = 480;
    if (reference.context === 'equal-ability-flat') for (const key of Object.keys(h.stats)) h.stats[key] = 70;
  }
  const rc = S.createRace(field, { length: reference.length, course: reference.course, dir: reference.dir,
    surface: '草地', state: '良', profile: '平坦', wind: 0, rng: S.mulberry32(reference.raceSeed) });
  const sampledMin = new Map(rc.race.horses.map(h => [h.id, 0]));
  while (!rc.race.finished && rc.race.t < 610) {
    const activeBefore = rc.race.horses.filter(h => !h.place);
    rc.step(1 / 30);
    for (const h of activeBefore) sampledMin.set(h.id, Math.min(sampledMin.get(h.id), h.accel));
  }
  const identicalFinishTimes = rc.race.horses.every(h => reference.horses.find(r => r.id === h.id).time === h.time);
  const identicalSampledAcceleration = rc.race.horses.every(h => reference.horses.find(r => r.id === h.id).minAcceleration === sampledMin.get(h.id));
  if (!identicalFinishTimes || !identicalSampledAcceleration) throw new Error('Observation changed trial result');
  const sorted = events.slice().sort((a, b) => a.after.accel - b.after.accel);
  const targetWorst = sorted.find(e => e.id === c.target), worst = sorted[0];
  if (!targetWorst || !targetWorst.corrections.length || targetWorst.place !== null || targetWorst.before.s >= reference.length)
    throw new Error('Target is not a pre-finish traffic correction');
  return { context: c.context, generationSeed: reference.generationSeed, raceSeed: reference.raceSeed,
    length: reference.length, n: reference.n, replicate: reference.replicate,
    identicalFinishTimes, identicalSampledAcceleration, extremeInternalEvents: events.length,
    first: events[0], worst, targetWorst,
    allEventsAreTrafficCorrections: events.every(e => e.corrections.length > 0),
    caveat: 'Diagnostic events below -50 m/s², not an empirical safety threshold. Internal 60Hz observation may find worse extrema than the original sampled outer30Hz matrix.' };
});
if (A.hash() !== A.EXPECTED) throw new Error('Engine modified during observation');
const report = { measuredAt: new Date().toISOString(), engineHash: A.EXPECTED, engineUnchanged: true,
  method: 'Read-only callback inserted into a VM copy of the frozen source; original outer step1/30s and all original random calls retained; every internal step1/60s observed. Finish times and sampled acceleration exactly equal formal matrix.',
  conclusion: 'Final traffic settlement can clear forward speed after simultaneous lateral moves pass individual checks against old neighbor positions. This bypasses normal 3.5m/s² braking; no contact/fall state explains the discontinuity. Contribution to population win-rate/gap errors has not been isolated.',
  records };
const out = path.join(ROOT, 'docs/current-engine-traffic-braking-audit-2026-10-02.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out, engineUnchanged: true, records: records.map(r => ({ context: r.context,
  identicalFinishTimes: r.identicalFinishTimes, identicalSampledAcceleration: r.identicalSampledAcceleration,
  time: r.targetWorst.time, beforeSpeed: r.targetWorst.before.v, afterSpeed: r.targetWorst.after.v,
  acceleration: r.targetWorst.after.accel, distance: r.targetWorst.before.s, internalWorst: r.worst.after.accel })) }, null, 2));
