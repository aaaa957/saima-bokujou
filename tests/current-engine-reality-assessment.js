#!/usr/bin/env node
'use strict';
// Join frozen diagnostic runs and official results without fitting parameters.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const A = require('./current-engine-population-audit');
const {readArchived}=require('./helpers/frozen-v8');
const ROOT = path.resolve(__dirname, '..');
const names = { reality: 'current-engine-reality-sources-2026-10-02.json',
  timing: 'current-real-timing-audit-2026-10-02.json',
  population: 'current-engine-population-audit-independent-2026-10-02.json',
  legacyPopulation: 'current-engine-population-audit-2026-10-02.json',
  trafficReproduction: 'current-engine-traffic-braking-audit-2026-10-02.json' };
const data = Object.fromEntries(Object.entries(names).map(([k, f]) => [k, JSON.parse(readArchived(path.join(ROOT, 'docs', f)).toString('utf8'))]));
if (!data.timing.complete || !data.population.checks.allExpectedRacesRecorded || A.hash() !== A.EXPECTED) throw new Error('Incomplete or unfrozen inputs');
const DISTANCES = [1200, 1600, 2000, 2400, 3000, 3200], LABELS = ['逃', '先', '差', '追'];
const ENGLISH = { '逃': 'front', '先': 'prominent', '差': 'midpack', '追': 'rear' };
const Q = (a, p) => { a = a.filter(Number.isFinite).sort((a, b) => a - b); if (!a.length) return null; const t = (a.length - 1) * p, i = Math.floor(t); return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (t - i); };
const D = a => ({ n: a.filter(Number.isFinite).length, min: Q(a, 0), median: Q(a, .5), p90: Q(a, .9), max: Q(a, 1) });
const cv = a => { const mean = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length) / mean; };
const round01 = x => Math.round(x * 10) / 10;
function realMetrics(r) {
  const h = r.horses.filter(h => Number.isFinite(h.finishTime)).sort((a, b) => a.finishPosition - b.finishPosition), w = h[0], s = r.raceSectionals200m;
  const final = h.map(x => x.final600).filter(Number.isFinite), gaps = h.map(x => x.finishTime - w.finishTime);
  return { winnerTime: w.finishTime, winnerMeanSpeed: r.length / w.finishTime, winnerFinal600: w.final600,
    marginSeconds: h[1].finishTime - w.finishTime, tailSeconds: h.at(-1).finishTime - w.finishTime,
    within1Second: gaps.filter(x => x <= 1 + 1e-9).length / h.length,
    within2Seconds: gaps.filter(x => x <= 2 + 1e-9).length / h.length,
    final600Span: Math.max(...final) - Math.min(...final), fastestFinal600Won: Number(w.final600 <= Math.min(...final) + 1e-9),
    firstFifthMeanSpeedGap: h.length >= 5 ? r.length / w.finishTime - r.length / h[4].finishTime : null,
    first200: s[0], fastest200: Math.min(...s), post200Cv: cv(s.slice(1)),
    final200MinusPrevious: s.at(-1) - s.at(-2), earlyLate600Difference: s.slice(-3).reduce((a, b) => a + b, 0) - s.slice(0, 3).reduce((a, b) => a + b, 0) };
}
function simMetrics(r) {
  const h = r.horses.filter(h => Number.isFinite(h.time)).sort((a, b) => a.place - b.place), w = h[0], s = r.leaderSectionals200m;
  const final = h.map(x => x.final600).filter(Number.isFinite), gaps = h.map(x => x.time - w.time);
  return { winnerTime: w.time, winnerMeanSpeed: r.length ? r.length / w.time : r.winnerNominalMeanSpeed, winnerFinal600: w.final600,
    marginSeconds: h[1].time - w.time, tailSeconds: h.at(-1).time - w.time,
    marginSecondsRounded01: round01(h[1].time) - round01(w.time), tailSecondsRounded01: round01(h.at(-1).time) - round01(w.time),
    marginLengths: r.marginLengths, tailLengths: r.tailLengths,
    within1Second: gaps.filter(x => x <= 1 + 1e-9).length / h.length,
    within2Seconds: gaps.filter(x => x <= 2 + 1e-9).length / h.length,
    final600Span: Math.max(...final) - Math.min(...final), fastestFinal600Won: Number(round01(w.final600) <= Math.min(...final.map(round01)) + 1e-9),
    firstFifthMeanSpeedGap: h.length >= 5 ? w.nominalMeanSpeed - h[4].nominalMeanSpeed : null,
    first200: s[0], fastest200: Math.min(...s), post200Cv: cv(s.slice(1)), post200CvRounded01: cv(s.slice(1).map(round01)),
    peakSpeed: r.peakSpeed, final200MinusPrevious: s.at(-1) - s.at(-2), earlyLate600Difference: s.slice(-3).reduce((a, b) => a + b, 0) - s.slice(0, 3).reduce((a, b) => a + b, 0) };
}
const rows = data.timing.rows.filter(r => r.group === 'actual-field-size-independent-stream');
if (rows.length !== 18 || rows.some(r => r.runs.length !== 3)) throw new Error('Primary external sample mismatch');
const paired = rows.map(row => {
  const real = data.reality.races.find(r => r.id === row.id), actual = realMetrics(real);
  const runs = row.runs.map(r => simMetrics({ ...r, length: row.length }));
  const predicted = Object.fromEntries(Object.keys(runs[0]).map(k => [k, Q(runs.map(r => r[k]), .5)]));
  return { id: row.id, length: row.length, name: row.raceName, fieldSize: real.fieldSize, source: real.source.url,
    actual, predicted, winnerTimeErrorPercent: (predicted.winnerTime / actual.winnerTime - 1) * 100,
    actualSectionals: real.raceSectionals200m, predictedSectionals: row.predicted.leaderSectionals200m,
    runs: runs.map((r, i) => ({ ...r, generationSeed: row.runs[i].fieldGenerationSeed ?? row.runs[i].seed, raceSeed: row.runs[i].raceSeed })) };
});
const metrics = Object.keys(paired[0].actual);
const aggregate = Object.fromEntries(metrics.map(k => [k, { real: D(paired.map(r => r.actual[k])), simulation: D(paired.map(r => r.predicted[k])) }]));
aggregate.post200CvRounded01 = { real: D(paired.map(r => r.actual.post200Cv)), simulation: D(paired.map(r => r.predicted.post200CvRounded01)) };
aggregate.marginLengths = { real: data.reality.summary.winnerSecondAllRaceMarginOrderStatistics, simulation: D(paired.map(r => r.predicted.marginLengths)) };
aggregate.tailLengths = { real: null, simulation: D(paired.map(r => r.predicted.tailLengths)), caveat: 'No cumulative nominal official length conversion for photo/large gaps; use tailSeconds.' };
const perDistance = DISTANCES.map(length => {
  const r = paired.filter(r => r.length === length), m = {};
  for (const k of ['winnerTime', 'winnerMeanSpeed', 'winnerFinal600', 'first200', 'fastest200', 'post200Cv', 'final600Span', 'marginSeconds', 'tailSeconds']) m[k] = { real: D(r.map(x => x.actual[k])), simulation: D(r.map(x => x.predicted[k])) };
  return { length, realRaces: r.length, engineRuns: r.length * 3, metrics: m,
    medianPairedTimeErrorPercent: Q(r.map(r => r.winnerTimeErrorPercent), .5), maxAbsoluteTimeErrorPercent: Math.max(...r.map(r => Math.abs(r.winnerTimeErrorPercent))) };
});
const primaryRuns = rows.flatMap(row => row.runs.map(run => ({ ...run, length: row.length })));
aggregate.fastestFinal600Won = { realRaces: paired.length,
  realRate: paired.reduce((a, r) => a + r.actual.fastestFinal600Won, 0) / paired.length,
  simulatedRaces: primaryRuns.length,
  simulationRate: primaryRuns.reduce((a, r) => a + simMetrics(r).fastestFinal600Won, 0) / primaryRuns.length,
  caveat: 'A tied fastest final600 at 0.1-second resolution counts as fastest; this is not acceleration or position gain.' };
