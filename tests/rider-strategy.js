#!/usr/bin/env node
'use strict';

// Exercise rider decisions through the real race engine. No policy equation is duplicated.
const assert = require('node:assert/strict');
const S = require('../sim.js');
const Save = require('../career-save.js');
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function horse(id, extras = {}) {
  const h = S.makeHorse(() => 0.5, { id, name: id, style: '先', '斗志': 50, '疲劳': 0,
    jockeyGrade: '优秀', surface: '草地', special: '左右皆可',
    physiology: S.neutralPhysiology(),
    behavior: { forwardness: 0.5, settle: 0.7, tractability: 0.8 },
    racePlan: { position: 0.5, risk: 0.5, patience: 0.7 } });
  for (const key of Object.keys(h.stats)) h.stats[key] = 70;
  return Object.assign(h, { behavior: { forwardness: 0.5, settle: 0.7, tractability: 0.8 },
    racePlan: { position: 0.5, risk: 0.5, patience: 0.7 } }, extras);
}
function race(field = [horse('a')], options = {}) {
  return S.createRace(field, { length: 2000, profile: '平坦', rng: () => 0.5, ...options });
}
function setRunner(H, s, t, v = 17) {
  Object.assign(H, { s, t, targetT: t, v, prevV: v, targetV: v, lastObserve: 0,
    startDelay: 0, laneIntentT: 0, blocked: false, blocker: null });
  H.aerobicOutput = H.aerobic * H.retention; // Already galloping, rather than a fresh gate start.
}
function runSeconds(r, seconds) {
  for (let i = 0; i < Math.round(seconds * 30) && !r.race.finished; i++) r.step(1 / 30);
}
function near(a, b, tolerance = 1e-9) {
  assert.ok(Math.abs(a - b) <= tolerance, a + ' differs from ' + b);
}

test('changing historical style labels leaves identical horse decisions and outcomes unchanged', () => {
  function run(style) {
    const field = [horse('a'), horse('b'), horse('c'), horse('d')];
    for (const h of field) h.style = style;
    const r = race(field, { length: 1600, rng: S.mulberry32(98761) });
    while (!r.race.finished && r.race.t < 240) r.step(1 / 30);
    assert.ok(r.race.finished, 'all runners must finish');
    return r.race.horses.map(H => ({ time: H.time, reserve: H.stamina, lane: H.t,
      work: H.statsSummary.workUsed, strategy: H.strategyHistory, launches: H.statsSummary.launches || 0 }));
  }
  const baseline = run('逃');
  for (const style of ['先', '差', '追']) assert.deepEqual(run(style), baseline,
    'a descriptive label cannot select a position, trigger an attack, or change physical energy');
});

test('saved horse profiles survive normal roster entries and remain detached from live race objects', () => {
  const rng = S.mulberry32(337715), stock = S.makeBaseBreedingStock(rng);
  const h = S.makeRosterHorse(rng, 4, 12, stock);
  Object.assign(h, { behavior: { forwardness: 0.18, settle: 0.76, tractability: 0.84 },
    racePlan: { position: 0.2, risk: 0.25, patience: 0.9 }, bodyMass: 480, carriedWeight: 60 });
  const snapshot = { bankroll: 100, careerStaff: S.makeStaff(rng), career: {
    roster: [h], breedingStock: stock, date: { year: 1968, week: 1 }, weekNum: 1,
    aiRaces: [], intel: [], weekBets: {}, startedIds: {}, watchedIds: {}, settledIds: {}, betTypes: {},
    stats: { bets: 0, hits: 0, profit: 0 }, debug: false, recap: null, watchInfo: null },
    breedState: { sireId: null, damId: null, foal: null }, raceCount: 0 };
  const values = new Map(), storage = { getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value) };
  assert.ok(Save.save(storage, snapshot).ok);
  const loaded = Save.load(storage);
  assert.ok(loaded.ok);
  const restored = loaded.snapshot.career.roster[0];
  const entry = S.rosterEntry(restored, S.mulberry32(9021));
  for (const key of ['behavior', 'racePlan', 'bodyMass', 'carriedWeight']) assert.deepEqual(entry[key], h[key]);
  const r = race([entry]), H = r.race.horses[0];
  assert.deepEqual(H.behavior, h.behavior); assert.deepEqual(H.plan, h.racePlan);
  assert.equal(H.bodyMass, 480); assert.equal(H.carriedWeight, 60);
  const lighterEntry = JSON.parse(JSON.stringify(entry)); lighterEntry.carriedWeight = 57;
  const lighter = race([lighterEntry]).race.horses[0];
  assert.ok(H.powerFor(16, 0, false, 100) > lighter.powerFor(16, 0, false, 100),
    'the carried weight copied from the saved horse must change actual shared power demand');
  entry.behavior.forwardness = 0.95; entry.racePlan.position = 0.95;
  entry.stats['速度'] += 3; entry.bodyMass = 500;
  assert.deepEqual(restored.behavior, h.behavior); assert.deepEqual(restored.racePlan, h.racePlan);
  assert.equal(restored.stats['速度'], h.stats['速度']); assert.equal(restored.bodyMass, 480);
  assert.equal(H.behavior.forwardness, 0.18); assert.equal(H.plan.position, 0.2,
    'race policy objects must also be detached from later entry mutations');
});

