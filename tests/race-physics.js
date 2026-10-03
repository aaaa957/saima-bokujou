#!/usr/bin/env node
'use strict';

// Controlled policies isolate the motion/energy model from rider choices.
// All measurements below come from the real engine; no formula is duplicated.
const assert = require('node:assert/strict');
const S = require('../sim.js');
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function near(a, b, tolerance, message) {
  assert.ok(Math.abs(a - b) <= tolerance, (message || 'values must agree') + ': ' + a + ' vs ' + b);
}
function horse(id, style = '先', value = 70) {
  const h = S.makeHorse(() => 0.5, { id, style, '斗志': 50, '疲劳': 0,
    jockeyGrade: '普通', surface: '草地', special: '左右皆可', aggression: 1,
    physiology: S.neutralPhysiology() });
  for (const key of Object.keys(h.stats)) h.stats[key] = value;
  return h;
}
function makeRace(field = [horse('a')], options = {}) {
  return S.createRace(field, { length: 2000, profile: '平坦', rng: () => 0.5, ...options });
}
function hold(H, { s = 100, t = 10, v = 16, targetV = v } = {}) {
  Object.assign(H, { s, t, v, prevV: v, targetT: t, targetV, lastObserve: Infinity,
    action: null, actionT: 0, laneIntentT: 0, laneJitter: 0, startDelay: 0 });
  H.control = { targetV, targetT: t };
}
function advance(race, seconds, dt = 1 / 30) {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) race.step(dt);
}
function reserves(H) { return [H.stamina / H.staminaMax, H.guts / H.gutsMax]; }
function segment(geo, bend) {
  // Pick an interior point, avoiding a geometry join or starting gate.
  for (let s = 100; s < 1900; s += 10) {
    if ((S.kAt(s, geo) > 0) === bend && (S.kAt(s + 30, geo) > 0) === bend) return s;
  }
  throw new Error('fixture course must have both a bend and a straight');
}

test('supported field sizes keep fixed gate spacing with enough room for complete bodies', () => {
  let firstGate = null;
  for (const count of [1, 4, 8]) {
    const race = makeRace(Array.from({ length: count }, (_, i) => horse('h' + i, '先', 115)));
    const gates = race.race.horses.slice().sort((a, b) => a.gate - b.gate);
    if (firstGate === null) firstGate = gates[0].t;
    else near(gates[0].t, firstGate, 1e-10, 'fewer runners cannot expand the same gate position');
    for (let i = 1; i < gates.length; i++) {
      const clearance = 1 + 0.3 * (gates[i].adj['体格'] + gates[i - 1].adj['体格']) / 200;
      near(gates[i].t - gates[i - 1].t, 1.6, 1e-10, 'gate spacing must stay fixed');
      assert.ok(gates[i].t - gates[i - 1].t >= clearance + 0.1, 'large horses must fit without overlapping at the gate');
    }
  }
});

test('the start has finite acceleration instead of assigning racing speed', () => {
  const race = makeRace(), H = race.race.horses[0], dt = 1 / 30;
  assert.equal(H.v, 0);
  H.control = { targetV: H.cruise, targetT: H.t };
  // A gate reaction delay is legitimate; isolate the first moving frame.
  for (let i = 0; i < 60 && race.race.t + dt <= H.startDelay; i++) race.step(dt);
  race.step(dt);
  assert.ok(H.v > 0 && H.v <= 6 * dt, 'first frame must accelerate from rest within a physical bound');
  assert.ok(H.s > 0 && H.s < 0.01, 'first frame cannot travel as though already at full speed');
  for (let i = 0; i < 150; i++) {
    const before = H.v; race.step(dt);
    assert.ok(Number.isFinite(H.v) && H.v >= 0);
    assert.ok(Math.abs(H.v - before) <= 6 * dt + 1e-8, 'free-running acceleration must remain bounded');
  }
  assert.ok(H.v > 8 && H.v < 22, 'normal gate acceleration must reach a plausible gallop');
});