function entryStyle(rows) {
  return LABELS.map(style => {
    const starters = rows.flatMap(r => r.horses).filter(h => h.finishStraightEntryCategory === style), wins = starters.filter(h => h.place === 1).length;
    return { style, starts: starters.length, wins, perStart: wins / starters.length, championShare: wins / rows.length };
  });
}
const externalStyle = DISTANCES.map(length => {
  const actual = data.reality.summary.byDistance[length].styles;
  return { length, realRaces: 3, simulatedRaces: 9, simulation: entryStyle(primaryRuns.filter(r => r.length === length)),
    real: LABELS.map(style => ({ style, ...actual[ENGLISH[style]] })) };
});
const populationStyles = data.population.summaries.filter(s => s.context === 'native-official').map(s => ({ n: s.n, length: s.length, races: s.races,
  time: s.winnerTime, engineObserved: s.style.engineObserved, entryProxy: s.style.straightPositionProxy, initial: s.style.initialLabel }));
const controlled = ['healthy-flat', 'equal-ability-flat'].map(context => {
  const r = data.population.samples.filter(r => r.context === context), summary = A.summarize(r);
  return { context, ...summary, perDistance: data.population.summaries.filter(s => s.context === context) };
});
const samplingSensitivity = data.population.summaries.map(s => {
  const old = data.legacyPopulation.summaries.find(x => x.context === s.context && x.n === s.n && x.length === s.length);
  return { context: s.context, n: s.n, length: s.length, legacyEscapeChampionShare: old.style.engineObserved[0].championShare,
    independentEscapeChampionShare: s.style.engineObserved[0].championShare, legacyMarginMedian: old.marginLengths.median,
    independentMarginMedian: s.marginLengths.median };
});
const trafficBraking = {
  sampling: 'Formal432 matrix reads the last internal60Hz substep at each outer30Hz frame; counts are sampled event involvement, not complete event frequency.',
  diagnosticCutoff: -50,
  normalBrakingLimit: 3.5,
  thresholdCaveat: '-50 m/s² only describes extreme observed discontinuities; it is not a real-racing calibration threshold.',
  contexts: ['native-official', 'healthy-flat', 'equal-ability-flat'].map(context => {
    const races = data.population.samples.filter(r => r.context === context), horses = races.flatMap(r => r.horses);
    const worstRace = races.reduce((worst, race) => {
      const horse = race.horses.reduce((a, b) => a.minAcceleration < b.minAcceleration ? a : b);
      return !worst || horse.minAcceleration < worst.acceleration ? { generationSeed: race.generationSeed,
        raceSeed: race.raceSeed, length: race.length, n: race.n, id: horse.id, gate: horse.gate,
        acceleration: horse.minAcceleration } : worst;
    }, null);
    return { context, races: races.length, starts: horses.length,
      racesWithExtremeBraking: races.filter(r => r.horses.some(h => h.minAcceleration < -50)).length,
      startsWithExtremeBraking: horses.filter(h => h.minAcceleration < -50).length,
      startsBelowNormalBrakingLimit: horses.filter(h => h.minAcceleration < -3.5 - 1e-9).length, worst: worstRace };
  }),
  reproduction: data.trafficReproduction,
  causalBoundary: 'Two exact diagnostic replays verify pre-finish traffic speed clamping and simultaneous-lateral-move mismatch. They are observations of existing trials, not additional population samples. No ablation yet identifies its share of field-gap or front-position advantage.'
};
const report = { measuredAt: new Date().toISOString(), engineHash: A.EXPECTED,
  inputFiles: names, inputFileSha256: Object.fromEntries(Object.entries(names).map(([k, f]) => [k, crypto.createHash('sha256').update(readArchived(path.join(ROOT, 'docs', f))).digest('hex')])),
  counts: { realRaces: 18, realStarts: data.reality.summary.starts, realFinishers: data.reality.summary.finishers,
    independentPopulationRaces: data.population.samples.length, independentExternalRuns: primaryRuns.length,
    legacyPopulationRaces: data.legacyPopulation.samples.length, legacyExternalRuns: data.timing.rows.filter(r => r.group !== 'actual-field-size-independent-stream').reduce((a, r) => a + r.runs.length, 0),
    note: 'Legacy and independent runs are related sampling sensitivities. 54 replay runs are three seeds applied to 18 references, with seeds reused by distance/year; not 54 new independent real races.' },
  paired, aggregate, perDistance, externalStyle, externalStyleOverall: entryStyle(primaryRuns), populationStyles, controlled, samplingSensitivity, trafficBraking,
  integrity: { engineUnchanged: A.hash() === A.EXPECTED, external: data.timing.integrity, population: data.population.checks, legacyPopulation: data.legacyPopulation.checks },
  boundaries: ['Synthetic G1 ability level86 is a prior global assumption, not measured ratings of real competitors. These are scale/shape comparisons, not horse-for-horse reproductions.',
    'Nominal mean speed duplicates finish-time information. Race-leading 200m speeds, per-horse final600 and internal instantaneous peak are different measurements.',
    'Official final-corner grouped ranks and simultaneous simulated entry snapshot are approximate positional proxies, not identical observations or official habitual styles.',
    'Native game level70 fields are not the G1 class. Healthy/equal flat controls isolate different dimensions but do not reproduce G1 conditions.',
    'Uniform stats70 changes both mean and spread. Native8/16 use different populations, not a pure traffic-density intervention.',
    '18 elite turf races, three per distance, cannot establish all-grade/all-surface win rates or universal empirical tolerances.' ] };
