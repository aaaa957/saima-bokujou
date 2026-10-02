#!/usr/bin/env node
'use strict';

// Predeclared numerical checks for v2026.10.02.2. These synthetic races do not
// establish empirical realism. Every scenario and seed is retained, including
// failures. Style win rates and launch locations are observations, not quotas.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { buildField, controlledHorse, simulate, distribution } = require('./race-calibration-v7');
const ROOT = path.resolve(__dirname, '..');
const BASELINE = '35ab3e5cd4249390a5109a0717ed41fb244d401c';
const VERSION = 'v2026.10.02.2';
const DT = 1 / 30;
const POLICY = Object.freeze({ accountingTolerance: 1e-5, maxPeakSpeed: 28,
  maxAcceleration: 6, maxLateralSpeed: .8 + 1e-6, fatigueSlowerMedianMin: .1,
  breakFasterMedianMax: -.01 });
const SCENARIOS = Object.freeze([
  { id: 'kyoto-1200', length: 1200, course: '京都芝内A', dir: '右回' },
  { id: 'nakayama-1200', length: 1200, course: '中山芝外A', dir: '右回' },
  { id: 'tokyo-1600', length: 1600, course: '東京芝A', dir: '左回' },
  { id: 'hanshin-1600', length: 1600, course: '阪神芝外A', dir: '右回' },
  { id: 'nakayama-2000', length: 2000, course: '中山芝内A', dir: '右回' },
  { id: 'niigata-2000', length: 2000, course: '新潟芝外A', dir: '左回' },
  { id: 'tokyo-2400', length: 2400, course: '東京芝A', dir: '左回' },
  { id: 'hanshin-2400', length: 2400, course: '阪神芝外A', dir: '右回' },
  { id: 'kyoto-3200', length: 3200, course: '京都芝外A', dir: '右回' },
  { id: 'rough-small-3200', length: 3200, course: '小回り', dir: '右回',
    surface: '泥地', state: '不良', profile: '急坂' },
]);
const clone = value => JSON.parse(JSON.stringify(value));
const hash = source => crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const sourceHash = () => hash(fs.readFileSync(path.join(ROOT, 'sim.js'), 'utf8'));
function apiFromSource(source) {
  const sandbox = { exports: {} }, privateGlobal = {};
  // Match the existing v7 calibration loader: same V8 arithmetic, private
  // exported global, without expensive cross-context intrinsic lookups.
  new Function('module', 'exports', 'globalThis', source)(sandbox, sandbox.exports, privateGlobal);
  return sandbox.exports;
}
function addCheck(report, name, passed, measurements) {
  report.checks.push({ name, passed: Boolean(passed), measurements });
}
function concise(result, length) {
  const horses = result.rc.race.horses;
  const reserveError = Math.max(...horses.map(H => Math.abs(H.staminaMax +
    H.statsSummary.recovered - H.statsSummary.energyUsed - H.stamina)));
  const sectionalValid = horses.every(H => H.sectionals.length === Math.ceil(length / 200) &&
    H.sectionals.every((s, i) => Number.isFinite(s.time) && s.split > 0 &&
      s.distance === Math.min(length, (i + 1) * 200)) &&
    Math.abs(H.sectionals.at(-1).time - H.time) <= 1e-7 &&
    Number.isFinite(H.final3f) && H.final3f > 0);
  return {
    finished: result.finished, finite: result.finite, bounded: result.bounded,
    winnerTime: result.winnerTime, final600: result.final600, margin: result.margin,
    tail: result.tail, peakSpeed: result.peakSpeed, firstSpeed: result.firstSpeed,
    maxAcceleration: result.maxAcceleration, maxLateralSpeed: result.maxLateralSpeed,
    energyConserving: result.energyConserving,
    energyAccountingError: result.energyAccountingError,
    unpaidWork: result.unpaidWork, reserveError, sectionalValid,
    horses: horses.map(H => ({ id: H.id, place: H.place, time: H.time,
      reserveFraction: H.stamina / H.staminaMax, fatigueTolerance: H.guts / H.gutsMax,
      workUsed: H.statsSummary.workUsed, reserveUsed: H.statsSummary.energyUsed,
      firstAttackAt: H.sprintAt, firstAttackRemainingFraction: Number.isFinite(H.sprintAt) ?
        (length - H.sprintAt) / length : null,
      launches: H.statsSummary.launches || 0, withdrawals: H.statsSummary.withdrawals || 0,
      decisions: H.statsSummary.decisions || 0 })),
  };
}
function summarize(rows) {
  const horses = rows.flatMap(r => r.horses);
  return {
    races: rows.length,
    winnerTime: distribution(rows.map(r => r.winnerTime)),
    final600: distribution(rows.map(r => r.final600)),
    margin: distribution(rows.map(r => r.margin)),
    tail: distribution(rows.map(r => r.tail)),
    peakSpeed: distribution(rows.map(r => r.peakSpeed)),
    firstAttackRemainingFraction: distribution(horses.map(H => H.firstAttackRemainingFraction)),
    horsesNeverAttacking: horses.filter(H => H.firstAttackAt === null).length,
    reserveFraction: distribution(horses.map(H => H.reserveFraction)),
    fatigueTolerance: distribution(horses.map(H => H.fatigueTolerance)),
    launches: distribution(horses.map(H => H.launches)),
    withdrawals: distribution(horses.map(H => H.withdrawals)),
    maxAccountingError: Math.max(...rows.map(r => r.energyAccountingError)),
    maxReserveError: Math.max(...rows.map(r => r.reserveError)),
    maxUnpaidWork: Math.max(...rows.map(r => r.unpaidWork)),
  };
}
function groupBreakdown(samples) {
  const officialIds = new Set(SCENARIOS.filter(s => s.id !== 'rough-small-3200').map(s => s.id));
  const stressIds = new Set(['rough-small-3200']);
  if (samples.some(r => !officialIds.has(r.scenario) && !stressIds.has(r.scenario)))
    throw new Error('A scenario lacks its predeclared official/stress classification');
  function aggregate(rows, key) {
    const results = rows.map(r => r[key]), horses = results.flatMap(r => r.horses);
    return { ...summarize(results), horseCount: horses.length,
      attackTriggered: horses.filter(H => Number.isFinite(H.firstAttackAt)).length,
      attackNotTriggered: horses.filter(H => !Number.isFinite(H.firstAttackAt)).length,
      // Descriptive comparison with the earlier project's 10-length reference;
      // this count is not a new acceptance threshold.
      marginOverTenRows: results.filter(r => r.margin > 10).length };
  }
  return Object.fromEntries([['official', officialIds], ['stress', stressIds]].map(([name, ids]) => {
    const rows = samples.filter(r => ids.has(r.scenario));
    return [name, { rows: rows.length, old: aggregate(rows, 'old'), new: aggregate(rows, 'new') }];
  }));
}
function runValidation(options = {}) {
  const repeats = options.pairs || 6;
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error('pairs must be a positive integer');
  const currentSource = fs.readFileSync(path.join(ROOT, 'sim.js'), 'utf8');
  if (options.expectHash && hash(currentSource) !== options.expectHash)
    throw new Error('Engine source differs from the declared freeze SHA-256');
  const baselineSource = execFileSync('git', ['show', BASELINE + ':sim.js'], { cwd: ROOT, encoding: 'utf8' });
  const current = apiFromSource(currentSource), before = apiFromSource(baselineSource);
  const report = {
    schemaVersion: 1, version: VERSION, engineSha256: hash(currentSource), baselineCommit: BASELINE,
    baselineEngineSha256: hash(baselineSource),
    hashConvention: 'SHA-256 of UTF-8 sim.js, preserving its BOM, after CRLF-to-LF normalization',
    configuration: { repeats, seedBank: 2026100202, dt: DT, fieldSize: 8, fieldLevel: 70,
      scenarios: SCENARIOS, defaultSurface: '草地', defaultState: '良', defaultProfile: '平坦' },
    policy: POLICY, checks: [], samples: [], mechanismProbes: {}, warnings: [],
  };
  for (let i = 0; i < SCENARIOS.length; i++) for (let k = 0; k < repeats; k++) {
    const scenario = SCENARIOS[i], seed = (2026100202 + i * 1000003 + k * 7919) >>> 0;
    const raceSeed = (seed * 31 + 7) >>> 0;
    const field = buildField(seed, 'generated', scenario.surface || '草地');
    const settings = { state: '良', profile: '平坦', surface: '草地', ...scenario, seed: raceSeed };
    const oldRace = concise(simulate(field, settings, DT, null, before), scenario.length);
    const newRace = concise(simulate(field, settings, DT, null, current), scenario.length);
    report.samples.push({ scenario: scenario.id, length: scenario.length, fieldSeed: seed,
      raceSeed, old: oldRace, new: newRace,
      winnerTimeDifference: newRace.winnerTime - oldRace.winnerTime,
      winnerTimeRelativeDifference: newRace.winnerTime / oldRace.winnerTime - 1 });
    if (options.onProgress) options.onProgress(report.samples.length * 2, SCENARIOS.length * repeats * 2);
  }
  report.summary = {
    old: summarize(report.samples.map(r => r.old)), new: summarize(report.samples.map(r => r.new)),
    winnerTimeDifference: distribution(report.samples.map(r => r.winnerTimeDifference)),
    winnerTimeRelativeDifference: distribution(report.samples.map(r => r.winnerTimeRelativeDifference)),
    byScenario: SCENARIOS.map(s => { const rows = report.samples.filter(r => r.scenario === s.id);
      return { ...s, old: summarize(rows.map(r => r.old)), new: summarize(rows.map(r => r.new)),
        winnerTimeDifference: distribution(rows.map(r => r.winnerTimeDifference)) }; }),
  };
  report.summary.groupBreakdown = groupBreakdown(report.samples);
  const races = report.samples.flatMap(r => [r.old, r.new]);
  addCheck(report, 'all paired field races finish with finite bounded state',
    races.every(r => r.finished && r.finite && r.bounded), { races: races.length });
  addCheck(report, 'work and reserve ledgers reconcile without unpaid power', races.every(r =>
    r.energyConserving && r.energyAccountingError <= POLICY.accountingTolerance &&
    r.reserveError <= POLICY.accountingTolerance && r.unpaidWork <= POLICY.accountingTolerance),
  { maxWorkError: Math.max(...races.map(r => r.energyAccountingError)),
    maxReserveError: Math.max(...races.map(r => r.reserveError)),
    maxUnpaidWork: Math.max(...races.map(r => r.unpaidWork)) });
  addCheck(report, 'broad inherited finish time and speed guardrails', report.samples.every(row =>
    [row.old, row.new].every(r => r.winnerTime >= row.length / 24 &&
      r.winnerTime <= row.length / 10 + 10 && r.peakSpeed > 10 &&
      r.peakSpeed < POLICY.maxPeakSpeed && r.firstSpeed >= 0 && r.firstSpeed < 1 &&
      r.final600 >= 20 && r.final600 <= 80)), report.summary.new);
  addCheck(report, 'finite forward acceleration and lateral motion', races.every(r =>
    r.maxAcceleration <= POLICY.maxAcceleration && r.maxLateralSpeed <= POLICY.maxLateralSpeed),
  { maxAcceleration: Math.max(...races.map(r => r.maxAcceleration)),
    maxLateralSpeed: Math.max(...races.map(r => r.maxLateralSpeed)) });
  addCheck(report, '200 m and final 600 m measurements remain independent observations',
    races.every(r => r.sectionalValid), { races: races.length });

  const fatiguePairs = [];
  for (const length of [1200, 2400, 3200]) for (let k = 0; k < 2; k++) {
    const seed = 155192711 + length * 31 + k * 104729;
    const h = controlledHorse(seed), settings = { length, course: '标准', profile: '平坦', seed };
    h.behavior = { forwardness: .5, settle: .5, tractability: .5 };
    const rested = simulate([h], settings, DT, null, current);
    h['疲劳'] = 40;
    const tired = simulate([h], settings, DT, null, current);
    fatiguePairs.push({ length, seed, rested: concise(rested, length), tired: concise(tired, length),
      timeDifference: tired.winnerTime - rested.winnerTime });
  }
  report.mechanismProbes.fatigue = fatiguePairs;
  const fatigueDifference = distribution(fatiguePairs.map(r => r.timeDifference));
  addCheck(report, 'pre-race fatigue worsens paired solo time across three distances',
    fatiguePairs.every(r => r.rested.finished && r.tired.finished && r.rested.finite && r.tired.finite) &&
    fatigueDifference.median > POLICY.fatigueSlowerMedianMin, fatigueDifference);
  const breakPairs = [];
  for (let k = 0; k < 4; k++) {
    const seed = 329190721 + k * 104729, settings = { length: 1200, course: '标准', profile: '平坦', seed };
    const h = controlledHorse(seed, { '出闸能力': 40 });
    const slow = simulate([h], settings, DT, { targetV: 17, targetT: 1.4 }, current);
    h.stats['出闸能力'] = 90;
    const fast = simulate([h], settings, DT, { targetV: 17, targetT: 1.4 }, current);
    const low = slow.times.get(h.id).get(50), high = fast.times.get(h.id).get(50);
    breakPairs.push({ seed, slow50m: low, fast50m: high, difference: high - low,
      slow: concise(slow, settings.length), fast: concise(fast, settings.length) });
  }
  report.mechanismProbes.breaking = breakPairs;
  const breakDifference = distribution(breakPairs.map(r => r.difference));
  addCheck(report, 'gate ability still affects continuous early acceleration',
    breakDifference.n === breakPairs.length && breakDifference.median <= POLICY.breakFasterMedianMax,
    breakDifference);
  const probeRaces = [...fatiguePairs.flatMap(r => [r.rested, r.tired]),
    ...breakPairs.flatMap(r => [r.slow, r.fast])];
  addCheck(report, 'all solo mechanism races finish with bounded motion, valid timing and reconciled energy',
    probeRaces.every(r => r.finished && r.finite && r.bounded && r.sectionalValid &&
      r.energyConserving && r.energyAccountingError <= POLICY.accountingTolerance &&
      r.reserveError <= POLICY.accountingTolerance && r.unpaidWork <= POLICY.accountingTolerance &&
      r.maxAcceleration <= POLICY.maxAcceleration && r.maxLateralSpeed <= POLICY.maxLateralSpeed &&
      r.peakSpeed > 0 && r.peakSpeed < POLICY.maxPeakSpeed),
    { races: probeRaces.length, maxWorkError: Math.max(...probeRaces.map(r => r.energyAccountingError)),
      maxReserveError: Math.max(...probeRaces.map(r => r.reserveError)),
      maxUnpaidWork: Math.max(...probeRaces.map(r => r.unpaidWork)) });
  report.raceCount = races.length + fatiguePairs.length * 2 + breakPairs.length * 2;
  addCheck(report, 'engine source is unchanged throughout validation',
    sourceHash() === report.engineSha256, { before: report.engineSha256, after: sourceHash() });
  report.warnings.push('8 匹、等级 70 的合成阵容用于机制验收。本轮没有重新拟合或重跑真实数据留出集，上一轮真实赛事验收的失败项仍未解决。');
  report.warnings.push('官方场地以周长、终点直道和高差约束两直两弯代理几何；尚未复刻起跑引入线、混合内外圈、变曲率以及逐米实测高程。');
  report.warnings.push('发动剩余比例、新旧用时差、着差和疲劳耐受均如实报告，没有强制跑法胜率或发动位置目标。余程预算包括有限加速与制动，固定当前疲劳保持系数和车道，不预知未来受阻、横移、疲劳变化或后续恢复。');
  report.observations = {
    upperTailMarginIncreased: report.summary.new.margin.p90 > report.summary.old.margin.p90,
    fullMaxAttackFraction: report.summary.new.firstAttackRemainingFraction.n /
      (report.samples.length * report.configuration.fieldSize),
    scenariosWithoutFullMaxAttack: report.summary.byScenario
      .filter(s => s.new.firstAttackRemainingFraction.n === 0).map(s => s.id),
  };
  if (report.observations.upperTailMarginIncreased)
    report.warnings.push(`本轮冠军着差 P90 从基准 ${report.summary.old.margin.p90.toFixed(2)} 升至 ${report.summary.new.margin.p90.toFixed(2)} 马身，不能宣称大着差尾部得到改善。最大着差与全部种子均保留；着差未列为本轮硬验收阈值。`);
  report.warnings.push(`attack 记录的是骑手请求完整最大目标速度，而预算配速仍能提高和产生实际加速。${report.summary.new.horsesNeverAttacking}/${report.samples.length * report.configuration.fieldSize} 匹未触发该标签，不代表全程没有加速或没有争夺；无 full-max attack 的场景：${report.observations.scenariosWithoutFullMaxAttack.join('、') || '无'}。`);
  report.passed = report.checks.every(c => c.passed);
  return report;
}
const fmt = (x, digits = 2) => Number.isFinite(x) ? x.toFixed(digits) : '无';
function markdown(report) {
  const newer = report.summary.new, older = report.summary.old;
  const groups = report.summary.groupBreakdown || groupBreakdown(report.samples);
  const marginText = s => `${fmt(s.margin.median)} / ${fmt(s.margin.p90)} / ${fmt(s.margin.max)}`;
  return `# 路线预算与状态验收 ${VERSION}\n\n` +
    `本轮使用 ${report.raceCount} 场合成比赛，其中 ${report.samples.length} 组新旧版本同阵容、同随机种子配对。基准提交为 \`${report.baselineCommit}\`。\n\n` +
    `引擎 SHA-256：\`${report.engineSha256}\`。哈希保留 UTF-8 BOM，仅将 CRLF 统一为 LF。\n\n` +
    `## 方法与判定\n\n` +
    `预先固定 10 个场景，涵盖 1200、1600、2000、2400、3200 米，东京、中山、京都、阪神、新潟和抽象小弯急坂不良泥地；每个场景 ${report.configuration.repeats} 个种子。新增疲劳和出闸能力配对，步长为 1/30 秒，运动内部仍细分到 1/60 秒。全部种子和异常保留在 JSON 中。\n\n` +
    `硬验收检查完赛、有限数值、储备边界、能量账、宽松速度和赛时边界、有限加速度、计时记录、疲劳与出闸能力的效应。阈值沿用工程检查或在脚本运行前声明，不将任何跑法胜率或发动位置强制设为目标。\n\n` +
    `| 检查 | 结果 |\n| --- | --- |\n` + report.checks.map(c => `| ${c.name} | ${c.passed ? '通过' : '**未通过**'} |`).join('\n') + '\n\n' +
    `## 配对结果\n\n` +
    `| 场景 | 基准冠军用时中位数/s | 新版/s | 配对差中位数/s | 新版首发动剩余比例中位数 |\n| --- | ---: | ---: | ---: | ---: |\n` +
    report.summary.byScenario.map(s => `| ${s.id} | ${fmt(s.old.winnerTime.median)} | ${fmt(s.new.winnerTime.median)} | ${fmt(s.winnerTimeDifference.median)} | ${fmt(s.new.firstAttackRemainingFraction.median, 3)} |`).join('\n') + '\n\n' +
    `冠军着差中位数：基准 ${fmt(older.margin.median)} 马身，新版 ${fmt(newer.margin.median)} 马身；新版 P90 ${fmt(newer.margin.p90)} 马身。新版最高瞬时速度 ${fmt(newer.peakSpeed.max)} m/s。工作能量账最大误差 ${newer.maxAccountingError.toExponential(3)} J/kg，储备账最大误差 ${newer.maxReserveError.toExponential(3)} J/kg，未支付工作最大值 ${newer.maxUnpaidWork.toExponential(3)} J/kg。\n\n` +
    `### 官方场景与抽象压力场景分组\n\n` +
    `| 样本组 | 配对场数 | 基准着差 中位/P90/最大 | 新版着差 中位/P90/最大 | 基准 attack 触发/未触发 | 新版 attack 触发/未触发 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n` +
    [['official', '9 个官方场景'], ['stress', '抽象急坂不良泥地']].map(([key, label]) => {
      const g = groups[key];
      return `| ${label} | ${g.rows} | ${marginText(g.old)} | ${marginText(g.new)} | ${g.old.attackTriggered}/${g.old.attackNotTriggered} | ${g.new.attackTriggered}/${g.new.attackNotTriggered} |`;
    }).join('\n') + '\n\n' +
    `着差单位为马身。全体冠军着差 P90 为 ${fmt(older.margin.p90)}→${fmt(newer.margin.p90)}；官方组单独为 ${fmt(groups.official.old.margin.p90)}→${fmt(groups.official.new.margin.p90)}，抽象压力组为 ${fmt(groups.stress.old.margin.p90)}→${fmt(groups.stress.new.margin.p90)}。` +
    (groups.official.new.margin.p90 > groups.official.old.margin.p90 ? '排除压力场景后，官方样本尾部仍扩大，不能把全体 P90 上升全部归因于压力场景。' : '排除压力场景后的官方样本尾部变化应单独评估。') +
    `每个场景仅 ${report.configuration.repeats} 个种子，组内场地和距离也有差异；这些是样本的描述性统计，不能声称统计显著或据此判定真实赛马的平衡。\n\n` +
    `attack 表示请求完整最大目标配速；普通预算配速也会提高并产生实际加速。未触发该标签不等于没有加速或没有争夺。全体基准触发/未触发 ${older.firstAttackRemainingFraction.n}/${older.horsesNeverAttacking}，新版 ${newer.firstAttackRemainingFraction.n}/${newer.horsesNeverAttacking}。\n\n` +
    `首发动剩余比例按每匹马的第一次实际发动记录；可能发生收力和再次发动，因此该数字不代表一次持续到终点的“终盘阶段”。未发动马匹有 ${newer.horsesNeverAttacking} 匹，照常保留。\n\n` +
    `疲劳 40 相比疲劳 0 的单马用时差中位数 ${fmt(report.checks.find(c => c.name.startsWith('pre-race fatigue')).measurements.median)} 秒。高出闸能力相比低能力到达 50 米的用时差中位数 ${fmt(report.checks.find(c => c.name.startsWith('gate ability')).measurements.median)} 秒。\n\n` +
    `## 结论与限制\n\n` +
    `${report.passed ? '本轮预先声明的基本数值验收全部通过。' : '**本轮存在未通过的检查，应在发布前说明并处理。**'}这验证数值稳定性和机制方向，不代表已经充分复刻真实比赛。\n\n` +
    report.warnings.map(w => `- ${w}`).join('\n') + '\n';
}
module.exports = { runValidation, markdown, groupBreakdown, POLICY, SCENARIOS };
if (require.main === module) {
  const args = process.argv.slice(2), options = {}; let json = null, md = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pairs') options.pairs = Number(args[++i]);
    else if (args[i] === '--expect-hash') options.expectHash = args[++i];
    else if (args[i] === '--json') json = args[++i];
    else if (args[i] === '--markdown') md = args[++i];
    else throw new Error('Unknown argument: ' + args[i]);
  }
  options.onProgress = (done, total) => { if (done % 12 === 0 || done === total) console.error(`Progress ${done}/${total}`); };
  const report = runValidation(options);
  if (json) fs.writeFileSync(path.resolve(json), JSON.stringify(report, null, 2) + '\n');
  if (md) fs.writeFileSync(path.resolve(md), markdown(report));
  for (const c of report.checks) console.log(`${c.passed ? 'PASS' : 'FAIL'} ${c.name}: ${JSON.stringify(c.measurements)}`);
  console.log(JSON.stringify({ raceCount: report.raceCount, new: report.summary.new,
    winnerTimeDifference: report.summary.winnerTimeDifference, engineSha256: report.engineSha256,
    passed: report.passed }, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