test('gate reaction and low-speed steering cannot create motion without speed', () => {
  // Check one internal substep; decreasing acceleration makes the integral
  // over two substeps differ from a single endpoint trapezoid.
  const race = makeRace(), H = race.race.horses[0], dt = 1 / 60;
  H.control = { targetV: H.cruise, targetT: 3 };
  const initialT = H.t;
  for (let i = 0; i < 30; i++) {
    const before = { s: H.s, t: H.t, v: H.v };
    const point = S.trackPoint(H.s, H.t, race.race.geo);
    race.step(dt);
    if (race.race.t <= H.startDelay) {
      near(H.s, 0, 1e-10, 'closed gate cannot advance');
      near(H.t, initialT, 1e-10, 'closed gate cannot steer');
    }
    const after = S.trackPoint(H.s, H.t, race.race.geo);
    const travel = Math.hypot(after.x - point.x, after.y - point.y);
    assert.ok(travel <= (before.v + H.v) / 2 * dt + 1e-6,
      'world-space distance cannot exceed integrated physical speed');
  }
});

test('phase labels cannot produce a discontinuous velocity jump', () => {
  for (const phase of S.PHASE_DEFS.slice(1)) {
    const race = makeRace(), H = race.race.horses[0], dt = 1 / 1000;
    hold(H, { s: phase.from * race.race.length - 0.001, v: 16, targetV: 18 });
    const before = H.v; race.step(dt);
    assert.ok(H.s > phase.from * race.race.length, 'fixture must cross ' + phase.key);
    assert.ok(Math.abs(H.v - before) <= 6 * dt + 1e-8, phase.key + ' cannot teleport speed');
  }
});

test('absolute work and reserves do not depend on a remote entrant or field average', () => {
  function run(withRemote) {
    const race = makeRace(withRemote ? [horse('a'), horse('remote', '逃', 30)] : [horse('a')]);
    const [H, remote] = race.race.horses;
    hold(H, { s: segment(race.race.geo, false), v: 16, targetV: 17 });
    if (remote) hold(remote, { s: Math.max(0, H.s - 150), t: 18, v: 8, targetV: 8 });
    advance(race, 5);
    return { s: H.s, v: H.v, power: H.power, work: H.statsSummary.workUsed,
      energy: H.statsSummary.energyUsed, reserves: reserves(H) };
  }
  const alone = run(false), remote = run(true);
  for (const key of ['s', 'v', 'power', 'work', 'energy']) near(alone[key], remote[key], 1e-9, key + ' must be local');
  alone.reserves.forEach((value, i) => near(value, remote.reserves[i], 1e-10, 'remote horse cannot change reserve use'));
});

test('faster sustained pace costs more energy and short-term reserve', () => {
  function run(targetV) {
    const race = makeRace(), H = race.race.horses[0];
    hold(H, { s: 100, v: targetV, targetV });
    advance(race, 20);
    return { H, reserve: reserves(H), work: H.statsSummary.workUsed, used: H.statsSummary.energyUsed };
  }
  const cruise = run(15.5), fast = run(19.5);
  assert.ok(fast.work > cruise.work, 'fast pace must require more absolute work over equal time');
  assert.ok(fast.used > cruise.used, 'fast pace must expend more short-term reserve over equal time');
  assert.ok(fast.reserve[0] < cruise.reserve[0], 'fast pace must reduce available short-term energy more');
  assert.ok(fast.reserve[1] < cruise.reserve[1], 'fatigue must track increased exertion');
});

test('both energy and fatigue evolve while stamina remains available', () => {
  const race = makeRace(), H = race.race.horses[0];
  hold(H, { s: 100, v: 19, targetV: 19 });
  const before = reserves(H); advance(race, 3);
  const after = reserves(H);
  assert.ok(after[0] < before[0] && after[0] > 0.2, 'fixture must expend energy before exhaustion');
  assert.ok(after[1] < before[1], 'fatigue cannot wait for an empty first tank');
  assert.ok(after.every((value) => value >= 0 && value <= 1));
});