const JSON_OUT = path.join(ROOT, 'docs/current-engine-reality-assessment-2026-10-02.json');
fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n');
const f = (x, digits = 2) => Number.isFinite(x) ? x.toFixed(digits) : '—', pct = x => f(x * 100, 1) + '%';
const lines = ['# 当前比赛引擎现实差距评估 · 2026-10-02', '',
  '冻结提交582ce90，v2026.10.02.2，引擎SHA-256：`' + A.EXPECTED + '`。本轮只测量与诊断，没有调整比赛参数或修改引擎。', '',
  '**结论：冠军总时间和冠亚秒差已达到相近量级，但比赛展开、马群分布、逐马末段分化与位置变化仍未拟合。另确认一条交通结算导致瞬时清零速度的物理缺陷。不能把冠军时间近似解读为整个比赛系统已贴近现实。**', '',
  `现实参照18场2023–2025 JRA草地G1：${report.counts.realStarts}次实际出走、${report.counts.realFinishers}次完赛。主评估包括432场独立随机流合成矩阵，以及按真实出马数的54次G1档位对照。另保留432+108次旧随机口径复核，共1026场正式模拟。24场工具探针不纳入正式统计。`, '',
  '生成与比赛复用随机序列会耦合强马位置和闸位，因此主评估使用分离的伪随机流。旧结果保留作敏感性，不当独立样本。现实18场也是已查看参照，不再称新留出。每场三次试算取中位，再以18场为统计单位。', '',
  '## 总时间、均速与冠军末600米', '',
  '固定86级、优秀骑手、零初始疲劳、50斗志；全场使用真实冠军负重、假设480kg马体重，A栏代理、静风。真实阵容能力/策略/状态没有被逐马反推。以下数值说明量级是否接近，不等于同场复演。每距真实3场、模拟9次。', '',
  '| 距离 | 真实冠军时间中位/s | 模拟/s | 配对赛时相对差中位 | 真实→模拟名义均速/m/s | 真实→模拟冠军末600/s |', '|---|---:|---:|---:|---:|---:|'];