test('tractability copied through a roster entry changes response to an identical real instruction', () => {
  function response(tractability) {
    const h = horse('saved-profile'); h.behavior.tractability = tractability;
    const entry = S.rosterEntry(h, () => 0.5);
    const r = race([entry]), H = r.race.horses[0];
    setRunner(H, 100, 10, 16); H.control = { targetV: 18, targetT: 10 }; r.race.t = 30;
    runSeconds(r, 0.3); return H.v;
  }
  assert.ok(response(1) > response(0) + 0.03,
    'a more tractable horse must react faster through actual motion, without receiving extra target speed');
});

test('generation varies continuous profiles across seeds while historical labels remain neutral', () => {
  const profiles = [9, 2718, 104729].map(seed => S.makeField(S.mulberry32(seed), { n: 8, level: 70 })[0].behavior);
  assert.equal(new Set(profiles.map(x => JSON.stringify(x))).size, profiles.length,
    'reused field slots must not force every newly generated horse to have the same personality');
  function signature(style) {
    const h = S.makeHorse(S.mulberry32(912837), { id: 'same-slot', style, level: 70 });
    return { stats: h.stats, behavior: h.behavior, bodyMass: h.bodyMass, carriedWeight: h.carriedWeight };
  }
  const baseline = signature('逃');
  for (const label of ['先', '差', '追']) assert.deepEqual(signature(label), baseline);
});

test('independent race plans influence a nearby positioning opportunity', () => {
  function command(position) {
    const r = race([horse('a', { racePlan: { position, risk: 0.5, patience: 0.8 } }), horse('front')], { length: 3200 });
    const [H, F] = r.race.horses;
    setRunner(H, 500, 3, 16); setRunner(F, 504, 14, 15.2);
    F.control = { targetV: 15.2, targetT: 14 }; r.race.t = 30;
    r.step(1 / 30);
    return { target: H.targetV, ceiling: H.maxV, H };
  }
  const patient = command(0), forward = command(1);
  assert.ok(forward.target > patient.target + 0.1, 'forward instructions should affect nearby positioning');
  near(forward.ceiling, patient.ceiling);
  assert.ok(forward.target <= forward.ceiling, 'instructions cannot manufacture extra speed capacity');
});

test('drafting does not trap a horse behind an uneconomically slow nearby pace', () => {
  function command(frontPace) {
    const r = race([horse('a'), horse('front')], { length: 3200 }), [H, F] = r.race.horses;
    setRunner(H, 500, 3, 16); setRunner(F, 509, 3, frontPace);
    F.control = { targetV: frontPace, targetT: 3 }; r.race.t = 30;
    r.step(1 / 30);
    return H;
  }
  const slow = command(14.8);
  assert.ok(slow.followOpportunity.regainCost > slow.followOpportunity.saving,
    'the controlled slower pace must cost more to recover than its shelter saves');
  assert.notEqual(slow.strategy.mode, 'follow');
  assert.ok(slow.targetV > 15.2, 'the rider must retain its affordable forward pace');
});

test('a remote leader does not force a horse to chase a fixed ideal gap', () => {
  function command(remote) {
    const r = race(remote ? [horse('a'), horse('remote')] : [horse('a')]);
    const H = r.race.horses[0]; setRunner(H, 500, 10);
    if (remote) {
      const F = r.race.horses[1]; setRunner(F, 750, 18, 19);
      F.control = { targetV: 19, targetT: 18 };
    }
    r.race.t = 30; r.step(1 / 30);
    return { target: H.targetV, reserve: H.stamina, work: H.power };
  }
  const alone = command(false), remote = command(true);
  for (const key of ['target', 'reserve', 'work']) near(alone[key], remote[key]);
});

