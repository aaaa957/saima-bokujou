#!/usr/bin/env node
'use strict';

// Diagnostic measurement only. No engine parameters or empirical thresholds are
// fitted here. Contexts and seeds are declared before any matrix is observed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const {S,engineHash}=require('./helpers/frozen-v8');
const ROOT = path.resolve(__dirname, '..');
const EXPECTED = '9b2cd208dd8d2e8415452d973a1bf76549222272accf1372bb616af14a2eeb8e';
const BASE_SEED = 3197100203;
const DT = 1 / 30;
const LABELS = ['逃', '先', '差', '追'];
const CASES = [
  { length: 1200, course: '中山芝外A', dir: '右回' },
  { length: 1600, course: '東京芝A', dir: '左回' },
  { length: 2000, course: '東京芝A', dir: '左回' },
  { length: 2400, course: '東京芝A', dir: '左回' },
  { length: 3000, course: '京都芝外A', dir: '右回' },
  { length: 3200, course: '京都芝外A', dir: '右回' },
];
const hash = engineHash;
function quantile(a, p) {
  a = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const q = (a.length - 1) * p, i = Math.floor(q);
  return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (q - i);
}
function dist(a) {
  a = a.filter(Number.isFinite);
  return { n: a.length, min: quantile(a, 0), p10: quantile(a, .1), median: quantile(a, .5), p90: quantile(a, .9), max: quantile(a, 1), mean: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null };
}
function category(rank, n) {
  if (rank === 1) return '逃';
  if (rank <= Math.ceil(n * .375)) return '先';
  if (rank <= Math.ceil(n * .625)) return '差';
  return '追';
}
function fieldFor(job) {
  const field = S.makeField(S.mulberry32(job.seed), { n: job.n, level: 70 });
  for (const h of field) {
    h.surface = '草地'; h.special = '左右皆可';
    if (job.context !== 'native-official') {
      h['疲劳'] = 0; h['斗志'] = 50; h.jockeyGrade = '普通';
      h.carriedWeight = 57; h.bodyMass = 480;
    }
    if (job.context === 'equal-ability-flat') {
      for (const key of Object.keys(h.stats)) h.stats[key] = 70;
      // Preserve generated behavior/plan. This unifies the whole ability vector
      // (both its mean and spread), not just dispersion. Gates/traffic vary.
    }
  }
  return field;
}
function measure(job) {
  if (hash() !== EXPECTED) throw new Error('Frozen engine changed before trial');
  const field = fieldFor(job);
  const rc = S.createRace(field, { length: job.length, course: job.course, dir: job.dir,
    surface: '草地', state: '良', profile: '平坦', wind: 0, rng: S.mulberry32(job.raceSeed ?? job.seed) });
  const horses = rc.race.horses;
  const first600 = new Map(), actualDistance = new Map(horses.map(H => [H.id, 0]));
  const minAcceleration = new Map(horses.map(H => [H.id, 0]));
  const maxAcceleration = new Map(horses.map(H => [H.id, 0]));
  const snapshots = {}, crossingTimes = new Map();
  const straightMark = job.length - rc.race.geo.finishStraight;
  let leaderChanges = 0, previousLeader = null, maxWorkError = 0, maxReserveError = 0;
  let frames = 0, finite = true;
  while (!rc.race.finished && rc.race.t < 610 && frames++ < 18320) {
    const before = horses.map(H => ({ s: H.s, t: H.t, time: rc.race.t, place: H.place }));
    rc.step(DT);
    for (let i = 0; i < horses.length; i++) {
      const H = horses[i], old = before[i];
      if (!old.place) {
        const ds = Math.max(0, H.s - old.s);
        const mid = (H.s + old.s) / 2, lane = (H.t + old.t) / 2;
        actualDistance.set(H.id, actualDistance.get(H.id) + Math.hypot(ds / S.laneProgressCoef(mid, lane, rc.race.geo), H.t - old.t));
        minAcceleration.set(H.id, Math.min(minAcceleration.get(H.id), H.accel));
        maxAcceleration.set(H.id, Math.max(maxAcceleration.get(H.id), H.accel));
        if (!first600.has(H.id) && old.s < 600 && H.s >= 600)
          first600.set(H.id, old.time + DT * (600 - old.s) / Math.max(1e-12, H.s - old.s));
        if (!crossingTimes.has(H.id) && old.s < straightMark && H.s >= straightMark)
          crossingTimes.set(H.id, old.time + DT * (straightMark - old.s) / Math.max(1e-12, H.s - old.s));
      }
      finite = finite && [H.s, H.v, H.t, H.stamina, H.guts, H.retention].every(Number.isFinite);
      const st = H.statsSummary;
      maxWorkError = Math.max(maxWorkError, Math.abs(st.workUsed - st.aerobicUsed - st.energyUsed));
      maxReserveError = Math.max(maxReserveError, Math.abs(H.stamina - (H.staminaMax - st.energyUsed + st.recovered)));
    }
    if (!rc.race.order.length) {
      const order = horses.slice().sort((a, b) => b.s - a.s || a.gate - b.gate), leader = order[0];
      if (rc.race.t > 10) {
        if (previousLeader !== null && previousLeader !== leader.id) leaderChanges++;
        previousLeader = leader.id;
      }
      for (const [name, at] of [['half', job.length / 2], ['straight', straightMark], ['last600', job.length - 600]]) {
        if (!snapshots[name] && leader.s >= at) snapshots[name] = order.map((H, i) => ({ id: H.id, rank: i + 1,
          category: category(i + 1, job.n), gapMetres: leader.s - H.s, speed: H.v, reserve: H.stamina / H.staminaMax }));
      }
    }
  }
  const order = rc.race.order, winner = order[0];
  const passageOrder = horses.slice().sort((a, b) => (crossingTimes.get(a.id) ?? Infinity) - (crossingTimes.get(b.id) ?? Infinity));
  const records = horses.map(H => {
    const index = order.indexOf(H), straight = snapshots.straight?.find(x => x.id === H.id);
    const half = snapshots.half?.find(x => x.id === H.id), last600 = snapshots.last600?.find(x => x.id === H.id);
    const hasTime = Number.isFinite(H.time) && H.time > 0;
    const hasWinnerTime = Number.isFinite(winner?.time);
    return { id: H.id, place: H.place, time: H.time, meanNominalSpeed: hasTime ? job.length / H.time : null,
      meanPathSpeed: hasTime ? actualDistance.get(H.id) / H.time : null, travelledMetresApprox: actualDistance.get(H.id),
      extraMetresApprox: actualDistance.get(H.id) - job.length, final600: H.final3f,
      first600: H.sectionals.find(x => x.distance === 600)?.time ?? null, peakSpeed: H.statsSummary.peakSpeed,
      gapMetresAtWinner: H.gapAtWin, gapNominalLengths: H.gapAtWin / 2.4,
      timeBehindWinner: hasTime && hasWinnerTime ? H.time - winner.time : null,
      timeBehindPrevious: hasTime && index > 0 && Number.isFinite(order[index - 1].time) ? H.time - order[index - 1].time : null,
      gate: H.gate, initialLabel: H.historicalStyle, engineObservedStyle: H.observedStyle || H.style,
      straightCategory: straight?.category ?? null, straightRank: straight?.rank ?? null,
      straightGap: straight?.gapMetres ?? null, straightPassageRank: crossingTimes.has(H.id) ? passageOrder.indexOf(H) + 1 : null,
      halfRank: half?.rank ?? null, last600Rank: last600?.rank ?? null,
      blockedSeconds: H.statsSummary.blockedSeconds, draftSeconds: H.statsSummary.draftSeconds,
      reserveFraction: H.stamina / H.staminaMax, fatigueToleranceFraction: H.guts / H.gutsMax,
      retention: H.retention, minAcceleration: minAcceleration.get(H.id), maxAcceleration: maxAcceleration.get(H.id),
      launches: H.statsSummary.launches || 0, withdrawals: H.statsSummary.withdrawals || 0,
      stats: H.adj, initialFatigue: H.h['疲劳'], jockey: H.jockey, behavior: H.behavior, plan: H.plan,
      sectionals: H.sectionals.map(x => ({ distance: x.distance, time: x.time, split: x.split,
        reserveFraction: x.stamina / H.staminaMax, fatigueToleranceFraction: x.guts / H.gutsMax })) };
  });
  const w = records.find(x => x.place === 1), second = records.find(x => x.place === 2), last = records.find(x => x.place === job.n);
  return { ...job, engineHash: EXPECTED, finished: rc.race.finished && order.length === job.n && !rc.race.dnf.length,
    finite, maxWorkError, maxReserveError, maxUnpaidWork: Math.max(...horses.map(H => H.statsSummary.unpaidWork)),
    geo: { lap: rc.race.geo.lap, finishStraight: rc.race.geo.finishStraight, startOffset: rc.race.geo.startOffset,
      simplification: rc.race.geo.simplification, distanceSupported: rc.race.geo.distanceSupported },
    winnerTime: w?.time ?? null, winnerMeanSpeed: w?.meanNominalSpeed ?? null,
    winnerFinal600: w?.final600 ?? null, leaderFirst600: Math.min(...records.map(x => x.first600).filter(Number.isFinite)),
    winnerPeakSpeed: w?.peakSpeed ?? null, fieldPeakSpeed: Math.max(...records.map(x => x.peakSpeed)),
    marginLengths: second?.gapNominalLengths ?? null, marginSeconds: second?.timeBehindWinner ?? null,
    tailLengths: last?.gapNominalLengths ?? null, tailSeconds: last?.timeBehindWinner ?? null,
    leaderChanges, halfLeaderWon: w?.halfRank === 1, straightLeaderWon: w?.straightRank === 1,
    winnerStraightRank: w?.straightRank ?? null, winnerLast600Rank: w?.last600Rank ?? null,
    fastestFinal600Won: w?.final600 <= Math.min(...records.map(x => x.final600)) + 1e-9,
    raceSectionals: rc.race.sectionals, horses: records };
}
function styleTable(rows, key) {
  const countRows = rows.map(r => LABELS.map(style => ({ starts: r.horses.filter(h => h[key] === style).length,
    wins: r.horses.filter(h => h[key] === style && h.place === 1).length,
    top3: r.horses.filter(h => h[key] === style && Number.isFinite(h.place) && h.place > 0 && h.place <= 3).length })));
  return LABELS.map((style, j) => {
    const starts = countRows.reduce((a, r) => a + r[j].starts, 0), wins = countRows.reduce((a, r) => a + r[j].wins, 0);
    const top3 = countRows.reduce((a, r) => a + r[j].top3, 0), boot = [], rng = S.mulberry32(BASE_SEED + j);
    for (let b = 0; b < 600; b++) {
      let st = 0, wi = 0;
      for (let i = 0; i < rows.length; i++) { const c = countRows[Math.floor(rng() * rows.length)][j]; st += c.starts; wi += c.wins; }
      if (st) boot.push(wi / st);
    }
    return { style, starts, wins, top3, perStart: starts ? wins / starts : null,
      top3PerStart: starts ? top3 / starts : null, championShare: wins / rows.length,
      raceClusterBootstrap95: [quantile(boot, .025), quantile(boot, .975)] };
  });
}
function summarize(rows) {
  const out = { races: rows.length, starters: rows.reduce((n, r) => n + r.n, 0) };
  for (const key of ['winnerTime', 'winnerMeanSpeed', 'winnerFinal600', 'leaderFirst600', 'winnerPeakSpeed', 'fieldPeakSpeed',
    'marginLengths', 'marginSeconds', 'tailLengths', 'tailSeconds', 'leaderChanges', 'winnerStraightRank', 'winnerLast600Rank']) out[key] = dist(rows.map(r => r[key]));
  for (const key of ['halfLeaderWon', 'straightLeaderWon', 'fastestFinal600Won']) out[key] = rows.filter(r => r[key]).length / rows.length;
  const h = rows.flatMap(r => r.horses);
  for (const key of ['timeBehindWinner', 'timeBehindPrevious', 'final600', 'peakSpeed', 'blockedSeconds', 'draftSeconds', 'extraMetresApprox',
    'reserveFraction', 'fatigueToleranceFraction', 'retention', 'minAcceleration', 'maxAcceleration', 'launches']) out['horse_' + key] = dist(h.map(x => x[key]));
  out.style = { engineObserved: styleTable(rows, 'engineObservedStyle'), straightPositionProxy: styleTable(rows, 'straightCategory'), initialLabel: styleTable(rows, 'initialLabel') };
  return out;
}
if (!isMainThread) {
  try { for (const job of workerData.jobs) parentPort.postMessage({ row: measure(job) }); }
  catch (e) { parentPort.postMessage({ error: e.stack }); }
} else if (require.main === module) {
  const argv = process.argv.slice(2), arg = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const seeds = Math.max(1, Number(arg('--seeds', 24))), workers = Math.max(1, Number(arg('--workers', 2)));
  const seedPolicy = arg('--seed-policy', 'independent');
  if (!['independent', 'legacy'].includes(seedPolicy)) throw new Error('Invalid seed policy');
  const file = path.resolve(ROOT, arg('--out', 'docs/current-engine-population-audit-2026-10-02.json'));
  if (hash() !== EXPECTED) throw new Error('Wrong frozen engine');
  const jobs = [];
  for (const context of ['native-official', 'healthy-flat', 'equal-ability-flat']) {
    const repetitions = context === 'native-official' ? seeds : Math.max(1, Math.floor(seeds / 2));
    for (const n of context === 'native-official' ? [8, 16] : [16]) for (const c of CASES) for (let k = 0; k < repetitions; k++) {
      const seed = (BASE_SEED + k * 104729 + (context === 'native-official' ? n * 1000003 : 901003)) >>> 0;
      jobs.push({ context, n, length: c.length, course: context === 'native-official' ? c.course : '标准', dir: context === 'native-official' ? c.dir : '左回',
        seed, generationSeed: seed, raceSeed: seedPolicy === 'independent' ? (seed ^ 0x9e3779b9) >>> 0 : seed, seedPolicy, replicate: k });
    }
  }
  const report = { schemaVersion: 1, measuredAt: new Date().toISOString(), engineHash: EXPECTED,
    harnessSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n')).digest('hex'),
    protocol: { seeds, workers, seedPolicy, seedRule: 'Generation uses seed; independent race RNG uses seed XOR 0x9e3779b9. Legacy restarts both RNGs at seed and is retained as sampling sensitivity, not independent evidence.', totalRaces: jobs.length, dt: DT, level: 70, cases: CASES, contexts: [
      'native-official: default generated fatigue/jockey/ability/behavior, matched turf/direction, actual named proxy courses; distance and venue are confounded',
      'healthy-flat: generated abilities and behaviors, zero fatigue/50 morale/ordinary rider/480kg/57kg, same fixed abstract flat course and same fields across distances',
      'equal-ability-flat: healthy-flat with all stats=70, changing both mean and dispersion; generated behavior/plan preserved, so gates, RNG, traffic and behavioral differences remain. It is a combined ability-vector intervention, not a pure variance ablation.' ],
      style: 'Engine observed is average normalized rank at decisions from 80m to 80% distance. Straight proxy is rank when first horse reaches final straight: rank1 escape; 2..ceil(N*.375) forward; next to ceil(N*.625) middle; rest rear. Neither is an official JRA style label.',
      denominators: 'perStart=wins/starts; championShare=wins/races. Bootstrap resamples whole races within a cell, 600 replicates; it does not resolve post-race classification bias.',
      margins: 'gapAtWin/2.4m is a nominal length convention; official adjacent finishing margins are a different measurement. Time gaps are recorded separately.',
      speed: 'Nominal mean=official distance/time. Instantaneous peak is sampled at engine 60Hz; 200m average and race-leading sectionals are distinct.',
      accelerationSampling: 'Acceleration extrema read the last internal substep at each outer 30Hz observation; they are sampled diagnostics, not the full internal 60Hz extrema.',
      purpose: 'Describe current frozen engine and controlled contrasts. No empirical fitting, no style quota, no newly declared realism pass threshold.' }, samples: [] };
  const started = Date.now();
  console.log('Protocol frozen: ' + jobs.length + ' races, source ' + EXPECTED);
  const finish = () => {
    report.samples.sort((a, b) => a.context.localeCompare(b.context) || a.n - b.n || a.length - b.length || a.replicate - b.replicate);
    report.summaries = [];
    for (const key of [...new Set(report.samples.map(r => [r.context, r.n, r.length].join('|')))]) {
      const rows = report.samples.filter(r => [r.context, r.n, r.length].join('|') === key);
      report.summaries.push({ context: rows[0].context, n: rows[0].n, length: rows[0].length, course: rows[0].course, ...summarize(rows) });
    }
    report.afterHash = hash();
    report.checks = { allFinish: report.samples.every(r => r.finished), allFinite: report.samples.every(r => r.finite),
      maxWorkError: Math.max(...report.samples.map(r => r.maxWorkError)), maxReserveError: Math.max(...report.samples.map(r => r.maxReserveError)),
      maxUnpaidWork: Math.max(...report.samples.map(r => r.maxUnpaidWork)), sourceUnchanged: report.afterHash === EXPECTED,
      allExpectedRacesRecorded: report.samples.length === jobs.length };
    report.elapsedSeconds = (Date.now() - started) / 1000;
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    console.log('Saved ' + file + ' ' + JSON.stringify(report.checks) + ' seconds=' + report.elapsedSeconds.toFixed(1));
    for (const s of report.summaries) console.log(JSON.stringify({ context: s.context, n: s.n, length: s.length, races: s.races,
      time: s.winnerTime.median, margin: s.marginLengths.median, p90: s.marginLengths.p90, tail: s.tailLengths.median,
      styles: s.style.engineObserved.map(x => [x.style, x.starts, x.wins, x.perStart]) }));
  };
  let complete = 0, ended = 0, failed = false;
  const count = Math.min(workers, jobs.length);
  for (let i = 0; i < count; i++) {
    const worker = new Worker(__filename, { workerData: { jobs: jobs.filter((_, j) => j % count === i) } });
    worker.on('message', m => {
      if (m.error) { failed = true; console.error(m.error); process.exitCode = 1; return; }
      report.samples.push(m.row); complete++;
      if (complete % 12 === 0 || complete === jobs.length) console.log('Measured ' + complete + '/' + jobs.length + ' elapsed=' + ((Date.now() - started) / 1000).toFixed(1) + 's');
    });
    worker.on('error', e => { failed = true; console.error(e); process.exitCode = 1; });
    worker.on('exit', code => { ended++; if (code) failed = true; if (ended === count) { if (!failed) finish(); else { fs.writeFileSync(file + '.partial', JSON.stringify(report, null, 2)); process.exitCode = 1; } } });
  }
}
module.exports = { measure, summarize, styleTable, category, hash, CASES, EXPECTED };
