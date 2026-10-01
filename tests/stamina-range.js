#!/usr/bin/env node
'use strict';

/* Energy-system checks at identical absolute target speed and elapsed time.
 * The former endurance * 32 m exhaustion target is deliberately retired:
 * continuous supply, speed and acceleration now determine reserve draw.
 * A failed check always sets a nonzero process exit code.
 * node tests/stamina-range.js [paired seeds, default 6]
 */
const { isolatedTrial, distribution } = require('./race-calibration.js');
const N = Math.max(1, Math.floor(Number(process.argv[2]) || 6));
const TARGET = 15;
const SECONDS = 120;
const checks = [];
function measure(stats, state = '良', fatigue = 0, targetV = TARGET) {
  const rows = [];
  for (let n = 0; n < N; n++) {
    const seed = 31000 + n * 104729;
    const r = isolatedTrial({ seed, stats, state, fatigue, targetV, seconds: SECONDS });
    rows.push({ seed, state, fatigue, distance: r.distance, speed: r.speed,
      reserve: r.stamina / r.staminaMax, shortReserve: r.guts / r.gutsMax,
      physicalDistance: r.physicalDistance,
      energyPerMeter: r.work / r.physicalDistance, energy: r.energy, work: r.work });
  }
  return { rows, reserve: distribution(rows.map((r) => r.reserve)),
    shortReserve: distribution(rows.map((r) => r.shortReserve)),
    cost: distribution(rows.map((r) => r.energyPerMeter)),
    speed: distribution(rows.map((r) => r.speed)) };
}
function test(name, passed, data) {
  checks.push({ name, passed: !!passed, data });
  console.log((passed ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(data));
}
function valid(group) {
  return group.rows.every((r) => [r.distance, r.speed, r.reserve, r.shortReserve, r.energyPerMeter].every(Number.isFinite) &&
    r.distance > 0 && r.energyPerMeter > 0 && r.reserve >= 0 && r.reserve <= 1 &&
    r.shortReserve >= 0 && r.shortReserve <= 1);
}
function monotonic(groups, value, direction, minimumDifference = 0) {
  if (!groups.every(valid)) return false;
  const a = groups.map(value);
  return a.every((x, i) => i === 0 || direction * (x - a[i - 1]) >= -1e-8) &&
    direction * (a.at(-1) - a[0]) >= minimumDifference;
}
console.log('Continuous energy validation: same absolute target ' + TARGET + ' m/s, flat turf, ' +
  SECONDS + ' s, ' + N + ' paired seeds. Values are reserve fractions and work per physical travel meter.');

const endurance = [40, 55, 70, 85, 100].map((v) => ({ value: v, result: measure({ '耐力': v }) }));
test('greater endurance preserves reserve at the same effort',
  monotonic(endurance.map((x) => x.result), (g) => g.reserve.median, 1, 0.01),
  endurance.map((x) => ({ endurance: x.value, reserve: x.result.reserve.median, cost: x.result.cost.median })));

const grounds = ['良', '稍重', '重', '不良'].map((state) => ({ state, result: measure({ '耐力': 70, '力量': 70 }, state) }));
test('worse ground raises absolute work per meter',
  monotonic(grounds.map((x) => x.result), (g) => g.cost.median, 1, 0.00001),
  grounds.map((x) => ({ state: x.state, cost: x.result.cost.median, reserve: x.result.reserve.median })));

for (const state of ['良', '重', '不良']) {
  const power = [40, 70, 100].map((value) => ({ value, result: measure({ '耐力': 70, '力量': value }, state) }));
  const good = power.every((x) => valid(x.result));
  const costs = power.map((x) => x.result.cost.median);
  const effect = good && costs[0] > 0 ? (costs[0] - costs.at(-1)) / costs[0] : null;
  if (state === '良') {
    test('power has limited energetic effect on good flat ground', good && Math.abs(effect) < 0.05,
      { state, relativeCostImprovement: effect, costs });
  } else {
    test('power reduces rough-ground cost: ' + state,
      monotonic(power.map((x) => x.result), (g) => g.cost.median, -1, 0.00001),
      { state, relativeCostImprovement: effect, costs });
  }
}

const fatigue = [0, 35, 70].map((value) => ({ value, result: measure({ '耐力': 70 }, '良', value, 17) }));
test('fatigue reduces reserve resilience at matched effort',
  monotonic(fatigue.map((x) => x.result), (g) => g.reserve.median, -1, 0.005),
  fatigue.map((x) => ({ fatigue: x.value, targetV: 17, reserve: x.result.reserve.median, cost: x.result.cost.median })));

const validAll = endurance.every((x) => valid(x.result)) && grounds.every((x) => valid(x.result)) && fatigue.every((x) => valid(x.result));
test('all controlled measurements are finite and bounded', validAll, { seeds: N, targetV: TARGET, seconds: SECONDS });
console.log(checks.every((c) => c.passed) ? 'PASS all energy checks' : 'FAIL one or more energy checks');
process.exitCode = checks.every((c) => c.passed) ? 0 : 1;
