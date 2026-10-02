#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const S = require('../sim.js');
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function near(a, b, tolerance = 1e-7) {
  assert.ok(Math.abs(a - b) <= tolerance, a + ' should be near ' + b);
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function horse(id, style = '先', value = 70) {
  const h = S.makeHorse(() => 0.5, {
    id, style, '斗志': 50, '疲劳': 0, jockeyGrade: '普通',
    surface: '草地', special: '左右皆可', aggression: 1,
  });
  for (const key of Object.keys(h.stats)) h.stats[key] = value;
  return h;
}
function makeRace(field = [horse('a')], options = {}) {
  return S.createRace(field, { length: 2000, profile: '平坦', rng: () => 0.5, ...options });
}
// Place real engine entrants at controlled points and hold observation steady;
// their speed, energy use, geometry, and collisions still use the real engine.
function pose(H, s, t, observe = Infinity, v = 16) {
  Object.assign(H, { s, t, v, prevV: v, targetV: v, targetT: t, laneJitter: 0, laneIntentT: 0,
    action: null, actionT: 0, lastObserve: observe, startDelay: 0 });
}
function curvePoint(geo, length = 2000, last = false) {
  for (let i = 20; i < length - 20; i += 10) {
    const s = last ? length - i : i;
    if (S.kAt(s - 10, geo) > 0 && S.kAt(s + 10, geo) > 0) return s;
  }
  throw new Error('fixture must contain an interior curve');
}
function straightPoint(geo, length = 2000) {
  for (let s = 30; s < length - 30; s += 10) {
    if (S.kAt(s - 10, geo) === 0 && S.kAt(s + 10, geo) === 0) return s;
  }
  throw new Error('fixture must contain an interior straight');
}
function putBlock(H, F, s, t, observe = 0) {
  const halfLength = 2.25 + 0.55 * (H.adj['体格'] + F.adj['体格']) / 200;
  pose(H, s, t, observe, 18);
  pose(F, s + halfLength + 0.02, t, Infinity, 12);
}
function withParameter(key, value, run) {
  const previous = S.RACE_F[key];
  try { S.RACE_F[key] = value; run(); }
  finally { S.RACE_F[key] = previous; }
}

test('track is continuous, preserves width, and mirrors both directions', () => {
  for (const length of [1200, 2000, 3200]) {
    const geo = S.trackGeometry(length);
    const boundaries = geo.boundaries.map((boundary) => boundary.s);
    for (const s of boundaries) for (const t of [1, S.TRACK_WIDTH / 2, S.TRACK_WIDTH - 1]) {
      assert.ok(distance(S.trackPoint(s - 1e-6, t, geo), S.trackPoint(s + 1e-6, t, geo)) < 3e-6,
        'a horse must not teleport at a straight/curve join');
    }
    for (const s of [0, ...boundaries.map((value) => value + 1), length]) {
      near(distance(S.trackPoint(s, 0, geo), S.trackPoint(s, S.TRACK_WIDTH, geo)), S.TRACK_WIDTH);
      const left = S.trackPoint(s, 7, geo, '左回'), right = S.trackPoint(s, 7, geo, '右回');
      near(left.x, -right.x); near(left.y, right.y);
    }
  }
});

test('reported curvature matches measured centerline curvature', () => {
  const geo = S.trackGeometry(2000), center = S.TRACK_WIDTH / 2, delta = 0.02;
  for (const s of [straightPoint(geo), curvePoint(geo), curvePoint(geo, 2000, true)]) {
    const before = S.trackPoint(s - delta, center, geo), point = S.trackPoint(s, center, geo);
    const after = S.trackPoint(s + delta, center, geo);
    const dx = (after.x - before.x) / (2 * delta), dy = (after.y - before.y) / (2 * delta);
    const ddx = (after.x - 2 * point.x + before.x) / (delta * delta);
    const ddy = (after.y - 2 * point.y + before.y) / (delta * delta);
    const measured = Math.abs(dx * ddy - dy * ddx) / Math.pow(dx * dx + dy * dy, 1.5);
    near(measured, S.kAt(s, geo), 1e-7);
  }
});

test('race distance changes the gate position rather than resizing the course', () => {
  const short = S.trackGeometry(1200), long = S.trackGeometry(3200);
  near(short.R, long.R); near(short.S, long.S); near(short.lap, long.lap);
  const shortFinish = S.trackPoint(1200, 10, short), longFinish = S.trackPoint(3200, 10, long);
  near(distance(shortFinish, longFinish), 0, 1e-8);
  assert.ok(short.boundaries.every(({ s }) => s >= 0 && s <= 1200));
  assert.ok(long.boundaries.every(({ s }) => s >= 0 && s <= 3200));
});

test('the advertised race distance follows its physical reference line', () => {
  for (const course of ['标准', '长直道', '小回り']) for (const length of [1200, 2000, 3200]) {
    const geo = S.trackGeometry(length, course), step = 0.2;
    let before = S.trackPoint(0, geo.referenceLane, geo), measured = 0;
    for (let s = step; s < length + step / 2; s += step) {
      const after = S.trackPoint(Math.min(s, length), geo.referenceLane, geo);
      measured += distance(before, after); before = after;
    }
    near(measured, length, 0.005);
  }
});

test('pure lane geometry preserves actual speed across lanes', () => withParameter('laneBias', 1, () => {
  for (const dir of ['左回', '右回']) {
    const race = makeRace(['a', 'b', 'c'].map((id) => horse(id)), { dir });
    const s = curvePoint(race.race.geo);
    race.race.horses.forEach((H, i) => pose(H, s, [3, S.TRACK_WIDTH / 2, S.TRACK_WIDTH - 3][i]));
    const before = race.race.horses.map((H) => S.trackPoint(H.s, H.t, race.race.geo, dir));
    race.step(0.001);
    // Measure world-space travel from the renderer, not an algebraic copy of
    // laneProgressCoef. Equal physical speed must yield equal arc travel.
    const travelPerSpeed = race.race.horses.map((H, i) =>
      distance(before[i], S.trackPoint(H.s, H.t, race.race.geo, dir)) / H.v);
    travelPerSpeed.forEach((value) => near(value, travelPerSpeed[1], 1e-9));
    travelPerSpeed.forEach((value) => near(value, 0.001, 1e-9));
    assert.ok(race.race.horses[0].s > race.race.horses[1].s);
    assert.ok(race.race.horses[1].s > race.race.horses[2].s);
  }
}));

test('geometry neutral settings preserve equal progress', () => withParameter('laneBias', 0, () => {
  const geo = S.trackGeometry(2000);
  for (const t of [1, 10, 19]) for (const s of [straightPoint(geo), curvePoint(geo)]) {
    near(S.laneProgressCoef(s, t, geo), 1);
  }
}));

// Finite acceleration and continuous reserves are exercised against actual
// engine trajectories in race-physics.js, replacing the obsolete bonus/stage
// lock helper checks that could pass without controlling the new engine.

test('all steering respects lateral speed, track edges, and the target', () => {
  for (const action of [null, '推骑', '斜行in', '斜行out']) for (const goal of [3, 17]) {
    const race = makeRace(), H = race.race.horses[0];
    const initial = goal === 3 ? 17 : 3;
    pose(H, 500, initial); H.targetT = goal; H.action = action; H.actionT = 100;
    for (let i = 0; i < 12; i++) {
      const before = H.t; race.step(1 / 30);
      assert.ok(Math.abs(H.t - before) <= S.RACE_F.lateralSpeed / 30 + 1e-10);
      assert.ok(H.t >= Math.min(initial, goal) && H.t <= Math.max(initial, goal));
    }
    H.targetT = H.t + (goal === 3 ? -0.005 : 0.005);
    const closeGoal = H.targetT; race.step(1 / 30); near(H.t, closeGoal);
    race.step(1 / 30); near(H.t, closeGoal, 1e-12);
  }
});

test('unblocked AI selects a legal economical line on every bend', () => {
  for (const style of ['逃', '先', '差', '追']) {
    function target(s) {
      const race = makeRace([horse('a', style)]), H = race.race.horses[0];
      pose(H, s(race.race.geo), 17, 0);
      race.step(0.001); return H.targetT;
    }
    const bend = target((geo) => curvePoint(geo));
    const lastBend = target((geo) => curvePoint(geo, 2000, true));
    assert.ok(bend < 17 && bend >= 0.7, style + ': clear bend should permit legal inward steering');
    assert.ok(lastBend < 17 && lastBend >= 0.7, style + ': final bend must retain economical legal steering');
  }
});

test('gap selection accounts for the entrant body, not only its center', () => {
  const race = makeRace([horse('a', '追'), horse('b'), horse('c')]);
  const [H, first, second] = race.race.horses;
  pose(H, 1360, 10, 0); pose(first, 1370, 9); pose(second, 1370, 11);
  race.step(0.001);
  for (const blocker of [first, second]) {
    const combinedHalfWidth = 1 + 0.3 * (H.adj['体格'] + blocker.adj['体格']) / 200;
    assert.ok(Math.abs(H.targetT - blocker.t) >= combinedHalfWidth,
      'selected gap must fit both physical bodies without overlap');
  }
});

test('an immediate blocker produces a real escape route', () => {
  const race = makeRace([horse('a', '先', 100), horse('b', '先', 40)]);
  const [H, blocker] = race.race.horses;
  putBlock(H, blocker, straightPoint(race.race.geo), 7.5);
  race.step(0.01);
  assert.ok(H.blocked, 'fixture must exercise an actual collision block');
  const combinedHalfWidth = 1 + 0.3 * (H.adj['体格'] + blocker.adj['体格']) / 200;
  assert.ok(Math.abs(H.targetT - blocker.t) >= combinedHalfWidth,
    'the closest blocker cannot be ignored when choosing an escape lane');
  assert.equal(H.action, H.targetT < H.t ? '斜行in' : '斜行out');
});

test('an escape keeps its unfinished lane intent across AI observations', () => {
  const race = makeRace([horse('a', '先', 100), horse('b', '先', 40)]);
  const [H, blocker] = race.race.horses;
  putBlock(H, blocker, 1320, 10);
  race.step(0.01);
  assert.ok(H.blocked && Math.abs(H.targetT - H.t) > 1, 'fixture must begin a real escape');
  const intended = H.targetT;
  for (let i = 0; i < 3; i++) {
    blocker.t = 18; blocker.targetT = 18;
    H.lastObserve = 0; race.step(0.001);
    assert.ok(H.laneIntentT > 0);
    near(H.targetT, intended, 1e-12);
  }
});

test('a new escape replaces an obsolete opposite steering action', () => {
  const race = makeRace([horse('a', '先', 100), horse('b', '先', 40)]);
  const [H, blocker] = race.race.horses;
  putBlock(H, blocker, 1320, 1.1);
  H.targetT = 0.9; H.action = '斜行in'; H.actionT = 1;
  race.step(0.01);
  assert.ok(H.blocked && H.targetT > H.t, 'near the inner edge escape must go outside');
  assert.equal(H.action, '斜行out', 'new tactical intent must replace an opposite old action');
  const before = H.t; H.lastObserve = Infinity; race.step(0.001);
  assert.ok(H.t > before && H.t <= H.targetT);
});

test('clearing a block cannot reverse the action of an unfinished outward route', () => {
  const race = makeRace([
    horse('a', '先', 100), horse('block', '先', 40), horse('inner', '先', 40),
    ...['c', 'd', 'e', 'f', 'g'].map((id) => horse(id)),
  ]);
  const [H, blocker, inner, ...leaders] = race.race.horses;
  putBlock(H, blocker, straightPoint(race.race.geo), 10);
  pose(inner, blocker.s + 1, 8.5, Infinity, 12);
  leaders.forEach((leader, i) => pose(leader, H.s + 50 + i * 5, 16));
  race.step(0.01);
  assert.ok(H.blocked && H.targetT > H.t);
  assert.equal(H.action, '斜行out');
  let clear = false;
  for (let i = 0; i < 200; i++) {
    H.lastObserve = 0; race.step(1 / 30);
    if (!H.blocked && H.laneIntentT > 0 && H.targetT > H.t + 0.2) {
      clear = true; break;
    }
  }
  assert.ok(clear, 'fixture must clear the blocker before finishing the outward route');
  assert.notEqual(H.action, '斜行in', 'a baseline lane preference must not contradict an active escape');
  const before = H.t; H.lastObserve = Infinity; race.step(0.001);
  assert.ok(H.t > before && H.t <= H.targetT);
});

function completedOutwardEscape(gapToOriginalFront, levels = [100, 40]) {
  const race = makeRace([horse('a', '先', levels[0]), horse('block', '先', levels[1])]);
  const [H, blocker] = race.race.horses;
  putBlock(H, blocker, straightPoint(race.race.geo), 1.5);
  race.step(0.01);
  assert.ok(H.blocked && H.targetT > H.t, 'fixture must obtain a real outward escape through rider AI');
  assert.equal(H.passTarget, blocker, 'the route must record its actual opponent');
  // Complete the selected lateral route, then expose a controlled longitudinal
  // separation at the next observation. Motion and the new choice stay real.
  H.t = H.targetT; H.laneIntentT = 0; H.blocked = false; H.blocker = null; H.lastObserve = 0;
  blocker.s = H.s + gapToOriginalFront;
  return { race, H, blocker, outerLane: H.t };
}

test('an original blocker that runs away cannot hold the horse outside indefinitely', () => {
  const { race, H, outerLane } = completedOutwardEscape(60);
  race.step(0.001);
  assert.equal(H.passTarget, null, 'a distant former opponent must release the local passing commitment');
  assert.ok(H.targetT < outerLane, 'clear space must permit an economical inward route');
  assert.equal(H.action, '斜行in', 'the rider action must match the released inward route');
  const before = H.t; H.lastObserve = Infinity; race.step(0.001);
  assert.ok(H.t < before, 'the released route must result in actual inward steering');
});

test('a nearby original blocker keeps the outward lane until the pass is complete', () => {
  const { race, H, blocker, outerLane } = completedOutwardEscape(4);
  for (let i = 0; i < 3; i++) {
    H.lastObserve = 0; race.step(0.001);
    assert.equal(H.passTarget, blocker, 'a nearby opponent still being passed must remain the route objective');
    near(H.targetT, outerLane, 1e-12);
    near(H.t, outerLane, 1e-12);
  }
});

test('a faster nearby original blocker cannot keep an unproductive outward commitment', () => {
  const { race, H, blocker, outerLane } = completedOutwardEscape(4, [70, 100]);
  // The better horse uses its available short-term power after slowing.
  // A sustainable cruise need not exceed another horse's sprint command.
  blocker.aerobicOutput=blocker.aerobic;
  blocker.v = blocker.maxV; blocker.prevV = blocker.v; blocker.targetV = blocker.v;
  race.step(0.001);
  assert.ok(blocker.v > H.targetV, 'fixture must make the former blocker genuinely faster than the selected pace');
  assert.equal(H.passTarget, null, 'a futile pass must release the completed outward commitment');
  assert.ok(H.targetT < outerLane, 'the horse must resume choosing a useful line or sheltered following position');
  assert.equal(H.action, '斜行in');
});

test('drafting needs a nearby horse ahead in the same transverse corridor', () => {
  function follow(frontLane) {
    const race = makeRace([horse('a'), horse('b')]);
    const [H, front] = race.race.horses;
    pose(H, 500, 3); pose(front, 506, frontLane);
    const before = H.stamina;
    race.step(0.001);
    return { drafting: H.drafting, used: before - H.stamina };
  }
  const nearLane = follow(3), farLane = follow(17);
  assert.equal(nearLane.drafting, true);
  assert.equal(farLane.drafting, false,
    'a horse across the full track cannot provide aerodynamic shelter');
  assert.ok(nearLane.used < farLane.used, 'real energy drain must reflect the shelter');
});

test('a novice jockey outward escape action agrees with actual steering', () => {
  const novice = horse('a', '先', 100); novice.jockeyGrade = '新人';
  const race = makeRace([novice, horse('b', '先', 40)]);
  const [H, blocker] = race.race.horses;
  putBlock(H, blocker, straightPoint(race.race.geo), 1.5);
  race.step(0.01);
  assert.equal(H.jockey, '新人');
  assert.ok(H.blocked && H.targetT > H.t, 'fixture must require a real outward escape');
  assert.equal(H.action, '斜行out', 'the display and resource cost must describe the outward maneuver');
  const before = H.t; H.lastObserve = Infinity;
  race.step(0.001);
  assert.ok(H.t > before && H.t <= H.targetT, 'the horse must actually follow the selected route');
});

test('escape responds to the physical blocker rather than an unrelated rank neighbor', () => {
  function escape(withNeighbor) {
    const field = [horse('a', '先', 100), horse('block', '先', 40)];
    if (withNeighbor) field.push(horse('other-lane', '先', 40));
    const race = makeRace(field), [H, blocker, neighbor] = race.race.horses;
    putBlock(H, blocker, 1320, 10);
    if (neighbor) pose(neighbor, H.s + 1, 17, Infinity, 18);
    race.step(0.01);
    assert.ok(H.blocked && Math.abs(H.targetT - H.t) > 1, 'fixture must trigger a physical block and escape');
    assert.equal(H.blocker, blocker, 'the recorded opponent must have actually blocked the horse');
    if (neighbor) assert.ok(neighbor.s > H.s && neighbor.s < blocker.s,
      'the unrelated horse must be the closer longitudinal rank neighbor');
    const target = H.targetT;
    blocker.t = 18; blocker.targetT = 18;
    H.lastObserve = Infinity; race.step(0.001);
    assert.equal(H.blocker, null, 'a later frame without a block must clear the old opponent');
    return target;
  }
  // Adding a horse across the track must not change the physical escape route.
  near(escape(true), escape(false), 1e-12);
});

console.log('\n' + passed + ' curve/rider mechanism checks passed.');
if (failed) { console.error(failed + ' checks failed.'); process.exitCode = 1; }