test('nearly exhausted reserve changes capability continuously', () => {
  function run(stamina) {
    const race = makeRace(), H = race.race.horses[0];
    hold(H, { s: 1700, v: 16, targetV: 20 });
    H.stamina = stamina; H.guts *= 0.45;
    race.step(1 / 30);
    return H;
  }
  const empty = run(0), almost = run(0.001);
  near(empty.v, almost.v, 0.005, 'crossing reserve zero cannot unlock a new speed mode');
  assert.ok(empty.v > 15.5, 'energy exhaustion cannot instantly collapse velocity');
  for (const H of [empty, almost]) assert.ok(reserves(H).every((value) => value >= 0 && value <= 1));
});

test('actual nearby contention can end when the horses separate', () => {
  const race = makeRace([horse('a', '逃'), horse('rival', '逃')]), [H, F] = race.race.horses;
  const s = segment(race.race.geo, false);
  hold(H, { s: s + 3, t: 3, v: 17 }); hold(F, { s, t: 17, v: 17 });
  race.step(1 / 30);
  assert.equal(race.race.paceContest, 1, 'nearby competing escape horse must count as actual contention');
  F.s = H.s - 60;
  race.step(1 / 30);
  assert.equal(race.race.paceContest, 0, 'a distant escape horse cannot keep the contest frozen all race');
});

test('the rider chooses sprint timing from remaining reserve, not a shared phase gate', () => {
  function launch(reserve) {
    const race = makeRace(), H = race.race.horses[0];
    Object.assign(H, { s: 1400, t: 10, targetT: 10, v: 17, prevV: 17,
      lastObserve: 0, startDelay: 0, stamina: H.staminaMax * reserve });
    // This fixture is already galloping after 60 seconds, with established oxygen supply.
    H.aerobicOutput = H.aerobic * H.retention;
    race.race.t = 60;
    race.step(1 / 30);
    return H.sprintAt;
  }
  assert.ok(Number.isFinite(launch(1)), 'a horse with enough reserve should launch for the remaining distance');
  assert.equal(launch(0.01), null, 'a depleted horse must not receive the same automatic sprint command');
});

test('drafting saves work only behind a nearby horse in the same corridor', () => {
  function run(frontLane, gap = 7) {
    const race = makeRace([horse('a'), horse('front')]), [H, F] = race.race.horses;
    const s = segment(race.race.geo, false);
    hold(H, { s, t: 3, v: 17 }); hold(F, { s: s + gap, t: frontLane, v: 17 });
    advance(race, 0.5);
    return { draft: H.drafting, work: H.statsSummary.workUsed, used: H.statsSummary.energyUsed,
      seconds: H.statsSummary.draftSeconds };
  }
  const nearLane = run(3), acrossTrack = run(17), farAhead = run(3, 80);
  assert.equal(nearLane.draft, true); assert.equal(acrossTrack.draft, false); assert.equal(farAhead.draft, false);
  assert.ok(nearLane.work < acrossTrack.work, 'physical shelter must save actual work');
  assert.ok(nearLane.used < acrossTrack.used, 'shelter must also save short-term reserve');
  assert.ok(nearLane.seconds > 0 && acrossTrack.seconds === 0 && farAhead.seconds === 0);
});