for (const r of perDistance) { const m = r.metrics; lines.push(`| ${r.length} | ${f(m.winnerTime.real.median)} | ${f(m.winnerTime.simulation.median)} | ${f(r.medianPairedTimeErrorPercent)}% | ${f(m.winnerMeanSpeed.real.median)}→${f(m.winnerMeanSpeed.simulation.median)} | ${f(m.winnerFinal600.real.median)}→${f(m.winnerFinal600.simulation.median)} |`); }
lines.push('', '均速是距离÷时间，与赛时不是两项独立证据。不同年度场地条件、阵容和展开并未复刻；相对差按同场逐对计算，再取中位，不能用两列中位之比代替。', '',
  `18场冠军总时间绝对相对误差中位${f(Q(paired.map(r => Math.abs(r.winnerTimeErrorPercent)), .5), 3)}%，最大${f(Math.max(...paired.map(r => Math.abs(r.winnerTimeErrorPercent))), 3)}%；冠军末600绝对相对误差中位${f(Q(rows.map(r => Math.abs(r.residual.winnerFinal600.relative) * 100), .5), 3)}%，最大${f(Math.max(...rows.map(r => Math.abs(r.residual.winnerFinal600.relative) * 100)), 3)}%。首马前600最大误差${f(Math.max(...rows.map(r => Math.abs(r.residual.leaderFirst600.relative) * 100)), 3)}%，仍超出旧10%宽松门槛。达到宽松总时间门槛不等于逐段或整个系统拟合。`, '',
  '## 群体差距与速度形状', '', '| 指标（每场统计后取中位） | 现实 | 当前模拟 |', '|---|---:|---:|');
