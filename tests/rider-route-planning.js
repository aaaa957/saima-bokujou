#!/usr/bin/env node
'use strict';

// Situational rider decisions and conservative route forecasts, through the real
// engine. The dense reference uses small time steps, not forecast segments.
const assert = require('node:assert/strict');
const S = require('../sim.js');
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
function capAt(H, s, r) {
  const geo = r.race.geo;
  let cap = H.maxV * H.retention;
  const curvature = S.laneCurvatureAt(s, H.t, geo);
  if (curvature > 0) cap = Math.min(cap,
    Math.sqrt(Math.max(1, (S.RACE_F.curveLateral + (H.adj['力量'] - 70) * 0.008) / curvature)) * S.bendCoefFor(H.h.special, r.race.dir));
  return cap;
}
// This reference deliberately does not call finishPlan or use its mesh. The
// midpoint integrator follows finite acceleration and response using the motion
// model's physical parameters, and calls the shared power law. As in the forecast,
// retention, lane and the initial reserve power fade stay fixed; no future guts
// loss, reserve recovery, or available-power clipping alters the requested path.
// Acceleration is already in power: positive kinetic work is not charged twice.
function denseReference(r, H, requestedV, draftDistance = 0, step = 0.01) {
  const { geo, g, length } = r.race, maximum = H.aerobic * H.retention;
  const deficit = maximum - H.aerobicOutput, tau = H.aerobicTau;
  const fade = S.clamp(H.stamina / H.staminaMax / S.RACE_F.reserveFade, 0, 1);
  const response = S.RACE_F.responseTime * S.clamp(1 + (0.65 - H.behavior.tractability) * 0.4, 0.82, 1.26);
  function acceleration(v, target) {
    const mix = S.clamp(v / H.base, 0, 1);
    const maxA = (S.RACE_F.maxAccel * (0.7 + H.adj['出闸能力'] / 230) * (1 - mix) +
      S.RACE_F.runningAccel * (0.65 + H.adj['爆发力'] / 200) * mix) * (0.65 + 0.35 * fade);
    return S.clamp((target - v) / response, -S.RACE_F.braking, maxA);
  }
  let required = 0, elapsed = 0, v = H.v, s = H.s;
  while (s < length - 1e-9) {
    let seconds = step, nextV, to;
    const target = Math.max(3, Math.min(requestedV, capAt(H, s, r)));
    for (let i = 0; i < 3; i++) {
      const first = acceleration(v, target), predictedMid = Math.max(0, v + first * seconds / 2);
      nextV = Math.max(0, v + acceleration(predictedMid, target) * seconds);
      const meanV = (v + nextV) / 2;
      const approximateMid = s + meanV * seconds * S.laneProgressCoef(s, H.t, geo) / 2;
      to = s + meanV * seconds * S.laneProgressCoef(approximateMid, H.t, geo);
      if (to <= length + 1e-9) break;
      seconds *= (length - s) / (to - s);
    }
    to = Math.min(to, length);
    const mid = (s + to) / 2, meanV = (v + nextV) / 2;
    const drafting = mid - H.s < draftDistance;
    const gravityAtMid = 9.81 * S.gradientAt(mid, geo, g) *
      S.laneProgressCoef(mid, H.t, geo) * meanV * H.massRatio;
    const heightWork = 9.81 * (S.elevationAt(to, geo, g) - S.elevationAt(s, geo, g)) * H.massRatio;
    const kineticWork = 0.5 * (nextV * nextV - v * v) * H.massRatio;
    const power = Math.max(0, H.powerFor(meanV, 0, drafting, mid) - gravityAtMid +
      (heightWork + kineticWork) / seconds);
    const oxygen = maximum - deficit * tau / seconds *
      (Math.exp(-elapsed / tau) - Math.exp(-(elapsed + seconds) / tau));
    required += Math.max(0, power - oxygen) * seconds;
    v = nextV; elapsed += seconds; s = to;
  }
  return { required, seconds: elapsed };
}

