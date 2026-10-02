#!/usr/bin/env node
'use strict';

/* Bounded development fit, exclusively on the declared 2023/2024 JRA bank.
 * All candidates share one ability level, fields and random seeds. It changes
 * RACE_F in process memory, never sim.js, and never evaluates 2025 holdout.
 * This is aggregate timing calibration of game parameters, not identification
 * of the winning horses' oxygen uptake or individual physiological constants.
 */
const fs = require('node:fs');
const path = require('node:path');
const { S, POLICY, engineHash, buildField, simulate, distribution } = require('./race-calibration-v7.js');
const ROOT = path.resolve(__dirname, '..');
const DISTANCES = [1200, 1600, 2000, 2400, 3000, 3200];
const OBJECTIVE = Object.freeze({ winnerTime: 1, winnerFinal600: .25, leaderFirst600: .25 });
const COMMON = Object.freeze({ efficiencyPerPoint: .0025, peakExtra: 1.55 });
const CANDIDATES = [
  { id: 'r250-e35-a49', resistanceK: .250, staminaPer: 35, aerobicPower: 49 },
  { id: 'r245-e25-a48', resistanceK: .245, staminaPer: 25, aerobicPower: 48 },
  { id: 'r245-e30-a49', resistanceK: .245, staminaPer: 30, aerobicPower: 49 },
  { id: 'r245-e35-a50', resistanceK: .245, staminaPer: 35, aerobicPower: 50 },
  { id: 'r250-e25-a49', resistanceK: .250, staminaPer: 25, aerobicPower: 49 },
  { id: 'r250-e30-a48', resistanceK: .250, staminaPer: 30, aerobicPower: 48 },
  { id: 'r250-e35-a50', resistanceK: .250, staminaPer: 35, aerobicPower: 50 },
  { id: 'r260-e25-a50', resistanceK: .260, staminaPer: 25, aerobicPower: 50 },
  { id: 'r260-e30-a49', resistanceK: .260, staminaPer: 30, aerobicPower: 49 },
  { id: 'r260-e35-a48', resistanceK: .260, staminaPer: 35, aerobicPower: 48 },
  { id: 'r255-e30-a49', resistanceK: .255, staminaPer: 30, aerobicPower: 49 },
  { id: 'r255-e35-a49', resistanceK: .255, staminaPer: 35, aerobicPower: 49 },
];
function relativeResidual(predicted, actual) { return (predicted - actual) / actual; }
function runFit({ repeats = 1, onProgress = null } = {}) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 2) throw new Error('Use one or two predeclared replicates per reference');
  const sourceHash = engineHash(), initial = { ...S.RACE_F };
  const referencePath = path.join(ROOT, 'docs', 'race-reality-reference.json');
  const dataset = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
  // No outcome field from holdout is accessed or output by the fitting code.
  const samples = dataset.samples.filter(r => r.split === 'calibration');
  if (samples.length !== 12 || samples.some(r => !/^(2023|2024)-/.test(r.date))) throw new Error('Unexpected training-bank definition');
  const report = { schemaVersion: 1, version: '2026.10.02.1', sourceSha256: sourceHash,
    procedure: '12 predeclared in-memory candidates; one fixed ability level across every distance; common random fields; no per-distance multiplier',
    trainingBank: { years: [2023, 2024], samples: samples.length, datasetFile: path.relative(ROOT, referencePath),
      fieldLevel: POLICY.realFieldLevel, fieldSize: 8, repeats, surfaceSuitability: 'matched', jockeyGrade: '优秀',
      abilityCaveat: 'Level 86 is one declared nominal game G1 class, not a measured median ability of real entrants.' },
    objective: { weights: OBJECTIVE, equation: 'mean(relative winnerTime residual² + 0.25 * relative winnerFinal600 residual² + 0.25 * relative leaderFirst600 residual²)' },
    initialParameters: initial, commonParameters: COMMON, holdoutEvaluated: false, candidates: [], selected: null,
    limitations: ['Official leader first600 and same-winner final600 use separate trajectories.',
      'Synthetic eight-horse fields do not reconstruct the actual entrants, tactics, weather, rail setting or start chutes.',
      'The fitted game power is mechanical-equivalent; aggregate race times cannot identify VO2, anaerobic capacity or biomechanical constants.'] };
  try {
    for (const candidate of CANDIDATES) {
      const { id, ...parameters } = candidate;
      Object.assign(S.RACE_F, initial, COMMON, parameters);
      const rows = [];
      for (const sample of samples) {
        const trials = [];
        for (let k = 0; k < repeats; k++) {
          const seed = (2026100207 + DISTANCES.indexOf(sample.length) * 100003 + k * 7919) >>> 0;
          const field = buildField(seed, 'generated', sample.surface, POLICY.realFieldLevel);
          for (const h of field) { h['疲劳'] = 0; h['斗志'] = 50; h.jockeyGrade = '优秀';
            h.carriedWeight = sample.winner.carriedWeightKg ?? 58; h.bodyMass = sample.winner.bodyWeightKg ?? 480; }
          const result = simulate(field, { length: sample.length, seed, venue: sample.venue, course: sample.venue,
            dir: sample.direction, surface: sample.surface, state: sample.state, profile: '平坦' });
          trials.push({ seed, finished: result.finished, finite: result.finite, winnerTime: result.winnerTime,
            winnerFinal600: result.final600, leaderFirst600: result.leaderFirst600 });
        }
        const predicted = Object.fromEntries(Object.keys(OBJECTIVE).map(metric => [metric, distribution(trials.map(r => r[metric])).median]));
        const actual = { winnerTime: sample.winner.finishTime, winnerFinal600: sample.winner.final600, leaderFirst600: sample.first600 };
        const residual = Object.fromEntries(Object.keys(OBJECTIVE).map(metric => [metric, { seconds: predicted[metric] - actual[metric],
          relative: relativeResidual(predicted[metric], actual[metric]) }]));
        const score = Object.keys(OBJECTIVE).reduce((sum, metric) => sum + OBJECTIVE[metric] * residual[metric].relative ** 2, 0);
        rows.push({ id: sample.id, date: sample.date, venue: sample.venue, length: sample.length, source: sample.source,
          actual, predicted, residual, score, trials });
      }
      const complete = rows.every(r => r.trials.every(t => t.finished && t.finite));
      const score = complete ? rows.reduce((sum, r) => sum + r.score, 0) / rows.length : null;
      const summary = Object.fromEntries(Object.keys(OBJECTIVE).map(metric => [metric, {
        signedRelative: distribution(rows.map(r => r.residual[metric].relative)),
        absoluteRelative: distribution(rows.map(r => Math.abs(r.residual[metric].relative))) }]));
      report.candidates.push({ id, parameters: { ...COMMON, ...parameters }, score, complete, residualSummary: summary, rows });
      if (onProgress) onProgress(report.candidates.at(-1), report.candidates.length, CANDIDATES.length);
    }
    const selected = report.candidates.filter(c => c.complete && Number.isFinite(c.score)).sort((a, b) => a.score - b.score)[0];
    report.selected = selected ? { id: selected.id, parameters: selected.parameters, score: selected.score,
      residualSummary: selected.residualSummary, selectionRule: 'lowest predeclared training objective; holdout never evaluated' } : null;
    report.sourceSha256After = engineHash(); report.sourceUnchanged = report.sourceSha256 === report.sourceSha256After;
    report.frozenValidation = false;
    return report;
  } finally { Object.assign(S.RACE_F, initial); }
}
module.exports = { CANDIDATES, OBJECTIVE, runFit };
if (require.main === module) {
  const args = process.argv.slice(2); let repeats = 1, output = path.join(ROOT, 'docs', 'race-physiology-fit-v2026.10.02.1.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repeats') repeats = Number(args[++i]);
    else if (args[i] === '--json') output = path.resolve(args[++i]);
    else throw new Error('Unknown argument: ' + args[i]);
  }
  const report = runFit({ repeats, onProgress: (r, completed, total) => console.error('Candidate ' + completed + '/' + total + ' ' + r.id + ' score=' + r.score) });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.selected, null, 2));
  console.log('Holdout evaluated: false; source unchanged: ' + report.sourceUnchanged + '; output: ' + output);
  process.exitCode = report.selected ? 0 : 1;
}
