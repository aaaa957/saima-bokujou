#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const S = require('../sim.js');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
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
function pose(H, s, t, observe = Infinity) {
  Object.assign(H, { s, t, targetT: t, laneJitter: 0, laneIntentT: 0,
    action: null, actionT: 0, lastObserve: observe });
}
function withParameter(key, value, run) {
  const previous = S.RACE_F[key];
  try { S.RACE_F[key] = value; run(); }
  finally { S.RACE_F[key] = previous; }
}

test('track is continuous, preserves width, and mirrors both directions', () => {
  for (const length of [1200, 2000, 3200]) {
    const geo = S.trackGeometry(length);
    const boundaries = [geo.S, geo.S + geo.B, 2 * geo.S + geo.B, 2 * geo.S + 2 * geo.B];
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
  for (const s of [geo.S / 2, geo.S + geo.B / 2, 1.5 * geo.S + geo.B, 2 * geo.S + 1.5 * geo.B]) {
    const before = S.trackPoint(s - delta, center, geo), point = S.trackPoint(s, center, geo);
    const after = S.trackPoint(s + delta, center, geo);
    const dx = (after.x - before.x) / (2 * delta), dy = (after.y - before.y) / (2 * delta);
    const ddx = (after.x - 2 * point.x + before.x) / (delta * delta);
    const ddy = (after.y - 2 * point.y + before.y) / (delta * delta);
    const measured = Math.abs(dx * ddy - dy * ddx) / Math.pow(dx * dx + dy * dy, 1.5);
    near(measured, S.kAt(s, geo), 1e-7);
  }
});

test('pure lane geometry preserves actual speed across lanes', () => withParameter('laneBias', 1, () => {
  for (const dir of ['左回', '右回']) {
    const race = makeRace(['a', 'b', 'c'].map((id) => horse(id)), { dir });
    const s = race.race.geo.S + race.race.geo.B / 2;
    race.race.horses.forEach((H, i) => pose(H, s, [3, S.TRACK_WIDTH / 2, S.TRACK_WIDTH - 3][i]));
    const before = race.race.horses.map((H) => S.trackPoint(H.s, H.t, race.race.geo, dir));
    race.step(0.001);
    // Measure world-space travel from the renderer, not an algebraic copy of
    // laneProgressCoef. Equal physical speed must yield equal arc travel.
    const travelPerSpeed = race.race.horses.map((H, i) =>
      distance(before[i], S.trackPoint(H.s, H.t, race.race.geo, dir)) / H.v);
    travelPerSpeed.forEach((value) => near(value, travelPerSpeed[1], 1e-9));
    assert.ok(race.race.horses[0].s > race.race.horses[1].s);
    assert.ok(race.race.horses[1].s > race.race.horses[2].s);
  }
}));

test('geometry neutral settings preserve equal progress', () => withParameter('laneBias', 0, () => {
  const geo = S.trackGeometry(2000);
  for (const t of [1, 10, 19]) for (const s of [100, geo.S + geo.B / 2]) {
    near(S.laneProgressCoef(s, t, geo), 1);
  }
}));

test('positive rider effort depends monotonically on available reserves', () => {
  for (const action of ['推骑', '打鞭']) {
    const bonuses = [0, 0.25, 0.5, 1].map((reserve) => S.actionCoef({
      action, stamina: reserve * 100, staminaMax: 100, guts: reserve * 100, gutsMax: 100,
    }));
    assert.ok(bonuses[0] >= 0 && bonuses.at(-1) <= S.actionBonus(action).coef);
    assert.ok(bonuses.every((value, i) => i === 0 || value >= bonuses[i - 1]));
    assert.ok(bonuses[0] < bonuses.at(-1), 'an exhausted horse must not get full urging benefit');
  }
  for (const action of ['收力', '减速']) {
    near(S.actionCoef({ action, stamina: 0, staminaMax: 100, guts: 0, gutsMax: 100 }),
      S.actionCoef({ action, stamina: 100, staminaMax: 100, guts: 100, gutsMax: 100 }));
  }
});

test('remaining endurance powers the finish, with less acceleration on curves', () => {
  function acceleration(reserve, bend) {
    const race = makeRace(), H = race.race.horses[0], geo = race.race.geo;
    pose(H, bend ? 2 * geo.S + 2 * geo.B - 10 : 1800, 10);
    H.stamina = H.staminaMax * reserve;
    race.step(0.001);
    return H.accel;
  }
  assert.ok(acceleration(1, false) > acceleration(0.25, false));
  assert.ok(acceleration(0.25, false) > acceleration(0, false));
  assert.ok(acceleration(0.5, true) <= acceleration(0.5, false));
  const race = makeRace(), H = race.race.horses[0];
  pose(H, 1800, 10); H.stamina = 0.001;
  race.step(0.001);
  assert.equal(H.stage, '毅力');
  const locked = H.accel;
  race.step(0.001);
  assert.ok(H.accel <= locked + 1e-12, 'entering guts cannot replenish the sprint reserve');
});

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

test('unblocked AI cuts inward on the bend, including the final bend', () => {
  for (const style of ['逃', '先', '差', '追']) {
    function target(s) {
      const race = makeRace([horse('a', style)]), H = race.race.horses[0];
      pose(H, s(race.race.geo), S.STYLE_BASE_T[style], 0);
      race.step(0.001); return H.targetT;
    }
    const straight = target((geo) => geo.S / 2);
    const bend = target((geo) => geo.S + geo.B / 2);
    assert.ok(bend < straight, style + ': the bend must affect the actual steering target');
    if (style !== '追') {
      const lastBend = target((geo) => 2 * geo.S + 2 * geo.B - 10);
      assert.ok(lastBend < straight, style + ': phase change cannot unfold the horse before curve exit');
    }
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
  pose(H, 500, 7.5, 0); pose(blocker, 501, 7.5);
  race.step(0.001);
  assert.ok(H.blocked, 'fixture must exercise an actual collision block');
  const combinedHalfWidth = 1 + 0.3 * (H.adj['体格'] + blocker.adj['体格']) / 200;
  assert.ok(Math.abs(H.targetT - blocker.t) >= combinedHalfWidth,
    'the closest blocker cannot be ignored when choosing an escape lane');
  assert.equal(H.action, H.targetT < H.t ? '斜行in' : '斜行out');
});

test('successful squeeze keeps its unfinished lane intent across AI observations', () => {
  const race = makeRace([horse('a', '先', 100), horse('b', '先', 40)]);
  const [H, blocker] = race.race.horses;
  pose(H, 1320, 10, 0); pose(blocker, 1321, 10.6);
  race.step(0.001);
  assert.ok(H.squeezePass > 0 && Math.abs(H.targetT - H.t) > 1, 'fixture must begin a real squeeze');
  const intended = H.targetT;
  for (let i = 0; i < 3; i++) {
    H.lastObserve = 0; race.step(0.001);
    assert.ok(H.laneIntentT > 0);
    near(H.targetT, intended, 1e-12);
  }
});

test('a successful squeeze replaces an obsolete opposite steering action', () => {
  const race = makeRace([horse('a', '先', 100), horse('b', '先', 40)]);
  const [H, blocker] = race.race.horses;
  pose(H, 1320, 8, 0); pose(blocker, 1321, 8);
  H.targetT = 7; H.action = '斜行in'; H.actionT = 1;
  race.step(0.001);
  assert.ok(H.squeezePass > 0 && H.targetT > H.t, 'fixture must squeeze toward the outside');
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
  pose(H, 500, 10, 0); pose(blocker, 501, 10); pose(inner, 502, 8.5);
  leaders.forEach((leader, i) => pose(leader, 550 + i * 5, 16));
  race.step(0.001);
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
  pose(H, 500, 1.5, 0); pose(blocker, 501, 1.5);
  race.step(0.001);
  assert.equal(H.jockey, '新人');
  assert.ok(H.blocked && H.targetT > H.t, 'fixture must require a real outward escape');
  assert.equal(H.action, '斜行out', 'the display and resource cost must describe the outward maneuver');
  const before = H.t; H.lastObserve = Infinity;
  race.step(0.001);
  assert.ok(H.t > before && H.t <= H.targetT, 'the horse must actually follow the selected route');
});

test('squeeze responds to the physical blocker rather than an unrelated rank neighbor', () => {
  function squeeze(withNeighbor) {
    const field = [horse('a', '先', 100), horse('block', '先', 40)];
    if (withNeighbor) field.push(horse('other-lane', '先', 40));
    const race = makeRace(field), [H, blocker, neighbor] = race.race.horses;
    pose(H, 1320, 10, 0); pose(blocker, 1321, 10);
    if (neighbor) pose(neighbor, 1320.5, 17);
    race.step(0.001);
    assert.ok(H.blocked && H.squeezePass > 0, 'fixture must trigger a physical block and squeeze');
    assert.equal(H.blocker, blocker, 'the recorded opponent must have actually blocked the horse');
    if (neighbor) assert.ok(neighbor.s > H.s && neighbor.s < blocker.s,
      'the unrelated horse must be the closer longitudinal rank neighbor');
    const target = H.targetT;
    H.lastObserve = Infinity; race.step(0.001);
    assert.equal(H.blocker, null, 'a later frame without a block must clear the old opponent');
    return target;
  }
  // Adding a horse across the track must not change the squeeze route.
  near(squeeze(true), squeeze(false), 1e-12);
});

console.log('\n' + passed + ' curve/rider mechanism checks passed.');