for (const [k, label, scale, digits] of [
  ['marginSeconds', '冠亚完赛时间差/s', 1, 3], ['marginLengths', '冠亚名义马身差', 1, 2], ['tailSeconds', '首末完赛时间差/s', 1, 2],
  ['within1Second', '冠军后1秒内完赛者占比/%', 100, 1], ['within2Seconds', '冠军后2秒内完赛者占比/%', 100, 1],
  ['final600Span', '全场逐马末600极差/s', 1, 2], ['post200CvRounded01', '排除起步200米后的首马分段CV/%（同为0.1s）', 100, 2],
  ['first200', '首马起步200米/s', 1, 2], ['fastest200', '首马最快200米/s', 1, 2],
  ['final200MinusPrevious', '最后200米比前200米多用时/s', 1, 3], ['earlyLate600Difference', '首马末600减前600/s', 1, 2],
  ['firstFifthMeanSpeedGap', '冠军与第5名名义均速差/m/s', 1, 3] ]) {
  const m = aggregate[k]; lines.push(`| ${label} | ${f(m.real?.median * scale, digits)} | ${f(m.simulation?.median * scale, digits)} |`);
}
lines.push('', '冠亚马身的现实中位/P90为1.25/2.8，来自完整18场排序；6场鼻/头/颈小着差没有强行数值换算。模拟用冠军过线时空间差÷2.4m，和官方照片终点着差仍有测量差异，完赛秒差是补充比较。首末差仅比较完赛者，不把中止当无限大差距。', '',
  `各场全场最高瞬时速度的范围为${f(Math.min(...primaryRuns.map(r => r.peakSpeed)))}–${f(Math.max(...primaryRuns.map(r => r.peakSpeed)))}m/s。现实没有这18场逐马GPS峰速，不能据此宣布峰速拟合。2024短途最快首马200米9.9s（约20.2m/s）仅是局部速度量级/峰速下界参照，绝非同口径瞬时峰值。`, '',
  '![赛时、分段与马群差异图](current-engine-reality-assessment-2026-10-02.png)', '',
  '## 各跑法/位置在各距离的出走胜率', '',
  '下表首先给游戏本身的观察跑法：80米至八成距离的决策时平均相对名次分类。每距离每规模24场、等级70、默认生成状态，草地/回转适性匹配。胜率分母是该类别实际出走次数，括号为胜场/出走。它是事后分类统计，不是给某个跑法标签的因果胜率。', '');
for (const n of [8, 16]) {
  lines.push(`### ${n}匹默认生成阵容`, '', '| 距离 | 逃 | 先 | 差 | 追 |', '|---|---:|---:|---:|---:|');
  for (const row of populationStyles.filter(r => r.n === n)) lines.push(`| ${row.length} | ${row.engineObserved.map(s => `${pct(s.perStart)} (${s.wins}/${s.starts})`).join(' | ')} |`);
  lines.push('');
}
lines.push('JSON另外保存赛前标签与终直入口位置代理两种口径、冠军构成及按整场重采样的95%区间；不能把“出走胜率”和“冠军构成”混用。零胜组的经验重采样区间可能退化为0，不代表理论胜率为0；仅24场的结果不能当精确概率。', '',
  '### 与现实可近似比较的末弯位置代理', '',
  '统一规则：名次1=逃；2..ceil(N×0.375)=先；其后至ceil(N×0.625)=差；剩余=追。现实为JRA末弯报出名次，模拟为领跑者进入终直时全场排名。JRA并列组保留名次范围，分类边界不确定性见来源JSON。因此这是近似位置比较，并非官方四跑法。每距现实仅3场，不能作为全JRA精确胜率目标。', '',
  '| 距离 | 现实逃/先/差/追出走胜率 | 模拟逃/先/差/追出走胜率 |', '|---|---|---|');
