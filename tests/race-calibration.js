#!/usr/bin/env node
'use strict';

/* Reproducible operational validation, not a claim that a synthetic sample is
 * real-world race data. Six distances, both directions, two field definitions,
 * and a disjoint holdout seed bank are always reported separately.
 *
 * node tests/race-calibration.js --per-cell 12 --holdout-seed 3359187521 --json <report path>
 * CALIB_MARGIN_MEDIAN_MAX / CALIB_MARGIN_P90_MAX can set a documented acceptance
 * policy. Defaults 3 / 10 lengths retain the project's earlier conservative
 * operational bounds; these are not attributed to an unsourced JRA dataset.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const S = require('../sim.js');

const STYLES = ['逃', '先', '差', '追'];
const DISTANCES = [1200, 1600, 2000, 2400, 3000, 3200];
const DIRECTIONS = ['左回', '右回'];
const LENGTH_METERS = 2.4; // Reporting convention, not a universal physical constant.
const SEED_BANKS = { calibration: 2026100101, holdout: 3359187521 };
const clone = (x) => JSON.parse(JSON.stringify(x));
function engineHash() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sim.js'), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}
function quantile(values, p) {
  const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const position = (a.length - 1) * p, lower = Math.floor(position), fraction = position - lower;
  return a[lower] + (a[Math.min(lower + 1, a.length - 1)] - a[lower]) * fraction;
}
function distribution(values) {
  const a = values.filter(Number.isFinite);
  return { n: a.length, min: quantile(a, 0), median: quantile(a, 0.5), p90: quantile(a, 0.9),
    max: quantile(a, 1), mean: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null };
}
function controlledHorse(seed = 1, changes = {}) {
  const h = S.makeHorse(S.mulberry32(seed), {
    id: 'probe', style: '先', level: 70, '斗志': 50, '疲劳': 0,
    jockeyGrade: '普通', surface: '草地', special: '左右皆可', aggression: 1,
  });
  for (const key of Object.keys(h.stats)) h.stats[key] = 70;
  Object.assign(h.stats, changes);
  return h;
}
function buildField(seed, kind) {
  const field = S.makeField(S.mulberry32(seed), { n: 8, level: 70 });
  if (kind === 'identical') {
    const proto = controlledHorse(seed);
    for (const h of field) {
      h.stats = clone(proto.stats);
      h['斗志'] = 50; h['疲劳'] = 0; h.jockeyGrade = '普通';
      h.surface = '草地'; h.special = '左右皆可'; h.aggression = 1;
    }
  }
  return field;
}
function energyUsed(H) {
  return H.statsSummary && H.statsSummary.energyUsed;
}
function workUsed(H) {
  return H.statsSummary && H.statsSummary.workUsed;
}
function simulate(field, options, dt = 1 / 30, controls = null) {
  const rc = S.createRace(clone(field), {
    surface: '草地', state: '良', profile: '平坦', course: '标准',
    styleCoefs: 'balanced', rng: S.mulberry32(options.seed), ...options,
  });
  if (controls) rc.race.horses.forEach((H, i) => {
    H.control = typeof controls === 'function' ? controls(H, i) : clone(controls);
  });
  const times = new Map(rc.race.horses.map((H) => [H.id, new Map([[0, 0]])]));
  const marks = [...new Set([50, 200, 600, options.length - 600,
    ...Array.from({ length: Math.floor(options.length / 200) }, (_, k) => (k + 1) * 200)])]
    .filter((mark) => mark > 0).sort((a, b) => a - b);
  const nextMarks = new Map(rc.race.horses.map((H) => [H.id, 0]));
  let peakSpeed = 0, firstSpeed = null, finite = true, leadChanges = 0, previousLead = null;
  let halfLeader = null, paceMin = Infinity, paceMax = -Infinity, frames = 0;
  while (!rc.race.finished && rc.race.t < 610 && frames++ < Math.ceil(610 / dt) + 10) {
    const previous = rc.race.horses.map((H) => ({ s: H.s, time: rc.race.t }));
    rc.step(dt);
    if (firstSpeed == null) firstSpeed = Math.max(...rc.race.horses.map((H) => H.v));
    for (let i = 0; i < rc.race.horses.length; i++) {
      const H = rc.race.horses[i], from = previous[i];
      if (![H.s, H.t, H.v, H.stamina, H.guts].every(Number.isFinite)) finite = false;
      peakSpeed = Math.max(peakSpeed, H.v);
      const table = times.get(H.id);
      // Interpolated crossings avoid measuring a larger dt as faster by a frame.
      let next = nextMarks.get(H.id);
      while (next < marks.length && H.s >= marks[next]) {
        const mark = marks[next++];
        if (from.s < mark && H.s > from.s) {
          table.set(mark, from.time + (rc.race.t - from.time) * (mark - from.s) / (H.s - from.s));
        }
      }
      nextMarks.set(H.id, next);
    }
    const order = rc.race.horses.filter((H) => !H.dnf).slice().sort((a, b) => b.s - a.s);
    const leader = order[0];
    if (leader && !rc.race.order.length) {
      if (previousLead != null && previousLead !== leader.id) leadChanges++;
      previousLead = leader.id;
      if (halfLeader == null && leader.s >= options.length / 2) halfLeader = leader.id;
    }
    if (Number.isFinite(rc.race.paceStrength) && rc.race.t > 10 && leader && leader.s < options.length * 0.7) {
      paceMin = Math.min(paceMin, rc.race.paceStrength); paceMax = Math.max(paceMax, rc.race.paceStrength);
    }
  }
  const winner = rc.race.order[0], second = rc.race.order[1];
  const last = rc.race.order.at(-1);
  const winnerMarks = winner && times.get(winner.id);
  const first600 = winnerMarks && winnerMarks.get(600);
  const last600Start = winnerMarks && winnerMarks.get(options.length - 600);
  return { rc, finite, peakSpeed, firstSpeed, times, leadChanges,
    halfLeaderWon: winner && winner.id === halfLeader,
    finished: rc.race.finished && rc.race.order.length === field.length && rc.race.dnf.length === 0,
    winnerTime: winner ? winner.time : null,
    first600: Number.isFinite(first600) ? first600 : null,
    final600: winner && Number.isFinite(last600Start) ? winner.time - last600Start : null,
    margin: second && Number.isFinite(second.gapAtWin) ? Math.max(0, second.gapAtWin) / LENGTH_METERS : null,
    tail: last && Number.isFinite(last.gapAtWin) ? Math.max(0, last.gapAtWin) / LENGTH_METERS : null,
    paceRange: Number.isFinite(paceMin) ? [paceMin, paceMax] : null };
}
function isolatedTrial({ seed = 1, stats = {}, state = '良', fatigue = 0, length = 3200,
  targetV = 17, dt = 1 / 30, seconds = null } = {}) {
  const h = controlledHorse(seed, stats); h['疲劳'] = fatigue;
  if (seconds != null) {
    const rc = S.createRace([h], { length: 10000, state, surface: '草地', profile: '平坦',
      course: '标准', rng: S.mulberry32(seed) });
    const H = rc.race.horses[0]; H.control = { targetV, targetT: 10 };
    let steps = 0, physicalDistance = 0;
    while (!rc.race.finished && rc.race.t + dt / 2 < seconds && steps++ < Math.ceil(seconds / dt) + 5) {
      const before = S.trackPoint(H.s, H.t, rc.race.geo, rc.race.dir);
      rc.step(dt);
      const after = S.trackPoint(H.s, H.t, rc.race.geo, rc.race.dir);
      physicalDistance += Math.hypot(after.x - before.x, after.y - before.y);
    }
    return { time: rc.race.t, distance: H.s, physicalDistance, speed: H.v, stamina: H.stamina,
      staminaMax: H.staminaMax, guts: H.guts, gutsMax: H.gutsMax, energy: energyUsed(H), work: workUsed(H), H, rc };
  }
  const result = simulate([h], { length, state, seed }, dt, { targetV, targetT: 10 });
  const H = result.rc.race.horses[0], crossings = result.times.get(H.id);
  return { ...result, time: H.time, first50: crossings.get(50), first200: crossings.get(200),
    stamina: H.stamina, staminaMax: H.staminaMax, guts: H.guts, gutsMax: H.gutsMax,
    energy: energyUsed(H), work: workUsed(H), H };
}
function check(report, name, passed, measurements) {
  report.checks.push({ name, passed: !!passed, measurements });
}
function pairedEffects(report, n = 6) {
  const effects = {};
  function paired(name, left, right, metric) {
    const pairs = [];
    for (let k = 0; k < n; k++) {
      const seed = 791901 + k * 104729;
      const a = isolatedTrial({ seed, ...left }), b = isolatedTrial({ seed, ...right });
      const x = metric(a), y = metric(b);
      pairs.push({ seed, low: Number.isFinite(x) ? x : null, high: Number.isFinite(y) ? y : null,
        difference: Number.isFinite(x) && Number.isFinite(y) ? y - x : null });
    }
    const value = { pairs, difference: distribution(pairs.map((p) => p.difference)) };
    effects[name] = value; return value;
  }
  let effect = paired('speed', { stats: { '速度': 60 }, targetV: 23, length: 1200 },
    { stats: { '速度': 80 }, targetV: 23, length: 1200 }, (r) => r.time);
  check(report, 'speed capacity improves matched single-horse time', effect.difference.n === n && effect.difference.median < -0.1, effect.difference);
  effect = paired('break', { stats: { '出闸能力': 40 } }, { stats: { '出闸能力': 90 } }, (r) => r.first50);
  check(report, 'breaking ability changes launch time', effect.difference.n === n && effect.difference.median < -0.01, effect.difference);
  effect = paired('burst', { stats: { '爆发力': 40 }, targetV: 19 }, { stats: { '爆发力': 90 }, targetV: 19 }, (r) => r.first200);
  check(report, 'burst capacity improves finite acceleration', effect.difference.n === n && effect.difference.median < -0.01, effect.difference);
  effect = paired('endurance', { stats: { '耐力': 40 }, targetV: 17, seconds: 90 },
    { stats: { '耐力': 90 }, targetV: 17, seconds: 90 }, (r) => r.stamina / r.staminaMax);
  check(report, 'endurance preserves reserve at matched absolute target speed', effect.difference.n === n && effect.difference.median > 0.01, effect.difference);
  effect = paired('guts', { stats: { '毅力': 40 }, targetV: 18.5, seconds: 130 },
    { stats: { '毅力': 90 }, targetV: 18.5, seconds: 130 }, (r) => r.guts / r.gutsMax);
  check(report, 'guts preserves short reserve at matched absolute target speed', effect.difference.n === n && effect.difference.median > 0.01, effect.difference);
  effect = paired('power-heavy', { stats: { '力量': 40 }, state: '不良', seconds: 90, targetV: 15 },
    { stats: { '力量': 90 }, state: '不良', seconds: 90, targetV: 15 }, (r) => r.work / r.physicalDistance);
  check(report, 'power reduces matched-speed cost on rough ground', effect.difference.n === n && effect.difference.median < -0.0001, effect.difference);
  report.attributeEffects = effects;

  const pacing = [16, 17, 18.5].map((targetV) => {
    const r = isolatedTrial({ seed: 186, targetV, seconds: 90 });
    return { targetV, distance: r.distance, speed: r.speed, energy: r.energy, work: r.work,
      reserve: r.stamina / r.staminaMax, shortReserve: r.guts / r.gutsMax };
  });
  report.pacingResponses = pacing;
  const sane = pacing.every((r) => [r.distance, r.energy, r.work, r.reserve, r.speed].every(Number.isFinite));
  check(report, 'two plausible pacing responses: faster progress and greater energy cost',
    sane && pacing[1].distance > pacing[0].distance && pacing[2].distance > pacing[1].distance &&
    pacing[1].work > pacing[0].work && pacing[2].work > pacing[1].work &&
    pacing[2].reserve < pacing[0].reserve, pacing);

  const steps = [1 / 15, 1 / 30, 1 / 60].map((dt) => {
    const r = isolatedTrial({ seed: 186, targetV: 17, length: 2400, dt });
    return { dt, time: r.time, energy: r.energy, work: r.work, first50: r.first50, finite: r.finite };
  });
  report.timestepConvergence = steps;
  const base = steps[2];
  check(report, 'matched control converges at 15 / 30 / 60 Hz', steps.every((r) =>
    r.finite && Number.isFinite(r.time) && Number.isFinite(r.energy) && Number.isFinite(r.work) &&
    Math.abs(r.time - base.time) <= Math.max(0.2, base.time * 0.003) &&
    Math.abs(r.energy - base.energy) <= Math.max(0.05, Math.abs(base.energy) * 0.015) &&
    Math.abs(r.work - base.work) <= Math.max(0.05, Math.abs(base.work) * 0.015)), steps);
}
function summarize(rows) {
  const result = {};
  for (const key of ['winnerTime', 'first600', 'final600', 'margin', 'tail', 'peakSpeed', 'leadChanges'])
    result[key] = distribution(rows.map((r) => r[key]));
  result.halfLeaderWinRate = rows.length ? rows.filter((r) => r.halfLeaderWon).length / rows.length : null;
  return result;
}
function stressCases() {
  const cases = [
    { length: 1200, dir: '右回', surface: '草地', state: '良', profile: '平坦', course: '标准' },
    { length: 3200, dir: '左回', surface: '草地', state: '不良', profile: '缓坂', course: '小回り' },
    { length: 2000, dir: '右回', surface: '草地', state: '稍重', profile: '急坂', course: '长直道' },
    { length: 1200, dir: '左回', surface: '泥地', state: '重', profile: '平坦', course: '小回り' },
    { length: 3200, dir: '右回', surface: '泥地', state: '不良', profile: '急坂', course: '长直道' },
    { length: 2400, dir: '左回', surface: '草地', state: '良', profile: '急坂', course: '标准' },
  ];
  return cases.map((options, i) => {
    const seed = 115738123 + i * 104729;
    const field = buildField(seed, 'generated');
    field.forEach((h) => { h.surface = options.surface; });
    const r = simulate(field, { ...options, seed });
    return { ...options, seed, finished: r.finished, finite: r.finite,
      winnerTime: r.winnerTime, peakSpeed: r.peakSpeed, first600: r.first600,
      final600: r.final600, margin: r.margin, tail: r.tail };
  });
}
function runCalibration(options = {}) {
  const perCell = Math.max(1, Math.floor(options.perCell || 12));
  const allSeedBanks = { ...SEED_BANKS, ...options.seedBanks };
  const seedBanks = Object.fromEntries(Object.entries(allSeedBanks)
    .filter(([name]) => !options.cohorts || options.cohorts.includes(name)));
  if (!Object.keys(seedBanks).length) throw new Error('At least one declared seed bank is required');
  const report = { schemaVersion: 1, engineSha256: engineHash(),
    hashConvention: 'SHA-256 of UTF-8 sim.js after CRLF-to-LF normalization; matches the GitHub LF source blob',
    configuration: { perCell, distances: DISTANCES, directions: DIRECTIONS, seedBanks,
      dt: 1 / 30, fieldSize: 8, fieldLevel: 70, course: '标准', surface: '草地', state: '良', profile: '平坦',
      physicsParameters: clone(S.RACE_F) },
    policy: { medianMarginMax: Number(process.env.CALIB_MARGIN_MEDIAN_MAX || 3),
      p90MarginMax: Number(process.env.CALIB_MARGIN_P90_MAX || 10),
      explanation: 'Project operational acceptance bounds; not a fitted real-world dataset. Apply independently to both mixed-field seed banks.' },
    checks: [], cells: [], samples: [], warnings: [] };
  if (![report.policy.medianMarginMax, report.policy.p90MarginMax].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Margin acceptance bounds must be positive finite numbers');
  const seeds = new Set();
  for (const [cohort, firstSeed] of Object.entries(seedBanks)) {
    for (let li = 0; li < DISTANCES.length; li++) for (let di = 0; di < DIRECTIONS.length; di++) {
      const length = DISTANCES[li], dir = DIRECTIONS[di];
      for (const kind of ['generated', 'identical']) {
        const rows = [], starts = Object.fromEntries(STYLES.map((s) => [s, 0]));
        const wins = { ...starts };
        for (let k = 0; k < perCell; k++) {
          const seed = (firstSeed + li * 1000003 + di * 200003 + k * 7919) >>> 0;
          const key = cohort + '/' + seed;
          if (kind === 'generated') { if (seeds.has(seed)) throw new Error('seed banks must be disjoint'); seeds.add(seed); }
          const field = buildField(seed, kind); field.forEach((h) => starts[h.style]++);
          const r = simulate(field, { length, dir, seed: (seed * 31 + 7) >>> 0 });
          const winner = r.rc.race.order[0]; if (winner) wins[winner.style]++;
          const row = { cohort, kind, length, dir, seed, finite: r.finite, finished: r.finished,
            winnerTime: r.winnerTime, first600: r.first600, final600: r.final600,
            margin: r.margin, tail: r.tail, peakSpeed: r.peakSpeed, firstSpeed: r.firstSpeed,
            leadChanges: r.leadChanges, halfLeaderWon: r.halfLeaderWon, paceRange: r.paceRange };
          rows.push(row); report.samples.push(row);
          if (!r.finished || !r.finite) report.warnings.push('Incomplete or non-finite race: ' + key + '/' + kind);
        }
        report.cells.push({ cohort, kind, length, dir, ...summarize(rows),
          style: STYLES.map((style) => ({ style, starts: starts[style], wins: wins[style],
            perStart: starts[style] ? wins[style] / starts[style] : null })) });
        if (typeof options.onProgress === 'function' && report.cells.length % 12 === 0)
          options.onProgress(report.samples.length, Object.keys(seedBanks).length * DISTANCES.length * DIRECTIONS.length * 2 * perCell);
      }
    }
  }
  check(report, 'all races complete with finite state and eight finishers',
    report.samples.every((r) => r.finished && r.finite), { races: report.samples.length });
  // Broad physical guardrails detect unit errors and pathological stalls. They
  // deliberately do not masquerade as a course- and class-specific time target.
  check(report, 'plausible finish time, peak speed, and final 600 m', report.samples.every((r) =>
    r.winnerTime >= r.length / 24 && r.winnerTime <= r.length / 10 + 10 &&
    r.peakSpeed > 10 && r.peakSpeed < 28 && r.firstSpeed >= 0 && r.firstSpeed < 1 &&
    r.final600 >= 20 && r.final600 <= 80), {
      winnerTime: distribution(report.samples.map((r) => r.winnerTime)),
      peakSpeed: distribution(report.samples.map((r) => r.peakSpeed)),
      final600: distribution(report.samples.map((r) => r.final600)) });
  for (const cohort of Object.keys(seedBanks)) {
    const rows = report.samples.filter((r) => r.cohort === cohort && r.kind === 'generated');
    const margins = distribution(rows.map((r) => r.margin));
    check(report, cohort + ' generated-field margins meet declared operational bounds',
      margins.n === rows.length && margins.median <= report.policy.medianMarginMax && margins.p90 <= report.policy.p90MarginMax, margins);
  }
  report.warnings.push('Style per-start win rates, tail gaps and leader changes are descriptive. No 25% style quota or distance-monotonic win-rate gate is applied.');
  report.warnings.push('No empirical course/class dataset is fitted here. Passing validates the declared numerical and mechanism checks, not complete real-world fidelity.');
  pairedEffects(report, options.probePairs || 6);
  report.stressCases = stressCases();
  check(report, 'six course / ground / slope stress scenarios complete with finite state',
    report.stressCases.every((r) => r.finished && r.finite && Number.isFinite(r.winnerTime) && r.peakSpeed > 0 && r.peakSpeed < 28),
    report.stressCases);
  const finalEngineHash = engineHash();
  check(report, 'engine source remains unchanged during validation', finalEngineHash === report.engineSha256,
    { before: report.engineSha256, after: finalEngineHash });
  report.passed = report.checks.every((c) => c.passed);
  return report;
}
function fmt(x, digits = 2) { return Number.isFinite(x) ? x.toFixed(digits) : 'missing'; }
function printReport(report) {
  console.log('Race calibration | engine SHA-256 ' + report.engineSha256);
  console.log('Each cell: ' + report.configuration.perCell + ' races; generated + identical attributes; seed banks: ' +
    Object.keys(report.configuration.seedBanks).join(' / ') + '.');
  console.log('cohort      field      distance dir  time med/p90  margin med/p90  tail med  final600 med  style wins / starts (descriptive)');
  for (const c of report.cells) console.log(c.cohort.padEnd(11) + ' ' + c.kind.padEnd(10) + ' ' +
    String(c.length).padStart(4) + ' ' + c.dir + '  ' + fmt(c.winnerTime.median) + '/' + fmt(c.winnerTime.p90) +
    '  ' + fmt(c.margin.median) + '/' + fmt(c.margin.p90) + '  ' + fmt(c.tail.median) +
    '  ' + fmt(c.final600.median) + '  ' + c.style.map((s) => s.style + ':' + s.wins + '/' + s.starts).join(' '));
  for (const c of report.checks) console.log((c.passed ? 'PASS ' : 'FAIL ') + c.name + ' ' + JSON.stringify(c.measurements));
  for (const warning of report.warnings) console.log('NOTE ' + warning);
  console.log(report.passed ? 'PASS all declared checks' : 'FAIL one or more declared checks');
}
module.exports = { S, STYLES, DISTANCES, DIRECTIONS, engineHash, controlledHorse, buildField,
  distribution, quantile, simulate, isolatedTrial, stressCases, runCalibration, printReport };
if (require.main === module) {
  const args = process.argv.slice(2); let perCell = 12, output = null, holdoutSeed = null, calibrationOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--per-cell') perCell = Number(args[++i]);
    else if (args[i] === '--json') output = args[++i];
    else if (args[i] === '--holdout-seed') holdoutSeed = Number(args[++i]);
    else if (args[i] === '--calibration-only') calibrationOnly = true;
    else throw new Error('Unknown argument: ' + args[i]);
  }
  if (!Number.isFinite(perCell) || perCell < 1 || (output != null && !output)) throw new Error('Invalid calibration arguments');
  if (holdoutSeed != null && (!Number.isInteger(holdoutSeed) || holdoutSeed < 0 || holdoutSeed > 0xffffffff))
    throw new Error('Holdout seed must be an unsigned 32-bit integer');
  const report = runCalibration({ perCell,
    onProgress: (completed, total) => console.error('Progress ' + completed + ' / ' + total + ' races'),
    ...(calibrationOnly ? { cohorts: ['calibration'] } : {}),
    ...(holdoutSeed == null ? {} : { seedBanks: { holdout: holdoutSeed } }) }); printReport(report);
  if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.passed ? 0 : 1;
}
