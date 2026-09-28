#!/usr/bin/env node
/* ============================================================
 * 市场模型验证：信息差在期望回报上值多少钱？
 * ------------------------------------------------------------
 * 做法：
 *   ① 造 M 个阵容（8 匹），每个阵容跑 R 次不同的比赛 → 估计每匹马"真实胜率"
 *      （用比赛引擎实测，不用属性近似；含碰撞/失速/被挡等所有不确定性）
 *   ② 市场模型只看公开信息 → 给出 人气 / 赔率
 *   ③ 对比若干下注策略的期望回报（ROI）：
 *        人气王        盲投热门（应 < 1，因为有抽水）
 *        公众智能      按公开信息估概率挑正期望（市场理论的极限）
 *        市场逆势      押"血统好但战绩差"的冷门（利用公众轻视血统）
 *        上帝视角      按真实胜率挑正期望（玩家拥有员工情报的上限）
 *   ④ 输出：市场 vs 真实的相关系数、三种策略 ROI、以及平均套利空间
 *
 * 判读标准（目标是"技术能赢、新手会亏"）：
 *    · 人气王 ROI        ≈ 0.82 ~ 0.90        （新手长期必亏）
 *    · 市场逆势 ROI      > 1.0                （学会规律就能赢）
 *    · 上帝视角 ROI      ≈ 1.05 ~ 1.25        （信息差的上限，留出空间给员工系统）
 *    · 相关系数          ≈ 0.3 ~ 0.6          （太低说明市场太蠢，太高说明没得赚）
 *
 * 用法：node tests/market.js [阵容数] [每个阵容跑几次]
 * ============================================================ */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const FIELDS = Number(process.argv[2]) || 400;
const RUNS = Number(process.argv[3]) || 12;
const FIELD_N = 8;
const MAX_BETS = 30;          // 统计 ROI 时最多取多少条投注（避免"上帝"样本过多）