for (const row of externalStyle) lines.push(`| ${row.length} | ${row.real.map(s => `${pct(s.starterWinRateReportedProxy)} (${s.winsReportedProxy}/${s.startsReportedProxy})`).join(' / ')} | ${row.simulation.map(s => `${pct(s.perStart)} (${s.wins}/${s.starts})`).join(' / ')} |`);
lines.push('', `18场现实冠军末弯代理构成0/13/4/1；54次模拟构成为${report.externalStyleOverall.map(s => s.wins).join('/')}（逃/先/差/追）。真实样本小、比赛间相关、并行名次和采样时刻有差异，仍应将前位保持作为重点诊断信号，不能将某个固定胜率设成引擎配额。`, '',
  '## 固定场地与能力向量对照', '',
  '两个16匹平坦抽象场地组各72场。同一批马跨距离复用，健康/普通骑手/固定负重；统一能力组仅将全部属性改为70，保留原行为与计划。此干预同时改变属性均值及离散，不能称只消除能力方差。', '',
  '| 组别 | 冠亚马身中位/P90 | 首末马身中位 | 半程首位最终胜率 | 终直入口首位最终胜率 | 观察跑法冠军构成逃/先/差/追 |', '|---|---:|---:|---:|---:|---|');
for (const c of controlled) lines.push(`| ${c.context} | ${f(c.marginLengths.median)}/${f(c.marginLengths.p90)} | ${f(c.tailLengths.median)} | ${pct(c.halfLeaderWon)} | ${pct(c.straightLeaderWon)} | ${c.style.engineObserved.map(s => s.wins).join('/')} |`);
lines.push('', '默认8/16匹来自不同生成阵容，规模比较含阵容变化，不能当纯交通密度实验。能力统一组保留闸位、随机观察、不同性格/风险及走位；若仍有前后差距，只能排除“能力差异是唯一原因”，不能据此锁定一个机制。', '',
  '## 已确认的运动—交通接口缺陷', '',
  '正常运动先以3.5m/s²限制制动，但末尾的身体间距纠正直接重写位置和速度（`sim.js:1189–1196`），没有遵守此限制。横移预检各自对照邻马旧横坐标，末尾检查双方新横坐标；双方相向移动可以分别通过预检，却在末结算互相侵入安全间距。这时后马可被直接停住。', '',
  '| 正式矩阵组 | 场数/马次 | 观察到低于−50m/s²的场数/马次 | 最差采样减速度/m/s² |', '|---|---:|---:|---:|');
