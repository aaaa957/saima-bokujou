#!/usr/bin/env node
'use strict';
// Cost model of the v11 planner: counts projection calls, projection steps split by
// resolution, kinematic proposals, and bisection iterations, so "why is it slow"
// can be answered with numbers instead of intuition.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..');
let src = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');
const G = 'globalThis.__C';
function sub(from, to) {
  if (!src.includes(from)) throw new Error('anchor missing: ' + from.slice(0, 70));
  src = src.replace(from, to);
}
sub('    function raceKinematicProposal(H,before,v,transverse,dt,startFraction,aerobic) {',
    `    function raceKinematicProposal(H,before,v,transverse,dt,startFraction,aerobic) {
      ${G}.proposals=(${G}.proposals||0)+1;`);
sub('    function projectionMove(H,requestedV,requestedT,drafting,dt,time,demand=false,front=null,traffic=[]) {',
    `    function projectionMove(H,requestedV,requestedT,drafting,dt,time,demand=false,front=null,traffic=[]) {
      ${G}.moves=(${G}.moves||0)+1;`);
sub('    function projectActions(H,actions,options={}) {',
    `    function projectActions(H,actions,options={}) {
      ${G}.forecasts=(${G}.forecasts||0)+1;
      ${G}.currentMaxDt=clamp(Number.isFinite(options.maxDt)?options.maxDt:1/30,1/120,1);`);
sub('          for(let n=0;n<28;n++) {const mid=(low+high)/2;if(motionPower(H,before,propose(mid),drafting,dt)<=supply.maxPower) low=mid;else high=mid;}',
    `          for(let n=0;n<28;n++) {${G}.bisectPower=(${G}.bisectPower||0)+1;const mid=(low+high)/2;if(motionPower(H,before,propose(mid),drafting,dt)<=supply.maxPower) low=mid;else high=mid;}`);
sub('            for(let n=0;n<28;n++){const mid=(low+high)/2;if(followingSlack(H,F,propose(mid),fm)>=0)low=mid;else high=mid;}',
    `            for(let n=0;n<28;n++){${G}.bisectSlack=(${G}.bisectSlack||0)+1;const mid=(low+high)/2;if(followingSlack(H,F,propose(mid),fm)>=0)low=mid;else high=mid;}`);
sub('          elapsed+=dt;steps++;',
    `          elapsed+=dt;steps++;
          if(${G}.currentMaxDt<=1/60+1e-12){${G}.fineSteps=(${G}.fineSteps||0)+1;}else{${G}.coarseSteps=(${G}.coarseSteps||0)+1;}`);
sub('        if(!H.control && H.lastObserve<=0) {runAI(H);',
    `        if(!H.control && H.lastObserve<=0) {${G}.decisions=(${G}.decisions||0)+1;runAI(H);`);

const file = path.join(os.tmpdir(), 'costmodel-v11.js');
fs.writeFileSync(file, src);
const S = require(file);
function horse(i, n) {
  const h = S.makeHorse(() => 0.5, { id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(),
    behavior: { forwardness: 0.4 + (i % 3) * 0.2, settle: 0.6, tractability: 0.7 },
    racePlan: { position: 0.4 + (i % 3) * 0.2, risk: 0.5, patience: 0.6 } });
  for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
  return h;
}
const STEPS = 200;
for (const [n, len] of [[8, 2000], [16, 2400]]) {
  const C = globalThis.__C = { proposals: 0, moves: 0, forecasts: 0, fineSteps: 0, coarseSteps: 0, decisions: 0, bisectPower: 0, bisectSlack: 0 };
  const r = S.createRace(Array.from({ length: n }, (_, i) => horse(i, n)), { length: len, profile: '平坦', rng: S.mulberry32(20261004) });
  const c0 = process.cpuUsage();
  for (let i = 0; i < STEPS; i++) r.step(1 / 30);
  const c = process.cpuUsage(c0);
  const cpuMs = (c.user + c.system) / 1000;
  const simSeconds = STEPS / 30;
  const totalSteps = C.fineSteps + C.coarseSteps;
  console.log(`\n=== ${n} horses @ ${len}m, ${STEPS} physics steps (${simSeconds.toFixed(1)} race seconds) ===`);
  console.log(`  CPU                 ${cpuMs.toFixed(0)} ms   -> ${(cpuMs / simSeconds).toFixed(0)} ms per race-second, ${(cpuMs / STEPS).toFixed(2)} ms per physics step`);
  console.log(`  rider decisions     ${C.decisions}   (${(C.decisions / simSeconds).toFixed(2)}/race-second)`);
  console.log(`  projectActions      ${C.forecasts}   (${(C.forecasts / C.decisions).toFixed(1)} per decision)`);
  console.log(`  projection steps    ${totalSteps}`);
  console.log(`    coarse (0.12s)    ${C.coarseSteps}  (${(100 * C.coarseSteps / totalSteps).toFixed(0)}%)`);
  console.log(`    fine   (1/60s)    ${C.fineSteps}  (${(100 * C.fineSteps / totalSteps).toFixed(0)}%)`);
  console.log(`  projectionMove      ${C.moves}   (${(C.moves / totalSteps).toFixed(2)} per projection step)`);
  console.log(`  raceKinematicProposal ${C.proposals}   (${(C.proposals / totalSteps).toFixed(1)} per projection step)  <-- the real unit of work`);
  console.log(`    from power bisection ${C.bisectPower} of which ${(100 * C.bisectPower / Math.max(1, C.proposals)).toFixed(0)}% of all proposals`);
  console.log(`    from slack bisection ${C.bisectSlack}  = ${(100 * C.bisectSlack / Math.max(1, C.proposals)).toFixed(0)}% of all proposals`);
  console.log(`  proposals per race-second ${(C.proposals / simSeconds).toFixed(0)}`);
}
