#!/usr/bin/env node
'use strict';

// Situational decisions and same-state route continuations through the real engine.
// The old independent formula froze future guts/recovery/reserve fade, which is
// intentionally no longer the forecast model. The reference now executes the
// actual60Hz controlled horse; independent work/route/finite-state checks remain.
const assert = require('node:assert/strict');
const S = require('../sim.js');
const { terminalReleaseFixture } = require('./fixtures/route-reserve-power-v11');
let passed = 0, failed = 0;
const referenceErrors = [];
function test(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function near(a, b, tolerance, message) {
  assert.ok(Math.abs(a - b) <= tolerance,
    (message || 'values must agree') + ': ' + a + ' vs ' + b);
}
function horse(id = 'route-a') {
  const h = S.makeHorse(() => 0.5, { id, name: id, style: '先', '斗志': 50, '疲劳': 0,
    jockeyGrade: '优秀', surface: '草地', special: '左右皆可',
    physiology: S.neutralPhysiology(),
    behavior: { forwardness: 0.5, settle: 0.7, tractability: 0.8 },
    racePlan: { position: 0.5, risk: 0.5, patience: 0.7 } });
  for (const key of Object.keys(h.stats)) h.stats[key] = 70;
  return h;
}
function makeRace(options = {}) {
  return S.createRace([horse()], { length: 2000, course: '标准', profile: '平坦',
    rng: () => 0.5, ...options });
}
function at(r, { s = 100, t = 10, v = 17, reserve = 1, oxygen = 1, accel = 0, settled = false } = {}) {
  const H = r.race.horses[0];
  Object.assign(H, { s, t, targetT: t, v, prevV: v, targetV: v, accel,
    lastObserve: 0, startDelay: 0, startSettled: settled, laneIntentT: 0, blocked: false, blocker: null });
  H.stamina = H.staminaMax * reserve;
  H.aerobicOutput = H.aerobic * H.retention * oxygen;
  r.race.t = 30;
  return H;
}
function command(options, state) {
  const r = makeRace(options), H = at(r, state);
  r.step(1 / 1000);
  assert.ok(H.strategy, 'a real rider observation must occur');
  return { r, H };
}
function denseReference(r, H, requestedV) {
  const atTime=r.race.t,initial={...H.statsSummary};H.control={targetV:requestedV,targetT:H.t};
  while(!r.race.finished&&r.race.t<600)r.step(1/60);
  assert(r.race.finished&&!H.dnf,'Controlled physical continuation must finish');
  return {required:H.statsSummary.energyUsed-initial.energyUsed,recovered:H.statsSummary.recovered-initial.recovered,
    seconds:H.time-atTime,endpoint:{s:H.s,t:H.t,v:H.v,stamina:H.stamina,guts:H.guts,retention:H.retention,aerobicOutput:H.aerobicOutput}};
}

test('a settled gallop can consider paid attack before30 metres while a slow horse beyond30 metres is still starting', () => {
  const ready = command({ length: 200 }, { s: 20, v: 18.75 });
  assert.equal(ready.H.startSettled, true);
  assert.ok(ready.H.planning.candidates.some(c=>c.mode==='attack'&&c.energyFeasible&&c.goalReached),
    'affordable attack must be available before a fixed travelled-distance gate; position scoring chooses the action');
  const starting = command({ length: 200 }, { s: 100, v: 1 });
  assert.equal(starting.H.startSettled, false);
  assert.equal(starting.H.attacking, false, 'distance alone cannot complete gate acceleration');
  assert.ok(starting.H.targetV > starting.H.v, 'starting must still command real forward acceleration');
});

test('a closed gate cannot complete the start or consume propulsion reserve', () => {
  const r = makeRace({ length: 200 }), H = at(r, { s: 0, v: 0 });
  r.race.t = 0; H.startDelay = 1;
  const before = H.stamina; r.step(1 / 1000);
  assert.equal(H.attacking, false);
  assert.equal(H.startSettled, false);
  near(H.s, 0, 1e-12, 'gate reaction must prevent forward travel');
  assert.ok(H.stamina >= before - 1e-9, 'no launch work can be charged before the gate opens');
});

test('starting stability also depends on acceleration response at the same speed and position', () => {
  const calm = command({ length: 200 }, { s: 40, v: 13.7, accel: 0 }).H;
  const accelerating = command({ length: 200 }, { s: 40, v: 13.7, accel: 3 }).H;
  assert.equal(calm.startSettled, true);
  assert.ok(calm.planning.candidates.some(c=>c.mode==='attack'&&c.energyFeasible));
  assert.equal(accelerating.startSettled, false,
    'a runner still rapidly building speed must not be classified by distance or speed alone');
  assert.equal(accelerating.attacking, false);
  assert.equal(accelerating.strategy.mode, 'start');
});

test('same distance and physical route replan from reserve rather than a common launch point', () => {
  // A stable gallop is already established; a faster new instruction is not a
  // reason to misclassify the horse as still completing its initial start.
  const rich = command({ length: 2000 }, { s: 1820, v: 17, reserve: 0.7 });
  const poor = command({ length: 2000 }, { s: 1820, v: 17, reserve: 0.001 });
  assert.ok(rich.H.planning.candidates.some(c=>c.mode==='attack'&&c.energyFeasible));
  assert.ok(!poor.H.planning.candidates.some(c=>c.mode==='attack'));
  assert.ok(rich.H.targetV > poor.H.targetV + 1, 'reserve must change the real velocity command');
});

test('a depleted-reserve boundary does not introduce a command cliff at four percent', () => {
  const low = command({ length: 2000 }, { s: 1880, v: 15, reserve: 0.0399 }).H;
  const high = command({ length: 2000 }, { s: 1880, v: 15, reserve: 0.0401 }).H;
  assert.ok(high.targetV >= low.targetV - 1e-8);
  near(low.targetV, high.targetV, 0.08,
    'nearby states should differ continuously instead of changing at the old fixed reserve ratio');
});

test('equal remaining routes and states produce equal commands despite different completed proportions', () => {
  const lengths = [1200, 2000, 3200];
  const results = lengths.map(length => command({ length }, { s: length - 500, v: 17, reserve: 0.45 }).H);
  assert.ok((1200 - 500) / 1200 < 0.7 && (3200 - 500) / 3200 > 0.7,
    'fixture must cross the former percentage-based final phase');
  for (const H of results.slice(1)) {
    near(H.targetV, results[0].targetV, 1e-8);
    assert.equal(H.attacking, results[0].attacking);
    near(H.finishPlan(H.maxV).required, results[0].finishPlan(results[0].maxV).required, 1e-7);
  }
});

test('route forecasting is read-only, deterministic, and does not consume rider randomness', () => {
  let randomCalls = 0;
  const r = makeRace({ course: '京都芝外A', length: 3000, rng: () => { randomCalls++; return 0.5; } });
  const H = at(r, { s: 200, v: 17, oxygen: 0.65 }), calls = randomCalls;
  const before = JSON.stringify({ snapshot: r.snapshot(), stats: H.statsSummary, history: H.strategyHistory });
  const a = H.finishPlan(18.5, 44, { trace: true });
  const b = H.finishPlan(18.5, 44, { trace: true });
  assert.deepEqual(a, b);
  assert.equal(randomCalls, calls);
  assert.equal(JSON.stringify({ snapshot: r.snapshot(), stats: H.statsSummary, history: H.strategyHistory }), before);
});

test('state forecast traverses bend, official hill, lap, shelter-end and finish without teleporting', () => {
  const r = makeRace({ course: '中山芝外A', length: 3200 }), H = at(r, { s: 25, v: 17 });
  const forecast = H.projectActions([],{tailTargetV:18.5,tailMaxDt:1/60,trace:true}), geo = r.race.geo;
  assert.ok(forecast.trace.length > 8, 'a physical state trace must contain finite route advances');
  const endpoints = [H.s,...forecast.trace.map(point=>point.s)];
  const expected = [H.s, H.s + 44, r.race.length, ...geo.boundaries.map(x => x.s)];
  for (let loop = -1; loop <= Math.ceil(r.race.length / geo.lap) + 1; loop++) {
    for (const point of geo.elevationProfile) {
      const s = loop * geo.lap + point[0] - geo.startOffset;
      if (s > H.s && s < r.race.length) expected.push(s);
    }
  }
  for (const s of expected) assert.ok(endpoints.some((x,i)=>i&&endpoints[i-1]<=s+1e-7&&x>=s-1e-7), 'route node not traversed '+s);
  let previous={s:H.s,t:H.t,v:H.v,time:r.race.t};
  for (const point of forecast.trace) {
    const dt=point.time-previous.time,meanV=(previous.v+point.v)/2;
    const arc=S.laneArcDistance(previous.s,point.s,(previous.t+point.t)/2,geo);
    near(Math.hypot(arc,point.t-previous.t),meanV*dt,1e-8,'physical arc must match integrated speed');
    const middle=(previous.s+point.s)/2,curvature=S.laneCurvatureAt(middle,H.t,geo);
    const c2=S.RACE_F.resistanceK*H.economy*H.surfaceCost;
    const c6=c2*S.RACE_F.turnCost*curvature*curvature/(S.RACE_F.curveLateral*S.RACE_F.curveLateral);
    const gravity=9.81*(S.elevationAt(point.s,geo,r.race.g)-S.elevationAt(previous.s,geo,r.race.g))/dt;
    const acceleration=(point.v-previous.v)/dt;
    const independentWork=Math.max(0,(c2*meanV*meanV+c6*Math.pow(meanV,6)+S.RACE_F.airK*Math.pow(meanV,3)+gravity+acceleration*meanV)*H.massRatio);
    near(point.work,independentWork,1e-6,'height and kinetic work must be paid once on the actual route');
    for (const key of ['v','time','work','supply','stamina','guts'])assert.ok(Number.isFinite(point[key]),'finite state trace '+key);
    previous=point;
  }
});

test('paid route state agrees with actual60Hz continuation including future fatigue and recovery', () => {
  const cases = [
    { course: '标准', length: 1200, s: 80, v: 16, requested: 18.5, oxygen: 0.45 },
    { course: '小回り', length: 2400, s: 200, v: 18.75, requested: 18.75, oxygen: 1, t: 3 },
    { course: '東京芝A', length: 2000, s: 225, v: 16, requested: 18.5, oxygen: 0.65, wind: 8 },
    { course: '中山芝外A', length: 3200, s: 320, v: 17, requested: 18.75, oxygen: 0.45, t: 15 },
    { course: '京都芝外A', length: 3000, s: 700, v: 16, requested: 17.5, oxygen: 1 },
    { course: '标准', length: 800, s: 300, v: 13.7, requested: 13.7, oxygen: 0.45 },
    { course: '标准', length: 1200, s: 0, v: 0, requested: 17, oxygen: 0.45 },
    { course: '小回り', length: 1200, s: 180, v: 10, requested: 18.75, oxygen: 0.45, t: 3 },
  ];
  const errors = [];
  for (const item of cases) {
    const r = makeRace(item), H = at(r, item);
    const coarse=H.projectActions([],{tailTargetV:item.requested}),fine=H.projectActions([],{tailTargetV:item.requested,tailMaxDt:1/60});
    const dense = denseReference(r, H, item.requested);
    referenceErrors.push({ joules: Math.abs(coarse.required - dense.required),
      ratio: Math.abs(coarse.required - dense.required) / Math.max(1, dense.required),
      seconds: Math.abs(coarse.seconds - dense.seconds) });
    try {
      for(const key of Object.keys(dense.endpoint))near(fine.endpoint[key],dense.endpoint[key],1e-7,item.course+' same-state '+key);
      near(fine.required,dense.required,1e-7,'60Hz reserve draw');near(fine.seconds,dense.seconds,1e-7,'60Hz interpolated finish');
      near(fine.ledger.recovered,dense.recovered,1e-7,'60Hz reserve recovery');
      near(coarse.required, dense.required, Math.max(8, dense.required * 0.025),
        item.course + ' v=' + item.v + ' reserve integral');
      near(coarse.seconds, dense.seconds, Math.max(0.05, dense.seconds * 0.0025),
        item.course + ' v=' + item.v + ' elapsed route time');
    } catch (error) { errors.push(error.message); }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('crossing a bend entry by two millimetres cannot create a target-acceleration budget jump', () => {
  const r = makeRace({ course: '小回り', length: 2000 }), H = at(r, { t: 3, v: 12 });
  const bend = r.race.geo.boundaries.find(point => point.kind === 'bendStart');
  assert.ok(bend, 'fixture needs a real upcoming bend');
  H.s = bend.s - 0.001;
  const before = H.finishPlan(H.maxV);
  H.s = bend.s + 0.001;
  const after = H.finishPlan(H.maxV);
  near(before.required, after.required, 0.1,
    'a microscopic straight cannot charge an instantaneous full-speed acceleration before entering the bend');
  near(before.seconds, after.seconds, 0.01);
});

test('oxygen startup costs reserve while finite acceleration pays its positive kinetic work once', () => {
  const r = makeRace({ length: 800 }), H = at(r, { s: 300, v: 17, oxygen: 1 });
  const warm = H.finishPlan(17).required;
  H.aerobicOutput = H.aerobic * H.retention * 0.45;
  const cold = H.finishPlan(17).required;
  assert.ok(cold > warm + 50, 'oxygen response must pay an actual startup deficit');
  H.aerobicOutput = H.aerobic * H.retention;
  H.v = 10;
  const accelerating = H.finishPlan(17, 0, { trace: true });
  const kinetic = accelerating.ledger.positiveKineticWork;
  assert.ok(kinetic > 50, 'the requested acceleration must contain substantial actual positive kinetic work');
  assert.ok(accelerating.trace[0].v < 16.95,
    'the first short route cell cannot set the target speed instantaneously');
  near(accelerating.required, accelerating.ledger.requiredDraw, 1e-7,
    'kinetic work already included in total power cannot be added to reserve draw a second time');
  const paid=H.projectActions([],{tailTargetV:17,tailMaxDt:1/60}),dense=denseReference(r,H,17);
  near(paid.required,dense.required,1e-7);
  near(paid.ledger.work,paid.ledger.aerobicUsed+paid.ledger.energyUsed,1e-7,'kinetic work is paid once within total work');
});

test('a future hill changes the route budget and real command at the same distance', () => {
  function run(flatten) {
    const r = makeRace({ course: '中山芝内A', length: 2000 });
    // Keep every geometric and slope-node location. Change only their heights
    // in this controlled comparison, isolating work against gravity.
    if (flatten) r.race.geo.elevationProfile = r.race.geo.elevationProfile.map(([s]) => [s, 0]);
    const H = at(r, { s: 1800, v: 16, reserve: 200 / 2450, settled: true });
    const forecast = H.finishPlan(18.75);
    r.step(1 / 1000);
    return { H, forecast };
  }
  const hill = run(false), flat = run(true);
  assert.ok(hill.forecast.required > flat.forecast.required + 10,
    'the remaining climb must require real gravitational work');
  assert.ok(hill.H.targetV < flat.H.targetV - 0.01,
    'a rider must account for the coming hill before reaching it');
});

test('energy capacity alone cannot authorize a pace above available oxygen and reserve power', () => {
  const r = makeRace({ length: 800, wind: 12 }), H = at(r, { s: 720, v: 18.75, oxygen: 0.2 });
  const cold = H.finishPlan(18.75);
  assert.ok(cold.required < H.stamina, 'fixture must have enough stored joules for the whole route');
  assert.ok(cold.peakPowerShortfall > 1, 'the instantaneous supply must be inadequate');
  assert.equal(cold.feasible, false, 'reserve volume cannot substitute for supply rate');
  H.aerobicOutput = H.aerobic * H.retention;
  const warm = H.finishPlan(18.75);
  assert.equal(warm.feasible, true, 'the same pace must become feasible with warmed oxygen supply');
  near(warm.peakPowerShortfall, 0, 1e-9);
});

test('remaining reserve power at the route end can reject a pace despite sufficient total joules', () => {
  const r = makeRace({ length: 800 }), H = at(r, { s: 700, t: 10, v: 16 });
  // A fixed 140 J/kg loses the "total energy is sufficient" premise under a
  // higher running-cost parameter set. Derive this input without changing the
  // original assertions: full-route demand plus half terminal-release reserve.
  const fixture = terminalReleaseFixture(S, H, 16);
  const forecast = H.finishPlan(16);
  assert.ok(forecast.required > 0 && forecast.required < H.stamina,
    'the final 100 metres must consume reserve without exhausting its total capacity');
  assert.ok(forecast.peakPowerShortfall > 0,
    'the depleted final reserve must expose its inadequate instantaneous power');
  assert.equal(forecast.feasible, false,
    'average reserve within a cell cannot authorize a pace the cell endpoint cannot sustain');
  console.log('Terminal-release fixture: ' + JSON.stringify({ need: fixture.need, margin: fixture.margin,
    reserve: H.stamina, required: forecast.required, peakPowerShortfall: forecast.peakPowerShortfall }));
});

test('warm oxygen sustains an unchanged economical pace with zero reserve', () => {
  const r = makeRace({ length: 800 }), H = at(r, { s: 700, t: 10, v: 13, reserve: 0 });
  assert.ok(H.powerFor(13, 0, false) < H.aerobicOutput,
    'fixture must be genuinely below its sustainable supply');
  const forecast = H.finishPlan(13, 0, { trace: true });
  assert.equal(forecast.feasible, true,
    'an unchanged speed must not invent an instantaneous acceleration at the segment endpoint');
  near(forecast.required, 0, 1e-9);
  near(forecast.peakPowerShortfall, 0, 1e-9);
  for(const point of forecast.trace)near(point.v,13,1e-9);
  near(forecast.ledger.positiveKineticWork,0,1e-9);
});

console.log('\n' + passed + ' rider route planning tests passed; ' + failed + ' failed.');
if (referenceErrors.length) console.log('Dense reference (' + referenceErrors.length + ' cases): max reserve deviation ' +
  Math.max(...referenceErrors.map(x => x.joules)).toFixed(6) + ' J/kg; max relative deviation ' +
  (Math.max(...referenceErrors.map(x => x.ratio)) * 100).toFixed(6) + '%; max time deviation ' +
  Math.max(...referenceErrors.map(x => x.seconds)).toFixed(6) + ' s.');
if (failed) process.exitCode = 1;