for (const c of trafficBraking.contexts) lines.push(`| ${c.context} | ${c.races}/${c.starts} | ${c.racesWithExtremeBraking}/${c.startsWithExtremeBraking} | ${f(c.worst.acceleration, 1)} |`);
lines.push('', '−50仅用于描述极端不连续事件，并非新增现实合格线。矩阵每1/30秒读取最后一个内部步，可能漏掉其他内部步的事件；上述场数/马次不是事件总次数。', '');
for (const r of data.trafficReproduction.records) {
  const e = r.targetWorst;
  lines.push(`- ${r.context}：生成种子${r.generationSeed}、比赛种子${r.raceSeed}，${e.id}在${f(e.time, 6)}秒、赛程${f(e.before.s, 3)}/${r.length}米处，${f(e.before.v, 6)}→${f(e.after.v, 6)}m/s，用时1/60秒（${f(e.after.accel, 3)}m/s²）。原运动提案是${f(e.proposal.v, 6)}m/s，随后交通纠正夹低速度。此时尚未完赛。`);
}
lines.push('', '两个复现只在冻结源代码的内存副本加观测回调，保留原1/30外步长、随机调用与全部逐马完赛时间；记录每个内部1/60步。复现与正式矩阵逐马时间及外层采样减速度完全一致，因此排除了观测改变比赛和终点截断的解释。', '',
  '**已确认的是同步横移检查与速度纠正不一致；尚未确认的是它对马群拉散、前位优势和差追零胜各占多大贡献。** 当前也没有对应身体接触、摔倒或骑手拉停状态解释这次突变。做功/储备账通过并不能证明制动与接触运动合理。', '',
  '## 系统层面的解释边界', '',
  '把输出差异与代码机制清单分开。以下是待识别的机制组合，不是已证明的单一原因：', '',
  '- 速度曲线过平、早期位置保持：马自身没有随竞争/受阻变化的抢口、兴奋、抗拒状态；骑手主要围绕单个余程目标配速；比赛节奏由局部预算与抢位形成。需一起核对马自身行为、战术互动、真实坡弯及能力分布，而非只改发动阈值。',
  '- 末600差异不足或后方难反超：耐力同时决定有氧与短储备，速度同时决定上限与经济性，多数供能/疲劳参数全马共用；未来疲劳预测冻结当前值。需检查个体能力联合分布、真实参赛选择、运动状态演化与出力策略，不能只提高后方速度。',
  '- 特定距离/赛段偏差：两直两圆弯与文字高程代理，缺少真实引入线、变曲率、移栏和地面空间差异；应定位实际发走位置与坡弯前后残差，不能给该距离加一个补偿倍率。',
  '- 大头数差距/走位：已有身体约束、横移与绕行，遮挡仍是二元范围规则，通道预测短；入口位置优势也可能是较快马早已领先。需要匹配同能力/气性、不同交通布置和真实通过位置，才能区分交通和策略。',
  '- 伤病/失足/中止：现实来源4次中止全部保留；当前DNF只有600秒工程超时，没有对应竞技事件。此缺失影响异常尾部，不应拿常态耗能去模拟事故。', '',
  '同样，步态/热状态/水分/蹄地接触目前没有独立状态，但仅凭总时间和分段不能识别它们各自的重要性。应优先解释本轮观察到的速度形状和位置变化，再决定增加哪一层机制。', '',
  '## 从系统着手的下一轮工作', '',
  '1. 先修复已复现的运动—交通不一致：同步预测邻马完整轨迹，约束横移与有限制动的可行性，明确无法避让时的接触/事件处理。用同一马群、种子和指令轨迹比较修复前后，不靠改变跑法倍率补偿；检查其实际改变了多少场内差距与位置转换。',
  '2. 再识别比赛节奏如何生成：记录骑手目标速度、马实际响应、竞争抢位、受阻与储备演化。对照多阶段出力计划、动态马行为与当前单余程目标计划，确认过平速度曲线主要来自哪一层；不预设每个距离的固定发动点。',
  '3. 随后识别个体分化：将有氧能力、短时储备/功率、经济性、疲劳耐受及恢复的联合分布与真实阵容选择联系起来。同马跨距离与多次出赛，检验后方追赶、末段差异和距离优势能否自然形成。',
  '4. 对残差仍集中于特定地点的赛事补真实路线：实际发走引入线、弯曲率、坡段、移栏和地面差异。保持上述共同机制，避免增加每距离补偿系数。', '',
  '后3项是识别顺序，不是本轮已证实的单一病因。现有18场均已查看；下一轮若据此改模型，须另选未用于设计/调参的赛事作外部检验，并扩展级别、泥地、场地状态和同马数据。', '',
  '## 文件与复现', '',
  '- [现实官方逐马来源与口径](current-engine-reality-sources-2026-10-02.md)',
  '- [G1档位逐场时间/速度报告](current-real-timing-audit-2026-10-02.md)',
  '- [系统机制清单与代码证据](current-engine-system-audit-2026-10-02.md)',
  '- [交通制动逐内部步复现证据](current-engine-traffic-braking-audit-2026-10-02.json)',
  '- [整合机器报告](current-engine-reality-assessment-2026-10-02.json)',
  '- [独立随机流全部432场（gzip归档）](current-engine-population-audit-independent-2026-10-02.json.gz)', '',
  '```powershell', 'node tests/current-engine-population-audit.js --seeds 24 --workers 2 --seed-policy independent --out docs/current-engine-population-audit-independent-2026-10-02.json',
  'node tests/current-real-timing-audit.js', 'node tests/current-engine-traffic-braking-audit.js', 'node tests/current-engine-reality-assessment.js', '```', '',
  '数值通过范围只在已有v7宽松赛时/末600/前600门槛下披露，不新增事后胜率或着差硬门槛。首马CV、位置代理、个体末600离散是结构诊断指标，没有假装它们已完成独立现实验证。');
fs.writeFileSync(path.join(ROOT, 'docs/当前比赛引擎-现实差距评估-2026-10-02.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ counts: report.counts, aggregate, perDistance: perDistance.map(r => ({ length: r.length, time: r.metrics.winnerTime, error: r.medianPairedTimeErrorPercent })), externalStyleOverall: report.externalStyleOverall }, null, 2));