test('a settled gallop can launch before 30 metres, while a slow horse beyond 30 metres is still starting', () => {
  const ready = command({ length: 200 }, { s: 20, v: 18.75 });
  assert.equal(ready.H.startSettled, true);
  assert.equal(ready.H.attacking, true, 'affordable propulsion must not wait for a travelled-distance gate');
  assert.ok(ready.H.sprintAt < 30);
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
  assert.equal(calm.attacking, true);
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
  assert.equal(rich.H.attacking, true);
  assert.equal(poor.H.attacking, false);
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

test('forecast cells retain bend, official hill, lap, shelter-end and finish boundaries', () => {
  const r = makeRace({ course: '中山芝外A', length: 3200 }), H = at(r, { s: 25, v: 17 });
  const forecast = H.finishPlan(18.5, 44, { trace: true }), geo = r.race.geo;
  assert.ok(forecast.segments.length > 8, 'geometry and resolution must determine the mesh');
  const endpoints = forecast.segments.flatMap(segment => [segment.from, segment.to]);
  const expected = [H.s, H.s + 44, r.race.length, ...geo.boundaries.map(x => x.s)];
  for (let loop = -1; loop <= Math.ceil(r.race.length / geo.lap) + 1; loop++) {
    for (const point of geo.elevationProfile) {
      const s = loop * geo.lap + point[0] - geo.startOffset;
      if (s > H.s && s < r.race.length) expected.push(s);
    }
  }
  for (const s of expected) assert.ok(endpoints.some(x => Math.abs(x - s) < 1e-6), 'missing actual route node ' + s);
  for (const segment of forecast.segments) {
    assert.ok(segment.to > segment.from && segment.to - segment.from <= 40 + 1e-8);
    for (const key of ['v', 'time', 'power', 'oxygen', 'draw']) assert.ok(Number.isFinite(segment[key]), 'finite trace ' + key);
  }
});

test('route reserve and elapsed time agree with a dense independent finite-acceleration reference', () => {
  const cases = [
    { course: '标准', length: 1200, s: 80, v: 16, requested: 18.5, oxygen: 0.45, draft: 44 },
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
    const r = makeRace(item), H = at(r, item), coarse = H.finishPlan(item.requested, item.draft || 0);
    const dense = denseReference(r, H, item.requested, item.draft || 0);
    referenceErrors.push({ joules: Math.abs(coarse.required - dense.required),
      ratio: Math.abs(coarse.required - dense.required) / Math.max(1, dense.required),
      seconds: Math.abs(coarse.seconds - dense.seconds) });
    try {
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
  const kinetic = accelerating.segments.reduce((sum, segment) => sum + segment.kinetic, 0);
  assert.ok(kinetic > 50, 'the requested acceleration must contain substantial actual positive kinetic work');
  assert.ok(accelerating.segments[0].toV < 16.95,
    'the first short route cell cannot set the target speed instantaneously');
  near(accelerating.required, accelerating.segments.reduce((sum, segment) => sum + segment.draw, 0), 1e-7,
    'kinetic work already included in total power cannot be added to reserve draw a second time');
  const dense = denseReference(r, H, 17);
  near(accelerating.required, dense.required, Math.max(8, dense.required * 0.025));
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
  const r = makeRace({ length: 800 }), H = at(r, { s: 700, t: 10, v: 16, reserve: 140 / 2450 });
  const forecast = H.finishPlan(16);
  assert.ok(forecast.required > 0 && forecast.required < H.stamina,
    'the final 100 metres must consume reserve without exhausting its total capacity');
  assert.ok(forecast.peakPowerShortfall > 0,
    'the depleted final reserve must expose its inadequate instantaneous power');
  assert.equal(forecast.feasible, false,
    'average reserve within a cell cannot authorize a pace the cell endpoint cannot sustain');
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
  for (const segment of forecast.segments) {
    near(segment.fromV, 13, 1e-9); near(segment.toV, 13, 1e-9);
    near(segment.kinetic, 0, 1e-9);
  }
});

console.log('\n' + passed + ' rider route planning tests passed; ' + failed + ' failed.');
if (referenceErrors.length) console.log('Dense reference (' + referenceErrors.length + ' cases): max reserve deviation ' +
  Math.max(...referenceErrors.map(x => x.joules)).toFixed(6) + ' J/kg; max relative deviation ' +
  (Math.max(...referenceErrors.map(x => x.ratio)) * 100).toFixed(6) + '%; max time deviation ' +
  Math.max(...referenceErrors.map(x => x.seconds)).toFixed(6) + ' s.');
if (failed) process.exitCode = 1;
