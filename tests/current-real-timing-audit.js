#!/usr/bin/env node
'use strict';

// Diagnostic replay of already-viewed JRA references. No fitting, engine edits,
// fresh holdout claims, or replacement of race-leading splits by winner splits.
const fs = require('node:fs');
const path = require('node:path');
const { POLICY, simulate, distribution } = require('./race-calibration-v7');
const {S,engineHash,readArchived}=require('./helpers/frozen-v8');
const ROOT = path.resolve(__dirname, '..');
const EXPECTED = '9b2cd208dd8d2e8415452d973a1bf76549222272accf1372bb616af14a2eeb8e';
const REF = path.join(ROOT, 'docs/race-reality-reference.json');
const OUT = path.join(ROOT, 'docs/current-real-timing-audit-2026-10-02.json');
const MD = path.join(ROOT, 'docs/current-real-timing-audit-2026-10-02.md');
const FULL_REF = path.join(ROOT, 'docs/current-engine-reality-sources-2026-10-02.json');
const DISTANCES = [1200, 1600, 2000, 2400, 3000, 3200];
const LABELS = ['逃', '先', '差', '追'];
const GROUPS = ['fixed-eight', 'actual-field-size', 'actual-field-size-independent-stream'];
const PRIMARY_GROUP = 'actual-field-size-independent-stream';
// The old reference used declared entries for these two races; official reports
// contain one scratched horse each. Keep the original count alongside the actual.
const FIELD_SIZE_CORRECTIONS = Object.freeze({ '240428': 17, '251130': 17 });
const DT = 1 / 30;
const clone = x => JSON.parse(JSON.stringify(x));
const median = a => distribution(a).median;
const rounded01 = v => Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 10) / 10 : null;
const cv = a => {
  if (!a.length || !a.every(Number.isFinite)) return null;
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length) / mean;
};
const hashText = t => require('node:crypto').createHash('sha256').update(t.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

function fieldFor(sample, seed, n) {
  const field = S.makeField(S.mulberry32(seed), { n, level: 86 });
  for (const h of field) {
    h.surface = sample.surface; h.special = '左右皆可';
    h['疲劳'] = 0; h['斗志'] = 50; h.jockeyGrade = '优秀';
    h.carriedWeight = sample.winner.carriedWeightKg ?? 58;
    h.bodyMass = sample.winner.bodyWeightKg ?? 480;
  }
  return field;
}
function actualOf(sample) {
  const p = sample.raceSectionals200m;
  return { winnerTime: sample.winner.finishTime, winnerNominalMeanSpeed: sample.length / sample.winner.finishTime,
    winnerFinal600: sample.winner.final600, winnerFinal600MeanSpeed: 600 / sample.winner.final600,
    leaderFirst600: sample.first600, leaderFirst600MeanSpeed: 600 / sample.first600,
    leaderFinal600: sample.raceFinal600, leaderFinal600MeanSpeed: 600 / sample.raceFinal600,
    leaderPost200SplitCv: cv(p.slice(1)), leaderSectionals200m: p.slice(),
    leaderEarlyLateSpeedRatio: sample.raceFinal600 / sample.first600 };
}
function serialiseRun(sample, seed, n, r, elapsedSeconds, raceSeed = seed) {
  const horses = r.rc.race.horses.map(H => {
    const at = r.positionSnapshot.find(p => p.id === H.id);
    const first600 = H.sectionals.find(p => p.distance === 600)?.time ?? null;
    return { id: H.id, name: H.name, gate: H.gate, place: H.place, time: H.time,
      nominalMeanSpeed: H.time ? sample.length / H.time : null,
      final600: H.final3f, final600MeanSpeed: H.final3f ? 600 / H.final3f : null,
      first600, peakSpeed: H.statsSummary.peakSpeed,
      gapAtWinMeters: H.gapAtWin, gapAtWinLengths: H.gapAtWin == null ? null : H.gapAtWin / 2.4,
      timeBehindWinner: H.time == null ? null : H.time - r.winnerTime,
      finishStraightEntryRank: at?.rank ?? null, finishStraightEntryCategory: at?.category ?? null,
      finishStraightEntryGapMeters: at?.gap ?? null,
      historicalStyle: H.historicalStyle ?? H.h.style, engineObservedStyle: H.observedStyle ?? null,
      stamina: H.stamina, staminaMax: H.staminaMax, finishReserveFraction: H.stamina / H.staminaMax,
      guts: H.guts, gutsMax: H.gutsMax, finishGutsFraction: H.guts / H.gutsMax, retention: H.retention,
      bodyMass: H.bodyMass, carriedWeight: H.carriedWeight,
      stats: clone(H.h.stats), adjustedStats: clone(H.adj), behavior: clone(H.behavior), racePlan: clone(H.plan),
      statistics: clone(H.statsSummary),
      sectionals200m: H.sectionals.map(x => ({ distance: x.distance, time: x.time, seconds: x.split,
        nominalMeanSpeed: 200 / x.split, reserve: x.stamina, guts: x.guts })) };
  });
  const winner = horses.find(H => H.place === 1), splits = r.rc.race.sectionals.map(x => x.split);
  const leaderFinal600 = splits.slice(-3).reduce((x, y) => x + y, 0);
  const leaderFirst600 = splits.slice(0, 3).reduce((x, y) => x + y, 0);
  return { seed, fieldGenerationSeed: seed, raceSeed, requestedFieldSize: n, actualFieldSize: horses.length, elapsedSeconds,
    finished: r.finished, finite: r.finite, bounded: r.bounded,
    energyConserving: r.energyConserving, energyAccountingError: r.energyAccountingError, unpaidWork: r.unpaidWork,
    peakSpeed: r.peakSpeed, maxAcceleration: r.maxAcceleration, maxLateralSpeed: r.maxLateralSpeed,
    winnerId: winner?.id ?? null, winnerTime: winner?.time ?? null,
    winnerNominalMeanSpeed: winner?.nominalMeanSpeed ?? null,
    winnerFinal600: winner?.final600 ?? null, winnerFinal600MeanSpeed: winner?.final600MeanSpeed ?? null,
    winnerFirst600: winner?.first600 ?? null,
    leaderFirst600, leaderFirst600MeanSpeed: 600 / leaderFirst600,
    leaderFinal600, leaderFinal600MeanSpeed: 600 / leaderFinal600,
    leaderPost200SplitCv: cv(splits.slice(1)),
    leaderEarlyLateSpeedRatio: leaderFinal600 / leaderFirst600,
    leaderSectionals200m: splits,
    leaderSectionalMarkers: clone(r.rc.race.sectionals),
    winnerObservedStyle: r.winnerObservedStyle, finishStraightEntrySnapshot: r.positionSnapshot,
    finishStraightEntryRaceDistance: sample.length - (r.rc.race.geo.finishStraight || r.rc.race.geo.S),
    nominalFinalStraightLength: r.rc.race.geo.finishStraight || r.rc.race.geo.S,
    halfLeaderWon: r.halfLeaderWon, leadChanges: r.leadChanges, strategyChanges: r.strategyChanges,
    marginLengths: r.margin, tailLengths: r.tail,
    attackedHorses: horses.filter(H => H.statistics.sprintAt != null).length,
    blockedSeconds: horses.reduce((x, H) => x + (H.statistics.blockedSeconds || 0), 0),
    draftSeconds: horses.reduce((x, H) => x + (H.statistics.draftSeconds || 0), 0), horses };
}
function completeRow(row) {
  const keys = ['winnerTime', 'winnerNominalMeanSpeed', 'winnerFinal600', 'winnerFinal600MeanSpeed',
    'leaderFirst600', 'leaderFirst600MeanSpeed', 'leaderFinal600', 'leaderFinal600MeanSpeed',
    'leaderPost200SplitCv', 'leaderEarlyLateSpeedRatio'];
  row.predicted = Object.fromEntries(keys.map(k => [k, median(row.runs.map(r => r[k]))]));
  row.residual = Object.fromEntries(keys.map(k => [k, { difference: row.predicted[k] - row.actual[k],
    relative: (row.predicted[k] - row.actual[k]) / row.actual[k] }]));
  for (const [k, actualKey] of [['winnerTimeRounded01', 'winnerTime'], ['winnerFinal600Rounded01', 'winnerFinal600'],
    ['leaderPost200SplitCvRounded01', 'leaderPost200SplitCv'], ['leaderPost200SplitCvRounded01MarkerTimes', 'leaderPost200SplitCv']]) {
    if (row.runs.every(r => Number.isFinite(r[k]))) {
      row.predicted[k] = median(row.runs.map(r => r[k]));
      row.residual[k] = { difference: row.predicted[k] - row.actual[actualKey],
        relative: (row.predicted[k] - row.actual[actualKey]) / row.actual[actualKey] };
    }
  }
  row.predicted.leaderSectionals200m = row.actual.leaderSectionals200m.map((_, i) => median(row.runs.map(r => r.leaderSectionals200m[i])));
  row.residual.leaderSectionals200m = row.actual.leaderSectionals200m.map((v, i) => ({ distance: (i + 1) * 200,
    seconds: row.predicted.leaderSectionals200m[i] - v,
    relative: (row.predicted.leaderSectionals200m[i] - v) / v }));
  row.leaderSectionalMeanAbsoluteError = row.residual.leaderSectionals200m.reduce((x, y) => x + Math.abs(y.seconds), 0) / row.residual.leaderSectionals200m.length;
  row.diagnosticLegacyThresholds = [
    ['winnerTime', POLICY.realWinnerTimeRelativeMax], ['winnerFinal600', POLICY.realWinnerFinal600RelativeMax],
    ['leaderFirst600', POLICY.realLeaderFirst600RelativeMax]
  ].map(([metric, limit]) => ({ metric, limit, absoluteRelativeResidual: Math.abs(row.residual[metric].relative),
    withinLimit: Math.abs(row.residual[metric].relative) <= limit }));
}
function styles(runs) {
  return LABELS.map(style => {
    const starts = runs.reduce((x, r) => x + r.horses.filter(H => H.finishStraightEntryCategory === style).length, 0);
    const wins = runs.filter(r => r.winnerObservedStyle === style).length;
    return { style, starts, wins, perStartWinRate: starts ? wins / starts : null,
      championShare: runs.length ? wins / runs.length : null };
  });
}
function additionalRunMetrics(run) {
  run.fieldGenerationSeed = run.fieldGenerationSeed ?? run.seed;
  run.raceSeed = run.raceSeed ?? run.seed;
  const horses = run.horses.filter(H => Number.isFinite(H.time)).slice().sort((a, b) => a.place - b.place);
  const times = horses.map(H => H.time), final600 = horses.map(H => H.final600).filter(Number.isFinite);
  const p = run.leaderSectionals200m;
  const roundedTimes = times.map(rounded01), roundedWinnerTime = rounded01(run.winnerTime);
  const roundedSplits = p.map(rounded01), roundedMarkerTimes = run.leaderSectionalMarkers.map(s => rounded01(s.time));
  const roundedMarkerSplits = roundedMarkerTimes.map((t, i) => t - (roundedMarkerTimes[i - 1] || 0));
  Object.assign(run, { runnerUpTimeGap: horses.length > 1 ? horses[1].time - horses[0].time : null,
    fieldFirstLastTimeSpan: times.length ? Math.max(...times) - Math.min(...times) : null,
    fieldFractionWithin1Second: horses.filter(H => H.time - run.winnerTime <= 1).length / horses.length,
    fieldFractionWithin2Seconds: horses.filter(H => H.time - run.winnerTime <= 2).length / horses.length,
    fieldFinal600Span: final600.length ? Math.max(...final600) - Math.min(...final600) : null,
    leaderFirst200: p[0], leaderFastest200: Math.min(...p), leaderFastest200AverageSpeed: 200 / Math.min(...p),
    leaderLast200: p.at(-1), leaderLast200AverageSpeed: 200 / p.at(-1),
    leaderFinal200MinusPrevious200Seconds: p.at(-1) - p.at(-2),
    leaderFinal600MinusFirst600Seconds: run.leaderFinal600 - run.leaderFirst600,
    winnerTimeRounded01: roundedWinnerTime, winnerFinal600Rounded01: rounded01(run.winnerFinal600),
    runnerUpTimeGapRounded01: horses.length > 1 ? roundedTimes[1] - roundedTimes[0] : null,
    fieldFirstLastTimeSpanRounded01: Math.max(...roundedTimes) - Math.min(...roundedTimes),
    fieldFractionWithin1SecondRounded01: roundedTimes.filter(t => t - roundedWinnerTime <= 1 + 1e-9).length / roundedTimes.length,
    fieldFractionWithin2SecondsRounded01: roundedTimes.filter(t => t - roundedWinnerTime <= 2 + 1e-9).length / roundedTimes.length,
    leaderSectionals200mRounded01: roundedSplits, leaderPost200SplitCvRounded01: cv(roundedSplits.slice(1)),
    leaderSectionals200mRounded01MarkerTimes: roundedMarkerSplits,
    leaderPost200SplitCvRounded01MarkerTimes: cv(roundedMarkerSplits.slice(1)) });
  for (const H of run.horses) {
    H.finishStraightToFinishPositionGain = H.finishStraightEntryRank == null ? null : H.finishStraightEntryRank - H.place;
    H.timeRounded01 = rounded01(H.time); H.final600Rounded01 = rounded01(H.final600);
    H.timeBehindWinnerRounded01 = H.timeRounded01 - roundedWinnerTime;
  }
}
function summarize(rows) {
  const runs = rows.flatMap(r => r.runs), horses = runs.flatMap(r => r.horses);
  const result = { referenceRaces: rows.length, engineRuns: runs.length, horseStarts: horses.length,
    raceMetrics: {}, horseMetrics: {}, residual: {}, finishStraightEntryStyles: styles(runs) };
  for (const k of ['winnerTime', 'winnerNominalMeanSpeed', 'winnerFinal600', 'leaderFirst600', 'leaderFinal600',
    'leaderPost200SplitCv', 'leaderEarlyLateSpeedRatio', 'peakSpeed', 'marginLengths', 'tailLengths',
    'leadChanges', 'strategyChanges', 'attackedHorses', 'blockedSeconds', 'draftSeconds', 'runnerUpTimeGap',
    'fieldFirstLastTimeSpan', 'fieldFractionWithin1Second', 'fieldFractionWithin2Seconds', 'fieldFinal600Span',
    'leaderFirst200', 'leaderFastest200', 'leaderFastest200AverageSpeed', 'leaderLast200', 'leaderLast200AverageSpeed',
    'leaderFinal200MinusPrevious200Seconds', 'leaderFinal600MinusFirst600Seconds',
    'winnerTimeRounded01', 'winnerFinal600Rounded01', 'runnerUpTimeGapRounded01', 'fieldFirstLastTimeSpanRounded01',
    'fieldFractionWithin1SecondRounded01', 'fieldFractionWithin2SecondsRounded01',
    'leaderPost200SplitCvRounded01', 'leaderPost200SplitCvRounded01MarkerTimes']) result.raceMetrics[k] = distribution(runs.map(r => r[k]));
  for (const k of ['time', 'nominalMeanSpeed', 'final600', 'final600MeanSpeed', 'peakSpeed', 'gapAtWinLengths',
    'timeBehindWinner', 'finishReserveFraction', 'finishGutsFraction', 'retention', 'finishStraightToFinishPositionGain',
    'timeRounded01', 'final600Rounded01', 'timeBehindWinnerRounded01']) result.horseMetrics[k] = distribution(horses.map(H => H[k]));
  for (const k of ['winnerTime', 'winnerNominalMeanSpeed', 'winnerFinal600', 'leaderFirst600', 'leaderFinal600', 'leaderPost200SplitCv',
    'winnerTimeRounded01', 'winnerFinal600Rounded01', 'leaderPost200SplitCvRounded01', 'leaderPost200SplitCvRounded01MarkerTimes'])
    result.residual[k] = { signed: distribution(rows.map(r => r.residual[k].difference)),
      signedRelative: distribution(rows.map(r => r.residual[k].relative)),
      absoluteRelative: distribution(rows.map(r => Math.abs(r.residual[k].relative))) };
  result.leaderSectionalMeanAbsoluteError = distribution(rows.map(r => r.leaderSectionalMeanAbsoluteError));
  result.halfLeaderWinRate = runs.filter(r => r.halfLeaderWon).length / runs.length;
  result.finishStraightLeaderWinRate = runs.filter(r => r.winnerObservedStyle === '逃').length / runs.length;
  result.attackedHorseFraction = runs.reduce((n, r) => n + r.attackedHorses, 0) / horses.length;
  return result;
}
function fullFieldComparison(report) {
  if (!fs.existsSync(FULL_REF)) return { available: false, reason: 'Full per-horse official reference is not available yet.' };
  const sourceText = fs.readFileSync(FULL_REF, 'utf8'), reference = JSON.parse(sourceText);
  const metrics = ['runnerUpTimeGap', 'fieldFirstLastTimeSpan', 'fieldFractionWithin1Second', 'fieldFractionWithin2Seconds', 'fieldFinal600Span',
    'runnerUpTimeGapRounded01', 'fieldFirstLastTimeSpanRounded01', 'fieldFractionWithin1SecondRounded01', 'fieldFractionWithin2SecondsRounded01'];
  const result = { available: true, referenceFile: path.relative(ROOT, FULL_REF), referenceSha256: hashText(sourceText),
    fractionDenominator: 'finishers with official finishTime, excluding DNF/cancellations; same finite-time denominator in simulation',
    timeQuantizationCaveat: 'Official finishTime is 0.1s; a zero reported runner-up gap may have a nonzero photo-finish margin.',
    marginCaveat: 'Official adjacent lengths and simulated instantaneous gapAtWin lengths are not assumed to be the same measured quantity.',
    unmatchedOpponentsCaveat: 'Size-matched generated fields are not reconstructions of the real horses and their capacity/state distribution.',
    rows: [], summaries: [] };
  for (const row of report.rows) {
    const race = reference.races.find(r => r.id === row.id);
    if (!race) continue;
    const horses = race.horses.filter(H => Number.isFinite(H.finishTime)).slice().sort((a, b) => a.finishPosition - b.finishPosition);
    const winnerTime = horses[0].finishTime, final600 = horses.map(H => H.final600).filter(Number.isFinite);
    const actual = { runnerUpTimeGap: horses[1].finishTime - winnerTime,
      fieldFirstLastTimeSpan: horses.at(-1).finishTime - winnerTime,
      fieldFractionWithin1Second: horses.filter(H => H.finishTime - winnerTime <= 1 + 1e-9).length / horses.length,
      fieldFractionWithin2Seconds: horses.filter(H => H.finishTime - winnerTime <= 2 + 1e-9).length / horses.length,
      fieldFinal600Span: Math.max(...final600) - Math.min(...final600) };
    for (const k of metrics.filter(k => k.endsWith('Rounded01'))) actual[k] = actual[k.replace('Rounded01', '')];
    const predicted = Object.fromEntries(metrics.map(k => [k, median(row.runs.map(r => r[k]))]));
    result.rows.push({ group: row.group, id: row.id, length: row.length, simulationFieldSize: row.fieldSize,
      realStarters: race.fieldSize, realFinishers: horses.length, source: clone(race.source), actual, predicted,
      residual: Object.fromEntries(metrics.map(k => [k, predicted[k] - actual[k]])) });
  }
  for (const group of GROUPS) for (const length of [null, ...DISTANCES]) {
    const rows = result.rows.filter(r => r.group === group && (length == null || r.length === length));
    result.summaries.push({ group, length, races: rows.length, metrics: Object.fromEntries(metrics.map(k => [k,
      { actual: distribution(rows.map(r => r.actual[k])), predicted: distribution(rows.map(r => r.predicted[k])),
        pairedDifference: distribution(rows.map(r => r.residual[k])) }])) });
  }
  return result;
}
function finishReport(report) {
  report.rows.forEach(row => row.runs.forEach(additionalRunMetrics));
  report.rows.forEach(completeRow);
  report.summaries = GROUPS.map(group => ({ group, overall: summarize(report.rows.filter(r => r.group === group)),
    byDistance: DISTANCES.map(length => ({ length, ...summarize(report.rows.filter(r => r.group === group && r.length === length)) })),
    historicalSplits: ['calibration', 'holdout'].map(originalSplit => ({ originalSplit,
      ...summarize(report.rows.filter(r => r.group === group && r.originalSplit === originalSplit)) })) }));
  report.finalEngineSha256 = engineHash();
  const runs = report.rows.flatMap(r => r.runs);
  const sectionalsErrors = runs.flatMap(run => run.horses.map(H => Math.abs((H.sectionals200m.at(-1)?.time ?? NaN) - H.time)));
  const final600Errors = report.rows.flatMap(row => row.runs.flatMap(run => run.horses.map(H => {
    const from = H.sectionals200m.find(s => s.distance === row.length - 600)?.time;
    return Math.abs(H.final600 - (H.time - from));
  })));
  report.integrity = { engineUnchanged: report.engineSha256 === report.finalEngineSha256,
    engineMatchesFrozenVersion: report.engineSha256 === EXPECTED,
    expectedRuns: 162, actualRuns: runs.length,
    allRacesFinished: runs.every(r => r.finished && r.actualFieldSize === r.requestedFieldSize),
    allFiniteBounded: runs.every(r => r.finite && r.bounded),
    allEnergyConserving: runs.every(r => r.energyConserving),
    oneRowPerGroupAndReference: new Set(report.rows.map(r => r.group + ':' + r.id)).size === report.rows.length,
    allSeedStreamsMatchDeclaredRule: report.rows.every(row => row.runs.every(r => r.raceSeed ===
      (row.group === PRIMARY_GROUP ? (r.fieldGenerationSeed ^ 0x9e3779b9) >>> 0 : r.fieldGenerationSeed))),
    allSectionalFinishIdentitiesFinite: [...sectionalsErrors, ...final600Errors].every(Number.isFinite),
    maxFinalSectionalVersusFinishTimeError: Math.max(...sectionalsErrors),
    maxSameHorseFinal600IdentityError: Math.max(...final600Errors),
    maxAccountingError: Math.max(...runs.map(r => r.energyAccountingError)),
    maxUnpaidWork: Math.max(...runs.map(r => r.unpaidWork)) };
  report.complete = report.integrity.actualRuns === report.integrity.expectedRuns && report.integrity.engineUnchanged;
  report.completedAt = new Date().toISOString();
  report.externalFieldComparison = fullFieldComparison(report);
}
function markdown(report) {
  const f = (v, digits = 3) => Number.isFinite(v) ? v.toFixed(digits) : '无数据';
  const pct = v => f(v * 100, 2) + '%';
  const lines = ['# 当前冻结引擎：真实赛事时间、速度与分段审计', '',
    '这是系统诊断，不进行调参或改动引擎。18 场旧参照已经被查看过，2025 年原留出组也属于已看过数据；本次复跑不是新的独立留出验证。', '',
    `引擎版本 v2026.10.02.2 / 582ce90；规范化 SHA-256：\`${report.engineSha256}\`。结束 SHA 相同：${report.integrity.engineUnchanged}。`, '',
    '固定 86 级生成场、优秀骑手、疲劳 0、斗志 50、左右皆可、草地适性匹配、480 kg 马体重、全场使用该真实赛事冠军负重、静风和默认 A 栏。每个距离的三个种子延续 v7，跨年份共用种子，重复之间并非全体独立抽样。真实逐马能力、体重、负重、战术及天气没有复刻，冠军外部残差属于 G1 速度量级对照。', '',
    '三个组各 54 次：固定 8 匹历史复跑、真实出马数 11–18 匹历史同种子复跑、真实出马数生成与比赛分开种子主评估。实赛 18 场覆盖 G1 草地良/稍重，不能外推到全部等级、泥地和重/不良。', '',
    '历史两组沿用生成与比赛同 seed 重新初始化 RNG 的 v7 口径，保留作历史复核。主评估组 `actual-field-size-independent-stream` 使用 fieldGenerationSeed=旧 seed，raceSeed=(seed XOR 0x9e3779b9)>>>0，避免两段随机过程重复利用相同随机序列开头；这仍是可复现伪随机流分离，不宣称严格统计独立。该采样纠正没有改变引擎参数或删除旧样本。', '',
    '旧库 240428（2024 天皇春）与 251130（2025 日本杯）的 18 是报名数，各有一匹取消；真实规模组使用 17 匹实际出走数。旧数仍保留为 `reportedRealFieldSizeInOldReference`，没有悄悄覆盖来源记录。', '',
    '冠军末 600 米使用引擎记录的同一冠军 `final3f`；首马 200 米分段使用各路标最早到达的时间，途中领跑者可能变化。名义均速为赛程 / 时间；峰值速度为引擎实际运动速度，两者在外绕时不是同一物理口径。首马分段排除起步第一段后的变异系数用于描述配速形状。', '',
    '分辨率敏感性保留连续值与四舍五入至 0.1 秒的冠军时间、逐馬时间、末600、秒差、1/2 秒内比例。分段 CV 同时计算“每个200米分段直接取0.1秒”与“各累计首马路标先取0.1秒再作差”两种版本；官方数据本身已为0.1秒。这是显示精度敏感性，并不声称JRA全部计时规则就是此四舍五入规则。', '',
    '终直入口分类采用领跑马跨过模拟末直入口时的全场排名：1=逃，2 至 ceil(N×0.375)=先，随后至 ceil(N×0.625)=差，其余=追。这是一个赛中位置观测，非马匹原标签、也非整场固有跑法；当前几何是代理路线，不能把入口快照当作精确官方末弯测点。', '',
    '## 分组结果', '',
    '| 组别 | 总时绝对误差中位 / 最大 | 冠军末600绝对误差中位 / 最大 | 首马前600绝对误差中位 / 最大 | 首马200m MAE中位 | 冠亚马身中位 / P90 |',
    '|---|---:|---:|---:|---:|---:|'];
  for (const g of report.summaries) {
    const s = g.overall, a = s.residual;
    lines.push(`| ${g.group} | ${pct(a.winnerTime.absoluteRelative.median)} / ${pct(a.winnerTime.absoluteRelative.max)} | ${pct(a.winnerFinal600.absoluteRelative.median)} / ${pct(a.winnerFinal600.absoluteRelative.max)} | ${pct(a.leaderFirst600.absoluteRelative.median)} / ${pct(a.leaderFirst600.absoluteRelative.max)} | ${f(s.leaderSectionalMeanAbsoluteError.median)} 秒 | ${f(s.raceMetrics.marginLengths.median)} / ${f(s.raceMetrics.marginLengths.p90)} |`);
  }
  lines.push('', 'CV 比较先取每场三个种子的中位，再在 18 场之间取中位；现实每场本身只有一个分段序列，双方按场同权。', '',
    '| 组 | 实际首马后续分段CV中位 | 模拟CV：连续 / 分段0.1秒 / 累计路标0.1秒 |',
    '|---|---:|---:|');
  for (const g of report.summaries) {
    const rows = report.rows.filter(row => row.group === g.group);
    lines.push(`| ${g.group} | ${pct(median(rows.map(r => r.actual.leaderPost200SplitCv)))} | ${pct(median(rows.map(r => r.predicted.leaderPost200SplitCv)))} / ${pct(median(rows.map(r => r.predicted.leaderPost200SplitCvRounded01)))} / ${pct(median(rows.map(r => r.predicted.leaderPost200SplitCvRounded01MarkerTimes)))} |`);
  }
  lines.push('', '下表按三个种子的中位数预测；时间残差为预测减真实，负数表示模拟偏快。旧 5% / 10% / 10% 阈值只保留作诊断，不能把阈值内结果直接称为已拟合现实。', '',
    '| 组 | 实赛 | 米 | 出马 | 冠军真实 / 模拟秒 | 总时残差 | 名义均速真实 / 模拟 m/s | 冠军末600真实 / 模拟秒 | 首马前600真实 / 模拟秒 | 首马200m MAE秒 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of report.rows) lines.push(`| ${r.group} | ${r.id} ${r.venue} | ${r.length} | ${r.fieldSize} | ${f(r.actual.winnerTime)} / ${f(r.predicted.winnerTime)} | ${f(r.residual.winnerTime.difference)} (${pct(r.residual.winnerTime.relative)}) | ${f(r.actual.winnerNominalMeanSpeed)} / ${f(r.predicted.winnerNominalMeanSpeed)} | ${f(r.actual.winnerFinal600)} / ${f(r.predicted.winnerFinal600)} | ${f(r.actual.leaderFirst600)} / ${f(r.predicted.leaderFirst600)} | ${f(r.leaderSectionalMeanAbsoluteError)} |`);
  lines.push('', '## 距离与位置结果', '',
    '| 组 | 米 | 冠军总时中位秒 | 全体峰速中位 m/s | 全体末600中位秒 | 冠亚 / 尾差中位马身 | 首马后续分段CV中位 | 半程领跑胜率 | 终直入口逃 / 先 / 差 / 追每出场胜率 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const g of report.summaries) for (const s of g.byDistance) lines.push(`| ${g.group} | ${s.length} | ${f(s.raceMetrics.winnerTime.median)} | ${f(s.horseMetrics.peakSpeed.median)} | ${f(s.horseMetrics.final600.median)} | ${f(s.raceMetrics.marginLengths.median)} / ${f(s.raceMetrics.tailLengths.median)} | ${pct(s.raceMetrics.leaderPost200SplitCv.median)} | ${pct(s.halfLeaderWinRate)} | ${s.finishStraightEntryStyles.map(p => `${p.wins}/${p.starts}=${pct(p.perStartWinRate)}`).join('；')} |`);
  if (report.externalFieldComparison?.available) {
    lines.push('', '## 同赛事规模的全场分散度对照', '',
      '真实逐马数据来自 JRA 官方完整结果。每场模拟先取三个种子的中位数，再在 18 场之间汇总，以免三个种子被当成三倍真实赛事。1/2 秒内比例的分母均为有完赛时间者；现实中止与取消保留在来源库，模拟无中止。官方计时量化为 0.1 秒。这里只对照秒差和有限完赛者分布；不把官方相邻马身与模拟冠军冲线时瞬时马身差直接称为同口径。', '',
      '| 组 | 指标 | 实际中位 / P90 | 模拟中位 / P90 | 配对差中位 |', '|---|---|---:|---:|---:|');
    for (const g of report.externalFieldComparison.summaries.filter(g => g.length == null)) for (const [k, m] of Object.entries(g.metrics))
      lines.push(`| ${g.group} | ${k} | ${f(m.actual.median)} / ${f(m.actual.p90)} | ${f(m.predicted.median)} / ${f(m.predicted.p90)} | ${f(m.pairedDifference.median)} |`);
    lines.push('', `完整来源文件：\`${report.externalFieldComparison.referenceFile}\`；规范化 SHA-256：\`${report.externalFieldComparison.referenceSha256}\`。`);
  }
  lines.push('', '逐馬完赛时间、速度、冠军冲线时差距、末600、全段路标、储备/疲劳、遮挡/受阻、实际入口位置、能力与策略字段全部保留在同名 JSON。真实逐马结果由单独来源审计负责，本报告不以项目自设马身阈值冒充现实分布。', '',
    '## 完整性与边界', '',
    '```json', JSON.stringify(report.integrity, null, 2), '```', '',
    '固定 86 级映射未被生理数据识别；总时接近可能掩盖前慢后快、坡弯位置错误和交通行为不一致。实际场规模改变赢家选择和堵塞，也不能自动弥补对手能力映射。原校准 / 留出标签只用于与旧报告对应；所有异常、正负残差均保留。', '',
    '复现全 162 次：`node tests/current-real-timing-audit.js`。已有前 108 次时仅追加独立流主组：`node tests/current-real-timing-audit.js --append-independent-stream`。仅重建汇总/文字：`node tests/current-real-timing-audit.js --summarize-only`。', '');
  return lines.join('\n');
}
function main() {
  if (process.argv.includes('--summarize-only')) {
    const report = JSON.parse(readArchived(OUT).toString('utf8'));
    finishReport(report); fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(MD, markdown(report)); return;
  }
  const before = engineHash();
  if (before !== EXPECTED) throw new Error('Frozen engine hash differs; this script does not fit or replace the source.');
  const referenceText = fs.readFileSync(REF, 'utf8'), data = JSON.parse(referenceText);
  const appendIndependent = process.argv.includes('--append-independent-stream');
  const report = appendIndependent ? JSON.parse(readArchived(OUT).toString('utf8')) : { schemaVersion: 1, startedAt: new Date().toISOString(), complete: false,
    engineVersion: 'v2026.10.02.2', engineCommit: '582ce9046dd8552d950d0296e8500a8234388eff',
    engineSha256: before, hashConvention: 'UTF-8, CRLF to LF, source BOM retained',
    referenceFile: path.relative(ROOT, REF), referenceSha256: hashText(referenceText),
    independentHoldout: false, purpose: 'Current engine system diagnosis on already-viewed G1 reference races; no fitting',
    configuration: { repeats: 3, dt: DT, level: 86, groups: GROUPS, actualFieldSizeCorrections: FIELD_SIZE_CORRECTIONS,
      correctionSource: 'Official reports at the same source URLs: 240428 and 251130 each list one scratched declared entry; run 17 actual starters.',
      seedRule: '2026100207 + distanceIndex*100003 + repeat*7919; same bank as v7',
      jockeyGrade: '优秀', fatigue: 0, morale: 50, bodyMassKg: 480, carriedWeight: 'winner carried weight applied to every synthetic horse',
      wind: 0, rail: 'A proxy', matchedSurface: true, directionAptitude: '左右皆可' },
    caveats: ['18 already-viewed 2023–2025 G1 races are not a fresh independent holdout or an all-race population.',
      'Three seeds per distance are shared across years; these engine runs are correlated, not independent real races.',
      '86 game-level ability, synthetic field opponents and body mass are assumptions, not identified horse physiology.',
      'Peak actual-path speed differs from nominal distance/time; no direct real peak-speed measurement is in this reference.',
      'Winner final600 follows the same horse; leader sectionals are changing race-leading crossing times.',
      'Final straight entry positional groups are observations, not legacy labels or a fixed win quota.'], rows: [] };
  if (report.engineSha256 !== before || report.referenceSha256 !== hashText(referenceText)) throw new Error('Existing report engine or old reference differs; do not silently append incompatible runs.');
  report.configuration.groups = GROUPS;
  report.configuration.primaryExternalAssessmentGroup = PRIMARY_GROUP;
  report.configuration.randomStreams = { legacy: 'field generation and createRace both reinitialized from seed',
    primary: 'fieldGenerationSeed=seed; raceSeed=(seed XOR 0x9e3779b9)>>>0; reproducible separate pseudorandom streams' };
  report.caveats = report.caveats.map(s => s.replace('not 108 independent real races', 'not independent real races'));
  report.complete = false;
  let completed = report.rows.reduce((n, row) => n + row.runs.length, 0); const start = performance.now();
  const groupsToRun = appendIndependent ? [PRIMARY_GROUP] : GROUPS;
  for (const group of groupsToRun) for (const sample of data.samples) {
    if (report.rows.some(row => row.group === group && row.id === sample.id && row.runs.length === 3)) continue;
    const actualFieldSize = FIELD_SIZE_CORRECTIONS[sample.id] ?? sample.fieldSize;
    const n = group === 'fixed-eight' ? 8 : actualFieldSize;
    const row = { group, id: sample.id, date: sample.date, raceName: sample.raceName,
      originalSplit: sample.split, venue: sample.venue, length: sample.length, state: sample.state,
      fieldSize: n, realFieldSize: actualFieldSize, reportedRealFieldSizeInOldReference: sample.fieldSize,
      actualFieldSizeCorrected: sample.fieldSize !== actualFieldSize, source: clone(sample.source), actual: actualOf(sample), runs: [] };
    for (let k = 0; k < 3; k++) {
      const seed = (2026100207 + DISTANCES.indexOf(sample.length) * 100003 + k * 7919) >>> 0;
      const raceSeed = group === PRIMARY_GROUP ? (seed ^ 0x9e3779b9) >>> 0 : seed;
      const begin = performance.now();
      const r = simulate(fieldFor(sample, seed, n), { length: sample.length, seed: raceSeed, venue: sample.venue,
        course: sample.venue, dir: sample.direction, surface: sample.surface, state: sample.state, profile: '平坦' }, DT, null, S);
      row.runs.push(serialiseRun(sample, seed, n, r, (performance.now() - begin) / 1000, raceSeed));
      console.error(`Progress ${++completed}/162 | ${group} ${sample.id} ${sample.length}m n=${n} generationSeed=${seed} raceSeed=${raceSeed} | ${((performance.now() - start) / 1000).toFixed(0)}s elapsed | winner ${r.winnerTime.toFixed(3)}s`);
    }
    completeRow(row); report.rows.push(row);
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  }
  finishReport(report); fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n'); fs.writeFileSync(MD, markdown(report));
  console.log(JSON.stringify({ complete: report.complete, integrity: report.integrity,
    summaries: report.summaries.map(g => ({ group: g.group, runs: g.overall.engineRuns,
      winnerTimeAbsoluteRelativeResidual: g.overall.residual.winnerTime.absoluteRelative,
      winnerFinal600AbsoluteRelativeResidual: g.overall.residual.winnerFinal600.absoluteRelative,
      leaderFirst600AbsoluteRelativeResidual: g.overall.residual.leaderFirst600.absoluteRelative,
      post200Cv: g.overall.raceMetrics.leaderPost200SplitCv,
      post200CvRounded01: g.overall.raceMetrics.leaderPost200SplitCvRounded01,
      finishStraightEntryStyles: g.overall.finishStraightEntryStyles })) }, null, 2));
  if (!report.complete || !report.integrity.allRacesFinished || !report.integrity.allFiniteBounded || !report.integrity.allEnergyConserving)
    process.exitCode = 1;
}
module.exports = { fieldFor, actualOf, serialiseRun, completeRow, summarize, styles, markdown };
if (require.main === module) main();
