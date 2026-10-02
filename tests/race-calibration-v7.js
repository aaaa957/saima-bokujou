#!/usr/bin/env node
'use strict';

/* Independent operational and empirical checks for v2026.10.02.1.
 * The fresh synthetic and 2025 real-data holdouts must only be opened after
 * source/parameter freeze. --calibration-only never runs either holdout.
 * Acceptance bounds below are declared before observing the new holdout.
 * Physical energy fields are mechanical-equivalent units, not measured VO2.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const S = require('../sim.js');
const ROOT = path.resolve(__dirname, '..');
const BASELINE = 'c7dda5d0b809878bcdaa99800a0317d8294a939b';
const DISTANCES = [1200, 1600, 2000, 2400, 3000, 3200];
const DIRECTIONS = ['左回', '右回'];
const COURSES = ['标准', '长直道', '小回り'];
const SURFACES = ['草地', '泥地'];
const KINDS = ['generated', 'identical'];
const LABELS = ['逃', '先', '差', '追'];
const SEED_BANKS = { calibration: 2026100201, holdout: 1418179873 };
const LENGTH_METERS = 2.4;
const POLICY = Object.freeze({ medianMarginMax: 3, p90MarginMax: 10,
  realWinnerTimeRelativeMax: 0.05, realWinnerFinal600RelativeMax: 0.10,
  realLeaderFirst600RelativeMax: 0.10, realFieldLevel: 86, realRepeats: 3 });
const clone = x => JSON.parse(JSON.stringify(x));
function hash(source) { return crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n'), 'utf8').digest('hex'); }
function engineHash() { return hash(fs.readFileSync(path.join(ROOT, 'sim.js'), 'utf8')); }
function quantile(values, p) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const at = (a.length - 1) * p, lo = Math.floor(at), frac = at - lo;
  return a[lo] + frac * (a[Math.min(lo + 1, a.length - 1)] - a[lo]);
}
function distribution(values) {
  const a = values.filter(Number.isFinite);
  return { n: a.length, min: quantile(a, 0), median: quantile(a, .5), p90: quantile(a, .9),
    max: quantile(a, 1), mean: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null };
}
function check(report, name, passed, measurements, domain = 'engineering') {
  report.checks.push({ name, passed: Boolean(passed), domain, measurements });
}
function controlledHorse(seed = 1, changes = {}) {
  const h = S.makeHorse(S.mulberry32(seed), { id: 'probe', style: '先', level: 70,
    '斗志': 50, '疲劳': 0, jockeyGrade: '普通', surface: '草地', special: '左右皆可', aggression: 1 });
  for (const k of Object.keys(h.stats)) h.stats[k] = 70;
  Object.assign(h.stats, changes); h['斗志'] = 50; h['疲劳'] = 0;
  return h;
}
function buildField(seed, kind, surface = '草地', level = 70) {
  const field = S.makeField(S.mulberry32(seed), { n: 8, level });
  for (const h of field) {
    h.surface = surface; h.special = '左右皆可';
    if (kind === 'identical') {
      for (const key of Object.keys(h.stats)) h.stats[key] = level;
      h['斗志'] = 50; h['疲劳'] = 0; h.jockeyGrade = '普通'; h.aggression = 1;
      // Equal behavior profiles too: the descriptive label remains different.
      const proto = controlledHorse(seed);
      h.behavior = { forwardness: .5, settle: .5, tractability: .5 };
      h.racePlan = { position: .5, risk: .5, patience: .5 };
      if (proto.temperament) h.temperament = clone(proto.temperament);
      if (Number.isFinite(proto.bodyMass)) h.bodyMass = proto.bodyMass;
      if (Number.isFinite(proto.carriedWeight)) h.carriedWeight = proto.carriedWeight;
    }
  }
  return field;
}
function positionCategory(rank, n) {
  if (rank === 1) return '逃';
  if (rank <= Math.ceil(n * .375)) return '先';
  if (rank <= Math.ceil(n * .625)) return '差';
  return '追';
}
function simulate(field, options, dt = 1 / 30, controls = null, api = S) {
  const rc = api.createRace(clone(field), { surface: '草地', state: '良', profile: '平坦',
    course: '标准', rng: api.mulberry32(options.seed), ...options });
  if (controls) rc.race.horses.forEach((H, i) => { H.control = typeof controls === 'function' ? controls(H, i) : clone(controls); });
  const times = new Map(rc.race.horses.map(H => [H.id, new Map([[0, 0]])]));
  const marks = [...new Set([50, 200, 600, options.length - 600,
    ...Array.from({ length: Math.floor(options.length / 200) }, (_, k) => (k + 1) * 200)])].filter(v => v > 0).sort((a, b) => a - b);
  const nextMarks = new Map(rc.race.horses.map(H => [H.id, 0]));
  let peakSpeed = 0, firstSpeed = null, finite = true, bounded = true, frames = 0;
  let maxAcceleration = 0, maxLateralSpeed = 0, leadChanges = 0, previousLead = null, halfLeader = null;
  let positionSnapshot = null, strategyChanges = 0;
  const straightMark = options.length - (rc.race.geo.finishStraight || rc.race.geo.S);
  const previousStrategy = new Map();
  while (!rc.race.finished && rc.race.t < 610 && frames++ < Math.ceil(610 / dt) + 10) {
    const previous = rc.race.horses.map(H => ({ s: H.s, t: H.t, v: H.v, time: rc.race.t, place: H.place }));
    rc.step(dt);
    if (firstSpeed == null) firstSpeed = Math.max(...rc.race.horses.map(H => H.v));
    for (let i = 0; i < rc.race.horses.length; i++) {
      const H = rc.race.horses[i], from = previous[i];
      const values = [H.s, H.t, H.v, H.stamina, H.guts];
      if (Number.isFinite(H.aerobicOutput)) values.push(H.aerobicOutput);
      if (!values.every(Number.isFinite)) finite = false;
      if (H.stamina < -1e-7 || H.stamina > H.staminaMax + 1e-7 || H.guts < -1e-7 || H.guts > H.gutsMax + 1e-7) bounded = false;
      if (!from.place) {
        maxAcceleration = Math.max(maxAcceleration, (H.v - from.v) / dt);
        maxLateralSpeed = Math.max(maxLateralSpeed, Math.abs(H.t - from.t) / dt);
      }
      peakSpeed = Math.max(peakSpeed, H.v);
      const table = times.get(H.id); let next = nextMarks.get(H.id);
      while (next < marks.length && H.s >= marks[next]) {
        const mark = marks[next++];
        if (from.s < mark && H.s > from.s) table.set(mark, from.time + (rc.race.t - from.time) * (mark - from.s) / (H.s - from.s));
      }
      nextMarks.set(H.id, next);
      const strategy = H.strategy?.mode || H.tactic || H.aiState || null;
      if (strategy && previousStrategy.has(H.id) && previousStrategy.get(H.id) !== strategy) strategyChanges++;
      if (strategy) previousStrategy.set(H.id, strategy);
    }
    const order = rc.race.horses.filter(H => !H.dnf).slice().sort((a, b) => b.s - a.s || a.gate - b.gate);
    const leader = order[0];
    if (leader && !rc.race.order.length) {
      // Gate ties at zero speed do not count as overtakes.
      if (rc.race.t > 10 && previousLead != null && previousLead !== leader.id) leadChanges++;
      if (rc.race.t > 10) previousLead = leader.id;
      if (halfLeader == null && leader.s >= options.length / 2) halfLeader = leader.id;
      if (!positionSnapshot && leader.s >= straightMark) positionSnapshot = order.map((H, i) => ({ id: H.id, rank: i + 1,
        category: positionCategory(i + 1, order.length), gap: Math.max(0, leader.s - H.s) }));
    }
  }
  const winner = rc.race.order[0], second = rc.race.order[1], last = rc.race.order.at(-1);
  const winnerMarks = winner && times.get(winner.id);
  const final600Start = winnerMarks && winnerMarks.get(options.length - 600);
  const leaderFirst600 = Math.min(...rc.race.horses.map(H => times.get(H.id).get(600)).filter(Number.isFinite));
  const accounting = energyAccounting(rc.race.horses);
  return { rc, times, finite, bounded, peakSpeed, firstSpeed, maxAcceleration, maxLateralSpeed, leadChanges,
    strategyChanges, positionSnapshot: positionSnapshot || [], halfLeaderWon: Boolean(winner && winner.id === halfLeader),
    winnerObservedStyle: positionSnapshot?.find(x => x.id === winner?.id)?.category || null,
    finished: rc.race.finished && rc.race.order.length === field.length && rc.race.dnf.length === 0,
    winnerTime: winner?.time ?? null, first600: winnerMarks?.get(600) ?? null,
    leaderFirst600: Number.isFinite(leaderFirst600) ? leaderFirst600 : null,
    final600: winner && Number.isFinite(final600Start) ? winner.time - final600Start : null,
    ...accounting, margin: Number.isFinite(second?.gapAtWin) ? Math.max(0, second.gapAtWin) / LENGTH_METERS : null,
    tail: Number.isFinite(last?.gapAtWin) ? Math.max(0, last.gapAtWin) / LENGTH_METERS : null };
}
function concise(r) {
  return Object.fromEntries(['finished', 'finite', 'bounded', 'winnerTime', 'first600', 'leaderFirst600', 'final600',
    'margin', 'tail', 'peakSpeed', 'firstSpeed', 'maxAcceleration', 'maxLateralSpeed', 'leadChanges', 'strategyChanges',
    'halfLeaderWon', 'winnerObservedStyle', 'positionSnapshot', 'energyAccountingAvailable', 'energyConserving', 'energyAccountingError', 'unpaidWork'].map(k => [k, r[k]]));
}
function energyAccounting(horses) {
  const accounts = horses.map(H => ({ work: H.statsSummary?.workUsed, aerobic: H.statsSummary?.aerobicUsed,
    draw: H.statsSummary?.energyUsed, unpaid: H.statsSummary?.unpaidWork }));
  const available = accounts.every(a => Object.values(a).every(Number.isFinite));
  return { energyAccountingAvailable: available,
    energyConserving: available ? accounts.every(a => Math.abs(a.work - a.aerobic - a.draw) <= 1e-5 && a.unpaid <= 1e-5) : null,
    energyAccountingError: available ? Math.max(...accounts.map(a => Math.abs(a.work - a.aerobic - a.draw))) : null,
    unpaidWork: available ? Math.max(...accounts.map(a => a.unpaid)) : null };
}
function summarize(rows) {
  const result = {};
  for (const k of ['winnerTime', 'first600', 'leaderFirst600', 'final600', 'margin', 'tail', 'peakSpeed', 'leadChanges', 'strategyChanges'])
    result[k] = distribution(rows.map(r => r[k]));
  result.halfLeaderWinRate = rows.length ? rows.filter(r => r.halfLeaderWon).length / rows.length : null;
  result.observedStyle = LABELS.map(style => {
    const starts = rows.reduce((n, r) => n + r.positionSnapshot.filter(x => x.category === style).length, 0);
    const wins = rows.filter(r => r.winnerObservedStyle === style).length;
    return { style, starts, wins, perStart: starts ? wins / starts : null };
  });
  return result;
}
function isolatedTrial({ seed = 186, stats = {}, targetV = 17, targetT = 10, seconds = 90, dt = 1 / 30,
  length = null, horse = {}, options = {}, schedule = null } = {}) {
  const h = Object.assign(controlledHorse(seed, stats), horse);
  if (length) {
    const r = simulate([h], { length, seed, ...options }, dt, { targetV, targetT });
    const H = r.rc.race.horses[0]; return { ...r, H, time: H.time, first50: r.times.get(H.id).get(50),
      first200: r.times.get(H.id).get(200), reserve: H.stamina / H.staminaMax, tolerance: H.guts / H.gutsMax,
      work: H.statsSummary.workUsed, energy: H.statsSummary.energyUsed };
  }
  const rc = S.createRace([h], { length: 10000, seed, surface: '草地', state: '良', profile: '平坦', course: '标准',
    rng: S.mulberry32(seed), ...options });
  const H = rc.race.horses[0]; H.control = { targetV, targetT };
  let physicalDistance = 0, accelerationWork = 0, brakingReserveIncrease = 0, maxRecoveryPower = 0;
  const trace = [];
  while (rc.race.t + dt / 2 < seconds) {
    if (schedule) H.control.targetV = schedule(rc.race.t);
    const from = S.trackPoint(H.s, H.t, rc.race.geo, rc.race.dir), oldV = H.v, oldReserve = H.stamina;
    const previousRecovered = H.statsSummary.recovered || 0;
    rc.step(dt);
    const to = S.trackPoint(H.s, H.t, rc.race.geo, rc.race.dir);
    physicalDistance += Math.hypot(to.x - from.x, to.y - from.y);
    accelerationWork += Math.max(0, (H.v ** 2 - oldV ** 2) / 2);
    maxRecoveryPower = Math.max(maxRecoveryPower, ((H.statsSummary.recovered || 0) - previousRecovered) / dt);
    if (oldV - H.v > .03 && H.stamina > oldReserve) brakingReserveIncrease += H.stamina - oldReserve;
    if (Math.floor(rc.race.t) > Math.floor(rc.race.t - dt)) trace.push({ t: rc.race.t, s: H.s, v: H.v,
      reserve: H.stamina, aerobicOutput: H.aerobicOutput ?? null, power: H.power, work: H.statsSummary.workUsed });
  }
  return { rc, H, time: rc.race.t, distance: H.s, physicalDistance, accelerationWork, brakingReserveIncrease, maxRecoveryPower,
    speed: H.v, reserve: H.stamina / H.staminaMax, tolerance: H.guts / H.gutsMax,
    work: H.statsSummary.workUsed, energy: H.statsSummary.energyUsed, trace };
}
function pairedEffects(report) {
  report.attributeEffects = {};
  function paired(name, left, right, metric, test) {
    const pairs = Array.from({ length: 4 }, (_, i) => {
      const seed = 902771 + i * 104729, a = isolatedTrial({ seed, ...left }), b = isolatedTrial({ seed, ...right });
      return { seed, low: metric(a), high: metric(b), difference: metric(b) - metric(a) };
    });
    const d = distribution(pairs.map(p => p.difference)); report.attributeEffects[name] = { pairs, difference: d };
    check(report, name, d.n === pairs.length && test(d), d);
  }
  paired('speed improves matched solo finish time', { stats: { '速度': 60 }, length: 1200, targetV: 23 },
    { stats: { '速度': 80 }, length: 1200, targetV: 23 }, r => r.time, d => d.median < -.1);
  paired('breaking ability improves launch', { stats: { '出闸能力': 40 }, length: 1200 },
    { stats: { '出闸能力': 90 }, length: 1200 }, r => r.first50, d => d.median < -.01);
  paired('burst capacity improves acceleration', { stats: { '爆发力': 40 }, length: 1200, targetV: 19 },
    { stats: { '爆发力': 90 }, length: 1200, targetV: 19 }, r => r.first200, d => d.median < -.01);
  paired('endurance preserves reserve at equal actual requested pace', { stats: { '耐力': 40 } },
    { stats: { '耐力': 90 } }, r => r.reserve, d => d.median > .01);
  paired('power reduces cost per actual meter on heavy ground', { stats: { '力量': 40 }, targetV: 15, options: { state: '不良' } },
    { stats: { '力量': 90 }, targetV: 15, options: { state: '不良' } }, r => r.work / r.physicalDistance, d => d.median < -.0001);
  paired('extra carried weight increases cost at matched requested pace', { horse: { bodyMass: 480, carriedWeight: 53 }, targetV: 16 },
    { horse: { bodyMass: 480, carriedWeight: 60 }, targetV: 16 }, r => r.work / r.physicalDistance, d => d.median > .0001);
  const shortResponses = [15, 17, 18.5].map(targetV => { const r = isolatedTrial({ targetV, seconds: 30 });
    return { seconds: 30, targetV, distance: r.distance, speed: r.speed, work: r.work, energy: r.energy, reserve: r.reserve }; });
  report.shortPacingResponses = shortResponses;
  check(report, 'unexhausted 30 s faster pacing increases progress, actual work and reserve draw',
    shortResponses.every(r => Object.values(r).every(Number.isFinite) && r.reserve > .05) &&
    shortResponses[1].distance > shortResponses[0].distance && shortResponses[2].distance > shortResponses[1].distance &&
    shortResponses[1].work > shortResponses[0].work && shortResponses[2].work > shortResponses[1].work &&
    shortResponses[1].energy > shortResponses[0].energy && shortResponses[2].energy > shortResponses[1].energy, shortResponses);
  const responses = [15, 17, 18.5].map(targetV => { const r = isolatedTrial({ targetV, seconds: 90 });
    return { seconds: 90, targetV, distance: r.distance, speed: r.speed, work: r.work, energy: r.energy, reserve: r.reserve }; });
  report.pacingResponses = responses;
  check(report, 'sustained overpacing exhausts reserve and lowers late actual speed',
    responses.every(r => Object.values(r).every(Number.isFinite)) &&
    responses[2].reserve < responses[1].reserve && responses[2].reserve < .02 &&
    responses[2].speed < responses[1].speed && responses[2].speed < shortResponses[2].speed, responses);
  const converged = [1 / 15, 1 / 30, 1 / 60].map(dt => { const r = isolatedTrial({ dt, length: 2400 });
    return { dt, time: r.time, work: r.work, energy: r.energy, first50: r.first50 }; });
  const ref = converged.at(-1); report.timestepConvergence = converged;
  check(report, '15 / 30 / 60 Hz matched-control convergence', converged.every(r => [r.time, r.work, r.energy].every(Number.isFinite) &&
    Math.abs(r.time - ref.time) <= Math.max(.2, ref.time * .003) &&
    Math.abs(r.work - ref.work) <= Math.max(.05, Math.abs(ref.work) * .015) &&
    Math.abs(r.energy - ref.energy) <= Math.max(.05, Math.abs(ref.energy) * .015)), converged);
  const constant = isolatedTrial({ targetV: 16, seconds: 120 });
  const oscillated = isolatedTrial({ targetV: 16, seconds: 120, schedule: t => t < 30 ? 16 : (Math.floor((t - 30) / 10) % 2 ? 17 : 15) });
  report.accelerationProbe = { constant: { workPerMeter: constant.work / constant.physicalDistance, accelerationWork: constant.accelerationWork },
    oscillated: { workPerMeter: oscillated.work / oscillated.physicalDistance, accelerationWork: oscillated.accelerationWork },
    interpretation: 'Descriptive only: equal-duration variable pacing covers different track sections and ends at different speeds. A work-per-meter comparison here cannot isolate acceleration cost; negative acceleration can also pay resistance from existing kinetic energy.' };
  const physiological = isolatedTrial({ seconds: 40, targetV: 19 });
  report.aerobicResponse = physiological.trace;
  const oxygen = physiological.trace.map(r => r.aerobicOutput).filter(Number.isFinite);
  check(report, 'aerobic supply has finite rising startup response', oxygen.length > 10 && oxygen[0] >= 0 &&
    oxygen[0] < oxygen.at(-1) && oxygen.every(x => x >= 0 && x < 200), { first: oxygen[0] ?? null, last: oxygen.at(-1) ?? null });
  const recovery = isolatedTrial({ targetV: 19, seconds: 75, schedule: t => t < 30 ? 19 : 10 });
  const maxRecovery = Number(S.RACE_F.recoveryMax);
  report.recoveryProbe = { maxRecoveryPower: recovery.maxRecoveryPower, declaredRecoveryMax: maxRecovery,
    recovered: recovery.H.statsSummary.recovered, energyDrawn: recovery.energy, initialReserve: recovery.H.staminaMax,
    finalReserve: recovery.H.stamina, brakingReserveIncrease: recovery.brakingReserveIncrease };
  check(report, 'reserve accounting conserves draw / slow recovery and braking cannot bypass recovery cap',
    Number.isFinite(maxRecovery) && recovery.maxRecoveryPower <= maxRecovery + 1e-7 &&
    Math.abs(recovery.H.stamina - (recovery.H.staminaMax - recovery.energy + recovery.H.statsSummary.recovered)) < 1e-5,
    report.recoveryProbe);
  const depleted = isolatedTrial({ stats: { '耐力': 10 }, targetV: 23, seconds: 150,
    options: { course: '京都', profile: '急坂', state: '稍重', wind: 8 } });
  report.depletedPowerAccounting = { ...energyAccounting([depleted.H]), reserveFraction: depleted.reserve,
    workUsed: depleted.work, aerobicUsed: depleted.H.statsSummary.aerobicUsed, reserveDrawn: depleted.energy,
    scenario: 'low initial reserve, high requested speed, bends, non-flat ground and direction-projected wind' };
  check(report, 'actual motion work remains fully paid across terrain joints after reserve depletion',
    report.depletedPowerAccounting.energyAccountingAvailable && report.depletedPowerAccounting.energyConserving === true &&
    depleted.reserve < .02, report.depletedPowerAccounting);
  if (typeof physiological.H.powerFor === 'function') {
    const H = physiological.H, at = Array.from({ length: 100 }, (_, i) => i * 20).find(s => S.kAt(s, physiological.rc.race.geo) === 0) ?? H.s;
    const low = { solo: H.powerFor(6, 0, false, at), sheltered: H.powerFor(6, 0, true, at) };
    const high = { solo: H.powerFor(18, 0, false, at), sheltered: H.powerFor(18, 0, true, at) };
    const fraction = (high.solo - high.sheltered) / high.solo;
    report.draftCostProbe = { low, high, wholeWorkSavingFraction: fraction };
    check(report, 'drafting reduces aerodynamic work without discounting all locomotion work',
      low.solo > low.sheltered && high.solo > high.sheltered && fraction > 0 && fraction < .08 &&
      (low.solo - low.sheltered) / (high.solo - high.sheltered) < .10, report.draftCostProbe);
    // Isolate acceleration at the same location and velocity, rather than
    // attributing changes in route exposure or final kinetic energy to a tax.
    let accelerationEnergy = 0;
    for (let i = 0; i < 100; i++) {
      const v = 15 + (i + .5) * .02;
      accelerationEnergy += (H.powerFor(v, 1, false, at) - H.powerFor(v, 0, false, at)) * .02;
    }
    const kineticDifference = .5 * (17 ** 2 - 15 ** 2) * H.massRatio;
    report.kineticEnergyProbe = { from: 15, to: 17, integratedPositiveAccelerationWork: accelerationEnergy,
      kineticDifference, massRatio: H.massRatio };
    check(report, 'positive acceleration pays the actual change in kinetic energy with consistent units',
      accelerationEnergy > 0 && Math.abs(accelerationEnergy - kineticDifference) < 1e-7, report.kineticEnergyProbe);
  }
}
function labelInvariance(report) {
  const generated = LABELS.map(style => S.makeHorse(S.mulberry32(148173), { style, id: 'same-identity', level: 70 }));
  const signatures = generated.map(h => JSON.stringify({ stats: h.stats, behavior: S.horseBehavior ? S.horseBehavior(h) : h.behavior,
    bodyMass: h.bodyMass, carriedWeight: h.carriedWeight }));
  check(report, 'generation does not assign attribute or behavior templates from style labels',
    signatures.every(s => s === signatures[0]), { styleLabels: LABELS, identicalProfiles: new Set(signatures).size === 1 });
  const field = buildField(812319, 'generated'), renamed = clone(field);
  renamed.forEach((h, i) => { h.style = LABELS[(LABELS.indexOf(h.style) + 1) % LABELS.length]; });
  const options = { length: 2000, seed: 69719, dir: '右回' };
  const a = simulate(field, options), b = simulate(renamed, options);
  const diffs = a.rc.race.horses.map(H => {
    const J = b.rc.race.horses.find(x => x.id === H.id);
    return { id: H.id, time: J.time - H.time, reserve: J.stamina - H.stamina, lane: J.t - H.t, place: J.place - H.place };
  });
  report.labelInvariance = diffs;
  check(report, 'renaming style labels does not alter physics or jockey decisions', a.finished && b.finished &&
    diffs.every(d => Object.entries(d).filter(([k]) => k !== 'id').every(([, v]) => Number.isFinite(v) && Math.abs(v) < 1e-9)), diffs);
}
function stressCases(report) {
  const cases = [
    { length: 1200, dir: '右回', surface: '草地', state: '良', profile: '平坦', course: '标准' },
    { length: 3200, dir: '左回', surface: '草地', state: '不良', profile: '缓坂', course: '小回り' },
    { length: 2000, dir: '右回', surface: '草地', state: '稍重', profile: '急坂', course: '长直道' },
    { length: 1200, dir: '左回', surface: '泥地', state: '重', profile: '平坦', course: '小回り' },
    { length: 3200, dir: '右回', surface: '泥地', state: '不良', profile: '急坂', course: '长直道' },
    { length: 2400, dir: '左回', surface: '草地', state: '良', profile: '急坂', course: '标准' },
    { length: 3200, dir: '右回', surface: '草地', state: '良', profile: '平坦', venue: '京都', wind: 12 },
    { length: 2000, dir: '左回', surface: '草地', state: '不良', profile: '急坂', venue: '東京', wind: -12 },
  ];
  report.stressCases = cases.map((o, i) => {
    const seed = 71952073 + i * 104729, field = buildField(seed, 'generated', o.surface);
    if (i >= 6) field.forEach(h => { h.bodyMass = i === 6 ? 400 : 600; h.carriedWeight = i === 6 ? 49 : 65; });
    if (i === 5) field.forEach(h => { h.surface = '泥地'; });
    return { ...o, seed, ...concise(simulate(field, { ...o, seed })) };
  });
  check(report, 'eight geometry / ground / slope / load stress cases finish with bounded finite state',
    report.stressCases.every(r => r.finished && r.finite && r.bounded && r.peakSpeed > 0 && r.peakSpeed < 28), report.stressCases);
}
function loadBaseline() {
  const source = execFileSync('git', ['show', BASELINE + ':sim.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const baselineModule = { exports: {} }, privateGlobal = {};
  // Same V8 arithmetic with a private exported global, avoiding slow intrinsic
  // lookups across a vm context. Verified against vm on matched 1200/3200 m:
  // every horse's time, reserve, fatigue tolerance, place and lane are identical.
  new Function('module', 'exports', 'globalThis', source)(baselineModule, baselineModule.exports, privateGlobal);
  return { api: baselineModule.exports, hash: hash(source) };
}
function realReference(report, calibrationOnly) {
  const file = path.join(ROOT, 'docs', 'race-reality-reference.json');
  if (!fs.existsSync(file)) { report.realReference = { available: false, reason: 'Reference dataset is absent' }; return; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const samples = (data.samples || []).filter(r => !calibrationOnly || r.split === 'calibration');
  const rows = [];
  for (const sample of samples) {
    const repeats = [];
    for (let k = 0; k < POLICY.realRepeats; k++) {
      const seed = (2026100207 + DISTANCES.indexOf(sample.length) * 100003 + k * 7919) >>> 0;
      const field = buildField(seed, 'generated', sample.surface, POLICY.realFieldLevel);
      field.forEach(h => { h['疲劳'] = 0; h['斗志'] = 50; h.jockeyGrade = '优秀';
        h.carriedWeight = sample.winner.carriedWeightKg ?? 58;
        h.bodyMass = sample.winner.bodyWeightKg ?? 480; });
      const r = simulate(field, { length: sample.length, seed, venue: sample.venue, course: sample.venue,
        dir: sample.direction, surface: sample.surface, state: sample.state, profile: '平坦' });
      repeats.push(concise(r));
    }
    const predicted = { winnerTime: quantile(repeats.map(r => r.winnerTime), .5),
      winnerFinal600: quantile(repeats.map(r => r.final600), .5), leaderFirst600: quantile(repeats.map(r => r.leaderFirst600), .5) };
    const actual = { winnerTime: sample.winner.finishTime, winnerFinal600: sample.winner.final600, leaderFirst600: sample.first600 };
    const residual = Object.fromEntries(Object.keys(actual).map(key => [key, { seconds: predicted[key] - actual[key],
      relative: (predicted[key] - actual[key]) / actual[key] }]));
    rows.push({ id: sample.id, split: sample.split, venue: sample.venue, length: sample.length, source: sample.source,
      actual, predicted, residual, repeats });
  }
  report.realReference = { available: true, file: path.relative(ROOT, file), datasetSha256: hash(fs.readFileSync(file, 'utf8')),
    fieldLevel: POLICY.realFieldLevel, fieldSize: 8, repeats: POLICY.realRepeats,
    limitation: 'G1 winners are class-specific upper performance references, not average races. Synthetic fields do not reproduce competitors, tactics, weather or rail settings. Residuals test coarse external timing only; game ability mapping is not identified from individual horse physiology.',
    sectionalDefinition: 'winnerFinal600 is the same winning horse crossing length-600 to finish; leaderFirst600 is earliest field crossing 600. JRA race final600 is not substituted for the winner final600.', rows };
  for (const split of [...new Set(rows.map(r => r.split))]) {
    const bank = rows.filter(r => r.split === split);
    for (const [metric, threshold] of [['winnerTime', POLICY.realWinnerTimeRelativeMax], ['winnerFinal600', POLICY.realWinnerFinal600RelativeMax],
      ['leaderFirst600', POLICY.realLeaderFirst600RelativeMax]]) {
      const absolute = distribution(bank.map(r => Math.abs(r.residual[metric].relative)));
      check(report, split + ' real G1 ' + metric + ' coarse external timing residual',
        absolute.n === bank.length && absolute.max <= threshold, { threshold, relativeAbsoluteResidual: absolute }, 'empirical');
    }
  }
}
function runValidation(options = {}) {
  const perCell = Math.max(1, Math.floor(options.perCell || 2));
  const calibrationOnly = Boolean(options.calibrationOnly), beforeHash = engineHash();
  if (options.expectHash && options.expectHash !== beforeHash) throw new Error('Engine does not match approved frozen hash');
  const banks = calibrationOnly ? { calibration: SEED_BANKS.calibration } : SEED_BANKS;
  const baseline = options.skipAB ? null : loadBaseline();
  const report = { schemaVersion: 2, version: '2026.10.02.1', engineSha256: beforeHash,
    baselineCommit: BASELINE, baselineSha256: baseline?.hash ?? null,
    baselineLoader: 'private-global Function wrapper; verified equivalent to vm on 1200/3200 m and leaves the current engine untouched',
    hashConvention: 'UTF-8 sim.js CRLF normalized to LF, SHA-256, retains source BOM',
    configuration: { perCell, distances: DISTANCES, directions: DIRECTIONS, courses: COURSES, surfaces: SURFACES,
      fieldKinds: KINDS, seedBanks: banks, dt: 1 / 30, fieldSize: 8, fieldLevel: 70,
      matchedSurfaceAptitude: true, state: '良', profile: '平坦',
      physicsParameters: clone(S.RACE_F), calibrationOnly }, policy: POLICY, checks: [], cells: [], samples: [], warnings: [], pairedVersion: [] };
  const fittingPath = path.join(ROOT, 'docs', 'race-physiology-fit-v2026.10.02.1.json');
  if (fs.existsSync(fittingPath)) {
    const fitting = JSON.parse(fs.readFileSync(fittingPath, 'utf8'));
    report.fittingProvenance = { file: path.relative(ROOT, fittingPath), selectionSourceSha256: fitting.sourceSha256,
      validationSourceSha256: beforeHash, sourceChangedSinceSelection: fitting.sourceSha256 !== beforeHash,
      selectedCandidate: fitting.selected?.id ?? null, selectedParameters: fitting.selected?.parameters ?? null,
      selectedParametersMatchValidation: Object.entries(fitting.selected?.parameters || {}).every(([k, v]) => S.RACE_F[k] === v),
      trainingHoldoutEvaluated: fitting.holdoutEvaluated, trainingFieldLevel: fitting.trainingBank?.fieldLevel,
      explanation: 'Global game parameters were selected on 2023/2024 only. Generation and jockey code may subsequently change; this independent source-locked validation checks the actual final engine rather than treating the selection snapshot as final validation.' };
  }
  const seen = new Set(), total = Object.keys(banks).length * DISTANCES.length * DIRECTIONS.length * COURSES.length * SURFACES.length * KINDS.length * perCell;
  for (const [cohort, firstSeed] of Object.entries(banks)) {
    for (let li = 0; li < DISTANCES.length; li++) for (let di = 0; di < DIRECTIONS.length; di++)
      for (let ci = 0; ci < COURSES.length; ci++) for (let si = 0; si < SURFACES.length; si++) {
        for (const kind of KINDS) {
          const length = DISTANCES[li], dir = DIRECTIONS[di], course = COURSES[ci], surface = SURFACES[si], rows = [];
          for (let k = 0; k < perCell; k++) {
            const seed = (firstSeed + li * 1000003 + di * 200003 + ci * 70001 + si * 30011 + k * 7919) >>> 0;
            if (kind === 'generated') { if (seen.has(seed)) throw new Error('Seed banks overlap'); seen.add(seed); }
            const field = buildField(seed, kind, surface), raceSeed = (Math.imul(seed, 31) + 7) >>> 0;
            const raceOptions = { length, dir, course, surface, seed: raceSeed, state: '良', profile: '平坦' };
            const r = simulate(field, raceOptions);
            const row = { cohort, kind, length, dir, course, surface, seed, raceSeed, ...concise(r) };
            rows.push(row); report.samples.push(row);
            if (baseline && cohort === 'calibration' && kind === 'generated') {
              const old = simulate(field, raceOptions, 1 / 30, null, baseline.api);
              report.pairedVersion.push({ length, dir, course, surface, seed, baseline: concise(old), current: concise(r),
                difference: Object.fromEntries(['winnerTime', 'final600', 'margin', 'tail', 'peakSpeed'].map(key => [key, r[key] - old[key]])) });
            }
          }
          report.cells.push({ cohort, kind, length, dir, course, surface, ...summarize(rows) });
          if (options.onProgress && report.cells.length % 12 === 0) options.onProgress(report.samples.length, total);
        }
      }
  }
  check(report, 'all matrix races finish with eight finishers, finite state and bounded reserves',
    report.samples.every(r => r.finished && r.finite && r.bounded), { races: report.samples.length });
  check(report, 'all matrix actual work is paid by aerobic supply and finite reserve',
    report.samples.every(r => r.energyAccountingAvailable && r.energyConserving === true), { accountingError: distribution(report.samples.map(r => r.energyAccountingError)),
      unpaidWork: distribution(report.samples.map(r => r.unpaidWork)) });
  check(report, 'physical broad bounds: timing, speed, finite acceleration and lateral motion', report.samples.every(r =>
    r.winnerTime >= r.length / 24 && r.winnerTime <= r.length / 10 + 10 && r.peakSpeed > 10 && r.peakSpeed < 28 &&
    r.firstSpeed >= 0 && r.firstSpeed < 1 && r.final600 >= 20 && r.final600 <= 80 && r.maxAcceleration < 5 && r.maxLateralSpeed < 1.5),
    { winnerTime: distribution(report.samples.map(r => r.winnerTime)), peakSpeed: distribution(report.samples.map(r => r.peakSpeed)),
      acceleration: distribution(report.samples.map(r => r.maxAcceleration)), lateralSpeed: distribution(report.samples.map(r => r.maxLateralSpeed)) });
  report.cohortSummaries = [];
  for (const cohort of Object.keys(banks)) for (const kind of KINDS) {
    const rows = report.samples.filter(r => r.cohort === cohort && r.kind === kind), summary = summarize(rows);
    report.cohortSummaries.push({ cohort, kind, ...summary });
    if (kind === 'generated') check(report, cohort + ' generated margins retain median <=3 / P90 <=10 lengths',
      summary.margin.n === rows.length && summary.margin.median <= POLICY.medianMarginMax && summary.margin.p90 <= POLICY.p90MarginMax, summary.margin);
  }
  if (baseline) {
    if (report.pairedVersion.some(r => !r.baseline.energyAccountingAvailable))
      report.warnings.push('The baseline engine has no cumulative aerobic / reserve work telemetry. Its energyAccountingAvailable is false and energyConserving is null; conservation has not been established or disproved for that version. Current-engine conservation gates still require telemetry and a passing result.');
    const keys = ['winnerTime', 'final600', 'margin', 'tail', 'peakSpeed'];
    report.pairedVersionSummary = Object.fromEntries(keys.map(key => [key, { baseline: distribution(report.pairedVersion.map(r => r.baseline[key])),
      current: distribution(report.pairedVersion.map(r => r.current[key])), difference: distribution(report.pairedVersion.map(r => r.difference[key])) }]));
    check(report, 'paired old / new comparison completes on exactly the same field and race input',
      report.pairedVersion.every(r => r.baseline.finished && r.baseline.finite && r.current.finished && r.current.finite), { pairs: report.pairedVersion.length });
  }
  pairedEffects(report); labelInvariance(report); stressCases(report); realReference(report, calibrationOnly);
  const finalHash = engineHash(); check(report, 'source hash unchanged during all validation', beforeHash === finalHash,
    { before: beforeHash, after: finalHash });
  report.warnings.push('Position categories are observational ranks when the leader enters the final straight, not the legacy horse style label. No forced 25% win quota is applied.');
  report.warnings.push('Operational margin bounds are project guardrails, not an asserted real-world distribution. A failed check is retained without relaxing its threshold.');
  report.warnings.push('Public physiological fitted parameters and G1 timing references do not identify this game\'s horse physiology. Empirical and engineering results are reported independently.');
  if (calibrationOnly) report.warnings.push('Both synthetic fresh holdout and 2025 JRA holdout remain unopened by this run.');
  report.engineeringPassed = report.checks.filter(c => c.domain === 'engineering').every(c => c.passed);
  report.empiricalPassed = report.checks.some(c => c.domain === 'empirical') ? report.checks.filter(c => c.domain === 'empirical').every(c => c.passed) : null;
  report.passed = report.engineeringPassed && report.empiricalPassed === true;
  return report;
}
function printReport(report) {
  console.log('v7 race validation | SHA-256 ' + report.engineSha256);
  for (const r of report.cohortSummaries) console.log(r.cohort + '/' + r.kind + ' ' + JSON.stringify({ races: r.winnerTime.n,
    time: r.winnerTime.median, marginMedian: r.margin.median, marginP90: r.margin.p90, tailMedian: r.tail.median,
    final600: r.final600.median, halfLeaderWinRate: r.halfLeaderWinRate, observedStyle: r.observedStyle }));
  for (const c of report.checks) console.log((c.passed ? 'PASS ' : 'FAIL ') + '[' + c.domain + '] ' + c.name + ' ' + JSON.stringify(c.measurements));
  console.log('engineeringPassed=' + report.engineeringPassed + ' empiricalPassed=' + report.empiricalPassed + ' passed=' + report.passed);
}
module.exports = { S, POLICY, engineHash, buildField, controlledHorse, simulate, isolatedTrial, distribution, pairedEffects, runValidation, printReport };
if (require.main === module) {
  const args = process.argv.slice(2), options = {}; let output = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--per-cell') options.perCell = Number(args[++i]);
    else if (args[i] === '--json') output = args[++i];
    else if (args[i] === '--calibration-only') options.calibrationOnly = true;
    else if (args[i] === '--expect-hash') options.expectHash = args[++i];
    else if (args[i] === '--skip-ab') options.skipAB = true;
    else throw new Error('Unknown argument: ' + args[i]);
  }
  if (options.perCell !== undefined && (!Number.isInteger(options.perCell) || options.perCell < 1)) throw new Error('Invalid per-cell count');
  options.onProgress = (completed, total) => console.error('Progress ' + completed + ' / ' + total);
  const report = runValidation(options); printReport(report);
  if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.passed ? 0 : 1;
}