test('a blocked horse must clear the body corridor before passing', () => {
  const race = makeRace([horse('a'), horse('front')]), [H, F] = race.race.horses;
  const s = segment(race.race.geo, false);
  // Begin inside the feasible following domain. A faster injected rear horse
  // only 4m behind a 12m/s front horse requires an impossible instantaneous stop.
  hold(H, { s, t: 10, v: 12, targetV: 19 }); hold(F, { s: s + 4, t: 10, v: 12 });
  let blocked = false;
  for (let i = 0; i < 30; i++) {
    race.step(1 / 30); blocked ||= H.blocked;
    const clearance = (2.25 + 0.55 * H.adj['体格'] / 100 + 2.25 + 0.55 * F.adj['体格'] / 100) / 2;
    assert.ok(F.s - H.s >= clearance - 1e-6, 'longitudinal bodies cannot overlap in one lane');
  }
  assert.ok(blocked && H.statsSummary.blockedSeconds > 0, 'fixture must encounter a real block');
  H.control.targetT = 14;
  let passedFront = false;
  for (let i = 0; i < 300; i++) {
    race.step(1 / 30);
    if (H.s > F.s) {
      const width = (0.65 + 0.15 * H.adj['体格'] / 100 + 0.65 + 0.15 * F.adj['体格'] / 100) / 2;
      assert.ok(Math.abs(H.t - F.t) >= width, 'passing requires a physically clear transverse lane');
      passedFront = true; break;
    }
  }
  assert.ok(passedFront, 'a faster horse must be able to pass once it has a clear lane');
});

test('side-by-side horses cannot exchange lanes through one another', () => {
  const race = makeRace([horse('a'), horse('b')]), [H, F] = race.race.horses;
  const s = segment(race.race.geo, false);
  hold(H, { s, t: 8, v: 16 }); hold(F, { s, t: 10.5, v: 16 });
  H.control.targetT = 13; F.control.targetT = 5;
  const halfWidth = 0.65 + 0.15 * (H.adj['体格'] + F.adj['体格']) / 200;
  for (let i = 0; i < 60; i++) {
    race.step(1 / 30);
    assert.ok(Math.abs(H.s - F.s) < 1, 'fixture must keep the longitudinal body intervals overlapping');
    assert.ok(F.t - H.t >= halfWidth - 1e-8, 'lateral steering cannot cross a neighboring body');
  }
});

test('control trajectories converge with a smaller integration timestep', () => {
  function run(dt) {
    const race = makeRace(), H = race.race.horses[0];
    hold(H, { s: 100, v: 0, targetV: 18 });
    advance(race, 30, dt);
    return { H, reserve: reserves(H) };
  }
  // The finer call must also reduce the engine's internal integration step;
  // comparing 1/30 with 1/60 alone would exercise identical substeps.
  const coarse = run(1 / 30), fine = run(1 / 120);
  near(coarse.H.s, fine.H.s, 0.5, 'physical progress must converge');
  near(coarse.H.v, fine.H.v, 0.02, 'velocity must converge');
  coarse.reserve.forEach((value, i) => near(value, fine.reserve[i], 0.005, 'reserve integration must converge'));
});

test('finish order and winning margins interpolate all horses at the winning instant', () => {
  const race = makeRace([horse('a'), horse('b')]), [H, F] = race.race.horses;
  race.race.t = 100;
  // Isolate the finish interpolation from the separately tested oxygen onset.
  H.aerobicOutput=H.aerobic; F.aerobicOutput=F.aerobic;
  hold(H, { s: 1999.95, t: 3, v: 18 }); hold(F, { s: 1999.94, t: 17, v: 17 });
  race.step(1 / 60);
  assert.deepEqual(race.race.order.map((entrant) => entrant.id), ['a', 'b']);
  near(H.time, 100 + 0.05 / 18, 1e-9, 'winner time must use fractional crossing');
  near(F.time, 100 + 0.06 / 17, 1e-9, 'second time must use its own fractional crossing');
  near(F.gapAtWin, 0.06 - 17 * (H.time - 100), 1e-8,
    'a horse finishing later in the same frame must retain its full projected movement');
  assert.equal(H.gapAtWin, 0);
});