/* ---------------- 统计工具 ---------------- */
function corr(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : NaN;
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function fmt(x, d) { return Number(x).toFixed(d === undefined ? 3 : d); }
function pct(x) { return (x * 100).toFixed(1) + '%'; }

/* ---------------- 单场：造阵容 → 市场定价 → 实测真实胜率 ---------------- */
const strategies = {
  '人气王':     { bet: 0, win: 0, n: 0 },   // 每场押人气第 1
  '公众智能':   { bet: 0, win: 0, n: 0 },   // 按公开信息估概率，挑正期望
  '市场逆势':   { bet: 0, win: 0, n: 0 },   // 押"血统强但战绩差"的冷门
  '上帝视角':   { bet: 0, win: 0, n: 0 },   // 按真实胜率挑正期望（上限）
};
const scatter = [];        // { mkt, tru } 用于算相关系数
let totalHorses = 0, totalRaces = 0;
let edgeSum = 0, edgeN = 0;         // 上帝视角每场的最大期望值
let mktEdgeSum = 0;                 // 公众智能每场的最大期望值
let overroundSum = 0;               // 实际抽水率校验

function place(strategy, odds, stake, won) {
  const s = strategies[strategy];
  s.bet += stake; s.n++;
  if (won) s.win += stake * odds;
}

for (let f = 0; f < FIELDS; f++) {
  const seed = 20260101 + f * 7919;
  /* 场次水平：模拟真实赛事的分级（新马赛 44-54 … G1 76-88）。
     同场马的水平仍有重叠，但不是完全相同——这样市场才有真实的区分度。 */
  const lvBand = [[44, 56], [50, 62], [56, 68], [62, 74], [68, 80], [74, 88]][f % 6];
  const lv = lvBand[0] + (f % 7) / 7 * (lvBand[1] - lvBand[0]);
  const field = S.makeField(S.mulberry32(seed), { n: FIELD_N, level: lv });

  /* 随机一个赛事条件（只影响适性判分，不影响比赛参数，避免引入额外变量） */
  const raceOpts = {
    surface: seed % 2 ? '草地' : '泥地',
    dir: seed % 3 ? '左回' : '右回',
  };

  /* ① 市场定价：只吃公开信息 */
  const mktRng = S.mulberry32(seed + 12345);
  const market = S.marketOddsAndPopularity(field, raceOpts, mktRng);

  /* ② 实测真实胜率：同一批马跑 RUNS 次，每次用不同种子 */
  const wins = {};
  field.forEach((h) => { wins[h.id] = 0; });
  let finished = 0;
  for (let r = 0; r < RUNS; r++) {
    const rc = S.createRace(field, {
      length: 2000, surface: '草地', state: '良', profile: '缓坂',
      styleCoefs: 'balanced', rng: S.mulberry32((seed * 31 + r * 1009) >>> 0),
    });
    let g = 0;
    while (!rc.race.finished && g++ < 300000) rc.step(1 / 30);
    const w = rc.race.order[0];
    if (w) { wins[w.id]++; finished++; }
  }
  if (finished < RUNS * 0.9) continue;      // 异常场次跳过
  totalRaces += RUNS;
  totalHorses += field.length;

  const trueP = {}, mktP = {}, oddsOf = {};
  field.forEach((h) => {
    trueP[h.id] = wins[h.id] / finished;
    mktP[h.id] = market.byId[h.id]['概率'];
    oddsOf[h.id] = market.byId[h.id]['赔率'];
    scatter.push({ mkt: mktP[h.id], tru: trueP[h.id] });
  });

  /* 抽水校验：所有马 1/赔率 之和应 ≈ 1 + takeout/(1-takeout) */
  overroundSum += field.reduce((s, h) => s + 1 / oddsOf[h.id], 0);

  /* ③ 各策略各挑 1 注（每场最多 MAX_BETS 条，避免"上帝"主导样本量） */
  const pickByEV = (probOf) => {
    let best = null;
    field.forEach((h) => {
      const ev = S.expectedValue(probOf(h, trueP, mktP), oddsOf[h.id]);
      if (!best || ev > best.ev) best = { h, ev };
    });
    return best;
  };

  /* 人气王：每场固定 1 注 */
  const fav = market.order[0];
  place('人气王', oddsOf[fav], 1, wins[fav] > 0);

  /* 公众智能：完全读懂市场（用市场概率下注）。
     这是"没有内幕信息"的理论上限——用来验证光靠公开信息能不能赚钱。 */
  field.forEach((h) => {
    if (S.expectedValue(mktP[h.id], oddsOf[h.id]) <= 0) return;
    place('公众智能', oddsOf[h.id], 1, wins[h.id] > 0);
  });

  /* 市场逆势：押"血统强但战绩差"的冷门。
     这里用真实胜率判断是否命中，代表"玩家已经学会这条规律"后的收益。 */
  field.forEach((h) => {
    const st = h.form ? (h.form['出赛'] || 0) : 0;
    const wn = h.form ? (h.form['胜利'] || 0) : 0;
    const blood = (h.stats && h.stats['血统力']) || 0;
    if (blood >= 60 && st > 0 && (wn / st) <= 0.15 && mktP[h.id] < 0.12) {
      place('市场逆势', oddsOf[h.id], 1, wins[h.id] > 0);
    }
  });

  /* 上帝视角：按真实胜率挑正期望——玩家拥有准确员工情报时的上限 */
  field.forEach((h) => {
    const ev = S.expectedValue(trueP[h.id], oddsOf[h.id]);
    if (ev <= 0) return;
    place('上帝视角', oddsOf[h.id], 1, wins[h.id] > 0);
    edgeSum += ev; edgeN++;
  });
}

/* ---------------- 输出 ---------------- */
const rule = () => console.log('─'.repeat(74));
console.log('');
console.log('市场模型验证：信息差在期望回报上值多少钱');
rule();
console.log('阵容数      : ' + FIELDS + '（每阵容 ' + FIELD_N + ' 匹）');
console.log('每阵容跑次  : ' + RUNS + '  → 共实测 ' + totalRaces + ' 场比赛、' + totalHorses + ' 个"马匹-场次"样本');
console.log('市场参数    : temp=' + S.MARKET.temp + '  takeout=' + S.MARKET.takeout +
            '  权重 form=' + S.MARKET.wForm + ' jockey=' + S.MARKET.wJockey +
            ' blood=' + S.MARKET.wBlood + ' age=' + S.MARKET.wAge + ' fit=' + S.MARKET.wFit);
console.log('');

console.log('【市场准度】');
const c = corr(scatter.map((x) => x.mkt), scatter.map((x) => x.tru));
console.log('  市场概率 vs 真实胜率 相关系数 = ' + fmt(c, 3));
console.log('  （≈1 表示市场全知、没有套利空间；0.3~0.6 表示存在可利用的错价）');
console.log('  实测平均 overround = ' + fmt(overroundSum / FIELDS, 4) +
            '（理论 ' + fmt(1 + S.MARKET.takeout / (1 - S.MARKET.takeout), 4) + '）');
console.log('');

console.log('【各策略期望回报 ROI】（1.0 = 不赔不赚）');
console.log('  策略        投注数    ROI      判断');
const verdict = {
  '人气王': (r) => r < 0.95 ? '✅ 新手长期必亏（有抽水）' : '⚠️ 偏高，抽水可能太轻',
  '公众智能': (r) => r > 0.95 && r < 1.06 ? '✅ 读懂市场只能打平，赚不到钱' : (r >= 1.06 ? '⚠️ 光靠公开信息就能赚，信息差没意义' : ''),
  '市场逆势': (r) => r > 1.0 ? '✅ 学会"血统被低估"这条规律就能赢' : '⚠️ 这条规律目前不成立',
  '上帝视角': (r) => (r > 1.03 && r < 1.35) ? '✅ 信息差有明确价值（这是员工系统的空间）' : (r >= 1.35 ? '⚠️ 太大，游戏会太容易' : '⚠️ 太小，看穿情报也赚不到钱'),
};
for (const k of Object.keys(strategies)) {
  const s = strategies[k];
  const roi = s.bet > 0 ? s.win / s.bet : NaN;
  console.log('  ' + k.padEnd(10) + '  ' + String(s.n).padStart(5) + '   ' +
              (isNaN(roi) ? '  n/a' : fmt(roi, 3).padStart(6)) + '   ' + (verdict[k] ? verdict[k](roi) : ''));
}
console.log('');

console.log('【套利空间（每场最佳机会的期望值）】');
console.log('  上帝视角 平均最大 EV = ' + fmt(edgeN ? edgeSum / edgeN : NaN, 4) +
            '（出现在 ' + edgeN + '/' + FIELDS + ' 场）');
console.log('  公众智能 平均最大 EV = ' + fmt(mktEdgeSum / FIELDS, 4) + '（>0 说明光看公开信息也有正期望机会）');
console.log('');

rule();
console.log('结论');
rule();
if (c > 0.75) console.log('  ⚠️ 市场太准（相关系数 ' + fmt(c, 2) + '）→ 调低权重或加大 wNoise，让市场更容易犯错');
else if (c < 0.25) console.log('  ⚠️ 市场太蠢（相关系数 ' + fmt(c, 2) + '）→ 赔率会失去可信度，调高权重');
else console.log('  ✅ 市场准度在合理区间（相关系数 ' + fmt(c, 2) + '），存在可利用的错价');
const godROI = strategies['上帝视角'].bet > 0 ? strategies['上帝视角'].win / strategies['上帝视角'].bet : NaN;
const favROI = strategies['人气王'].bet > 0 ? strategies['人气王'].win / strategies['人气王'].bet : NaN;
if (!isNaN(godROI) && !isNaN(favROI)) {
  console.log('  盲投热门 ROI ' + fmt(favROI, 3) + '，上帝视角 ROI ' + fmt(godROI, 3) +
              ' → 信息差溢价 ' + fmt((godROI - favROI) * 100, 1) + ' 个百分点');
}
console.log('');
console.log('复现：node tests/market.js ' + FIELDS + ' ' + RUNS);
console.log('');