test('an attack can be withdrawn and launched again after the estimated situation changes', () => {
  const r = race(), H = r.race.horses[0];
  setRunner(H, 1820, 10, 17); r.race.t = 95;
  r.step(1 / 30);
  assert.equal(H.attacking, true, 'ample reserve near the finish should support an attack');
  assert.equal(H.statsSummary.launches, 1);
  const first = H.sprintAt;
  H.stamina = H.staminaMax * 0.001; H.lastObserve = 0;
  r.step(1 / 30);
  assert.equal(H.attacking, false, 'depleted reserves must cancel the previous attack');
  assert.equal(H.statsSummary.withdrawals, 1);
  assert.ok(H.targetV < H.maxV, 'withdrawal must change the actual command');
  // This controlled perturbation isolates replanning; the game does not refill reserves this way.
  H.stamina = H.staminaMax * 0.65; H.lastObserve = 0;
  r.step(1 / 30);
  assert.equal(H.attacking, true, 'replanning must permit another attack');
  assert.equal(H.statsSummary.launches, 2);
  assert.equal(H.sprintAt, first, 'the legacy field remains the first attack only');
});

test('a closed passing corridor makes the rider wait rather than request a body crossing', () => {
  const r = race([horse('a'), horse('front'), horse('inside'), horse('outside')]);
  const [H, F, I, O] = r.race.horses;
  setRunner(H, 1820, 10, 12); setRunner(F, 1824, 10, 12);
  setRunner(I, 1820, 8.5, 12); setRunner(O, 1820, 11.5, 12);
  for (const other of [F, I, O]) other.control = { targetV: other.v, targetT: other.t };
  r.race.t = 95; r.step(1 / 30);
  assert.equal(H.attacking, false);
  assert.equal(H.strategy.mode, 'follow');
  assert.ok(H.targetV <= F.v + 0.3, 'waiting should reduce the command to the available forward space');
  near(H.targetT, 10);
});

test('a rider can pass a slower nearby horse through an open corridor', () => {
  const r = race([horse('a'), horse('front')]), [H, F] = r.race.horses;
  setRunner(H, 500, 10, 14); setRunner(F, 505, 10, 14);
  F.control = { targetV: 12, targetT: 10 }; r.race.t = 30;
  let passedFront = false;
  for (let i = 0; i < 450 && !r.race.finished; i++) {
    r.step(1 / 30);
    if (H.s > F.s) {
      assert.ok(Math.abs(H.t - F.t) >= 1.0, 'passing must have a physically separate corridor');
      passedFront = true; break;
    }
  }
  assert.ok(passedFront, 'a sufficiently faster runner should convert an open route into a pass');
  assert.ok(H.statsSummary.blockedSeconds > 0, 'the fixture must first encounter the front horse');
});

test('rider observation cadence holds a command between observations and then replans', () => {
  const r = race(), H = r.race.horses[0];
  setRunner(H, 1820, 10); r.race.t = 95; r.step(1 / 30);
  const commanded = H.targetV, decisions = H.statsSummary.decisions;
  H.stamina = H.staminaMax * 0.001; H.lastObserve = 0.5;
  runSeconds(r, 0.3);
  near(H.targetV, commanded);
  assert.equal(H.statsSummary.decisions, decisions, 'the rider cannot observe every physics frame');
  runSeconds(r, 0.3);
  assert.ok(H.statsSummary.decisions > decisions);
  assert.ok(H.targetV < commanded, 'the next real observation must reconsider the depleted reserve');
});

test('observed running style and decision replay are derived from actual positions', () => {
  const r = race([horse('a', { style: '追' }), horse('behind')]), [H, F] = r.race.horses;
  setRunner(H, 500, 3); setRunner(F, 470, 15);
  F.control = { targetV: 17, targetT: 15 }; r.race.t = 30;
  r.step(1 / 30);
  assert.equal(H.observedStyle, '逃', 'a horse actually leading must not retain its historical rearward label');
  assert.equal(H.statsSummary.positionSamples, 1);
  assert.equal(H.statsSummary.meanPosition, 0);
  const decision = H.strategyHistory.at(-1);
  assert.ok(Number.isFinite(decision.reserveEstimate) && Number.isFinite(decision.observedPace));
  assert.ok(typeof decision.reason === 'string' && decision.reason.length > 0);
  runSeconds(r, 3);
  assert.ok(H.strategyHistory.length > 1 && H.strategyHistory.length <= 80);
});

test('actual close contention ignores historical style and ends after separation', () => {
  const r = race([horse('a', { style: '追' }), horse('rival', { style: '差' })]), [H, F] = r.race.horses;
  setRunner(H, 503, 3); setRunner(F, 500, 17);
  H.control = { targetV: 19, targetT: 3 }; F.control = { targetV: 19, targetT: 17 };
  r.race.t = 30; r.step(1 / 30);
  assert.equal(r.race.paceContest, 1);
  F.s = H.s - 60; r.step(1 / 30);
  assert.equal(r.race.paceContest, 0);
});

console.log('\n' + passed + ' rider strategy tests passed; ' + failed + ' failed.');
if (failed) process.exitCode = 1;