test('a non-200m final section is recorded for both horse and race leaders', () => {
  const race = makeRace([horse('a'), horse('b', '先', 40)], { length: 2500 });
  const [H, F] = race.race.horses;
  hold(H, { s: 0, t: 1.4, v: 0, targetV: 17 }); hold(F, { s: 0, t: 17, v: 0, targetV: 14 });
  for (let i = 0; !H.place && i < 20000; i++) race.step(1 / 30);
  assert.equal(H.place, 1); assert.equal(F.place, null, 'fixture must retain an active runner when the winner crosses');
  assert.equal(H.sectionals.length, 13, '2500m must include twelve 200m sections and the last 100m');
  assert.equal(race.race.sectionals.length, 13, 'leader diagnostics must include the last partial section');
  for (const sections of [H.sectionals, race.race.sectionals]) {
    assert.equal(sections.at(-1).distance, 2500);
    near(sections.at(-1).time, H.time, 1e-8, 'partial final crossing must coincide with winning time');
    near(sections.reduce((sum, section) => sum + section.split, 0), H.time, 1e-8,
      'including the partial section must account for all elapsed race time');
  }
  const last = race.race.sectionals.at(-1), referenceV = S.baseSpeed(70) * Math.cbrt(S.RACE_F.aerobicBase);
  near(race.race.paceStrength, (100 / last.split) / referenceV, 1e-9,
    'the final pace must use its actual 100m distance rather than doubling it to 200m');
});

test('200m sectionals and diagnostics account for the complete race', () => {
  const race = makeRace(), H = race.race.horses[0];
  for (let i = 0; !race.race.finished && i < 20000; i++) race.step(1 / 30);
  assert.equal(race.race.finished, true); assert.equal(H.place, 1);
  assert.ok(H.time > 80 && H.time < 180, '2000m race time must remain within a plausible simulation range');
  assert.equal(H.sectionals.length, 10, 'every completed 200m split must be recorded');
  const splitTimes = H.sectionals.map((section) => typeof section === 'number' ? section : section.time);
  assert.ok(splitTimes.every((value) => Number.isFinite(value) && value > 0), 'sectionals must have finite elapsed times');
  assert.ok(splitTimes.every((time, i) => i === 0 || time > splitTimes[i - 1]), 'crossing times must increase');
  near(splitTimes.at(-1), H.time, 1e-8, 'last sectional crossing must be the finish time');
  near(H.sectionals.reduce((sum, section) => sum + section.split, 0), H.time, 1e-8, '200m splits must sum to the finish time');
  assert.ok(Number.isFinite(H.statsSummary.energyUsed) && H.statsSummary.energyUsed > 0);
  assert.ok(Number.isFinite(H.statsSummary.workUsed) && H.statsSummary.workUsed > 0);
  near(H.statsSummary.workUsed, H.cumulativeWork, 1e-8, 'diagnostic work must match the engine accumulator');
  assert.ok(H.statsSummary.peakSpeed > 15 && H.statsSummary.peakSpeed < 25);
});

test('empty reserves cannot leave unpaid work at official hill joins or the lap boundary', () => {
  const courses = ['東京芝A', '中山芝内A', '京都芝外A', '阪神芝外A', '新潟芝外A'];
  let probes = 0;
  for (const course of courses) for (const wind of [-12, 0, 12]) for (const v of [10, 12, 14, 16, 18]) {
    const proto = makeRace([horse('a')], { length: 5000, course, wind });
    const joins = [...proto.race.geo.elevationProfile.slice(1, -1).map(point => point[0]), 0];
    for (const join of joins) for (const epsilon of [-1e-5, 1e-5]) {
      const r = makeRace([horse('a')], { length: 5000, course, wind }), H = r.race.horses[0], dt = 1 / 120;
      const lap = r.race.geo.lap;
      const boundary = ((join - r.race.geo.startOffset) % lap + lap) % lap + lap;
      // Straddle the previous old-speed midpoint estimate, including both sides of a sharp slope join.
      hold(H, { s: boundary - v * S.laneProgressCoef(boundary, 10, r.race.geo) * dt / 2 + epsilon,
        t: 10, v, targetV: 23 });
      H.stamina = 0; H.aerobicOutput = H.aerobic; r.race.t = 60;
      r.step(dt); probes++;
      assert.ok(H.power <= H.aerobicOutput + 1e-5,
        course + ': zero reserve must pay actual path work from aerobic supply, including a slope crossing');
      assert.ok(H.statsSummary.unpaidWork <= 1e-5);
      near(H.statsSummary.workUsed, H.statsSummary.aerobicUsed + H.statsSummary.energyUsed, 1e-5,
        'actual work must be covered by recorded supply and reserve draw');
      assert.ok(Number.isFinite(H.v) && H.v >= 0 && H.stamina >= 0);
    }
  }
  assert.ok(probes >= 690, 'the probe must cover all five official layouts and both sides of their joins');
});

test('outer lanes pay actual gained gravitational potential rather than charging the longer arc twice', () => {
  function paired(lane) {
    const hill = makeRace([horse('a')], { length: 5000, course: '京都芝外A' });
    const flat = makeRace([horse('a')], { length: 5000, course: '京都芝外A' });
    flat.race.geo.elevationProfile = null; // Same geometry and resistance, with only height removed.
    const geo = hill.race.geo, at = ((1420 - geo.startOffset) % geo.lap + geo.lap) % geo.lap;
    const H = hill.race.horses[0], F = flat.race.horses[0];
    hold(H, { s: at, t: lane, v: 16 }); hold(F, { s: at, t: lane, v: 16 });
    H.aerobicOutput = H.aerobic; F.aerobicOutput = F.aerobic; hill.race.t = flat.race.t = 60;
    const beforeHeight = S.elevationAt(H.s, geo, hill.race.g);
    advance(hill, 1); advance(flat, 1);
    near(H.s, F.s, 1e-8, 'removing height must not change this deliberately unpowered-limited constant-speed path');
    near(H.v, 16, 1e-8); near(F.v, 16, 1e-8);
    const heightGain = S.elevationAt(H.s, geo, hill.race.g) - beforeHeight;
    assert.ok(heightGain > 0.1, 'the fixture must climb a genuine official-layout slope');
    const addedWork = H.statsSummary.workUsed - F.statsSummary.workUsed;
    near(addedWork, 9.81 * heightGain * H.massRatio, 1e-7,
      'extra climbing work must equal gained gravitational potential on the actual path');
    return { addedWork, heightGain };
  }
  const inner = paired(3), outer = paired(17);
  assert.ok(outer.heightGain < inner.heightGain && outer.addedWork < inner.addedWork,
    'at equal physical speed an outer arc advances less of the shared height profile per second');
});

test('synchronous steering and following keep actual work fully paid with bounded reserves', () => {
  for (const course of ['标准', '東京芝A', '中山芝内A']) for (const reserve of [0, 1, 1500]) {
    const r = makeRace([horse('a'), horse('front'), horse('side')], { length: 5000, course, wind: 8 });
    const [H, F, side] = r.race.horses;
    hold(H, { s: 700, t: 10, v: 12, targetV: 23 });
    hold(F, { s: 704, t: 10, v: 12 }); hold(side, { s: 701, t: 13, v: 12 });
    H.stamina = reserve; H.control.targetT = 17; r.race.t = 60;
    for (const runner of r.race.horses) runner.aerobicOutput = runner.aerobic;
    advance(r, 4);
    assert.ok(H.statsSummary.blockedSeconds > 0, 'the coupled probe must encounter a real forward block');
    for (const runner of r.race.horses) {
      const stats = runner.statsSummary;
      assert.ok(stats.unpaidWork <= 1e-5, 'neither steering nor a collision correction can leave energy debt');
      near(stats.workUsed, stats.aerobicUsed + stats.energyUsed, 1e-5,
        'coupled-path work must reconcile with actual supply and reserve draw');
      assert.ok(runner.stamina >= 0 && runner.stamina <= runner.staminaMax);
    }
  }
});

console.log('\n' + passed + ' continuous race physics checks passed.');
if (failed) { console.error(failed + ' checks failed.'); process.exitCode = 1; }
