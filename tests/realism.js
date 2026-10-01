#!/usr/bin/env node
/* ============================================================
 * 真实度体检：把「贴近现实」拆成三条可量化的指标
 * ------------------------------------------------------------
 * 本脚本是《比赛系统-现实差距评估》的验收台。三条目标：
 *
 *   ① 胜率结构 —— 跑法的胜率必须随距离单调迁移
 *        短途：逃/先 占优（没有足够距离完成超越）
 *        长途：差/追 占优（前速马烧完油在后段被追上）
 *   ② 马身差距 —— 冠军-亚军着差要落在真实赛马量级
 *        现实：一级赛冠军常以 クビ~2 马身 取胜，中位数约 1~2 马身
 *   ③ 不可预测性 —— 比赛要有悬念
 *        半程领先者即冠军的比例应接近随机（约 50%），而非 70%+
 *
 * 用法：node tests/realism.js [每档场次] [悬念场次]
 *       默认 200 150
 *
 * ⚠️ ① 段的口径说明（2026-10-01 修正）：
 *   1. 出赛构成必须用【游戏真实分布】（逃1 先2~3 差2 追2）。
 *      旧版用「4 跑法各 2 匹」，等于让逃马占 25% → 每场都判成ハイペース →
 *      逃马被 paceTax 永久重罚，测出的「追 74%/逃 0%」相当部分是假象。
 *   2. 口径用【胜场 / 该跑法出赛次数】（基准 1/8 = 12.5%），
 *      而不是「胜场 / 场次」。因为各跑法的出赛次数并不相等。
 *   3. 属性必须【全同源】（含斗志/疲劳/骑手），否则测的是能力不是跑法。
 * ============================================================ */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const PER = Number(process.argv[2]) || 200;
const DRAMA_N = Number(process.argv[3]) || 150;

const STYLES = ['逃', '先', '差', '追'];
const DISTS = [1200, 1600, 2000, 2400, 3000];
const HORSE_LEN = 2.4;               // 1 马身 ≈ 2.4m（JRA 通行换算）

const rule = (c) => console.log((c || '─').repeat(74));
const pct = (x) => (x * 100).toFixed(1);

/* ---------- 现实基准（JRA 芝 · 4角通過順による脚質分類）----------
   来源：bakenshi.net 汇总的 JRA「全競馬場同距離区分」脚質別 1着率。
   口径：1着率 = 胜场 / 该跑法的出赛次数。

   ⚠️ 这份数据纠正了一个流传很广的误解。现实【不是】「短途靠前速、长途靠后上」：
     在 1400~2100m 全区间，逃 的 per-start 胜率都【最高】（≈2.1~2.2× 均等），
     追 【最低】（≈0.4×）。真正的距离依赖只出现在【最高级别】——
     東京芝 G1 近 37 战，逃 0 胜（上級条件ほど逃げ切りが難しい）。

   原因：JRA 的脚質按【4角通過順位】划分，「逃」= 4角领跑者，每场仅 1 匹，
     而那匹马本身就是「走位成功」的结果（幸存者偏差）。
     故本表额外给出【相对均等的比值】= 1着率 ÷ (1 / 平均出走头数)，
     它比原始百分比更适合跨「出赛构成」比较。 */
const REAL_REF = {
  1200: { label: '短途（外推，+前有利）', target: [2.60, 1.25, 0.85, 0.32], extrap: true },
  1600: { label: 'マイル 1400-1800（实测）', rate: { '逃': 0.174, '先': 0.105, '差': 0.073, '追': 0.030 }, field: 12.6, target: [2.19, 1.32, 0.92, 0.38] },
  2000: { label: '中距離 1900-2100（实测）', rate: { '逃': 0.175, '先': 0.107, '差': 0.082, '追': 0.035 }, field: 11.7, target: [2.05, 1.25, 0.96, 0.41] },
  2400: { label: '長距離 2100-2700（外推）', target: [1.75, 1.30, 1.00, 0.45], extrap: true },
  3000: { label: '長距離 2100-2700（外推）', target: [1.45, 1.35, 1.05, 0.45], extrap: true },
};

/* ---------- 真实出赛构成（与 sim.js 的 makeField / 生涯对手生成一致）----------
   ⚠️ 不要用「4 跑法各 2 匹」！那等于让逃马占 25%，每场都被判成ハイペース，
   逃马被 paceTax 永久重罚 —— 测出来的「追 74% / 逃 0%」有相当部分是假象。
   构成：与 sim.js 的 fieldStyles 同源（JRA 芝脚质构成，保底 1 匹逃）。
   ⚠️ 别再退回「4 跑法各 2 匹」或「固定 1 逃 + 2 先 + 2 差 + 2 追」——前者会让
   逃马占 25%（每场都ハイペース），后者会让逃马数量恒为 1（ハイ永不可达）。 */
const FIELD_W = [['逃', 16], ['先', 28], ['差', 30], ['追', 26]];
function wPick(rng, w) {
  let total = 0;
  for (const it of w) total += it[1];
  let r = rng() * total;
  for (const it of w) { r -= it[1]; if (r <= 0) return it[0]; }
  return w[w.length - 1][0];
}
function realComposition(rng) {
  const a = [];
  for (let i = 0; i < 8; i++) a.push(wPick(rng, FIELD_W));
  if (a.indexOf('逃') < 0) a[Math.floor(rng() * 8)] = '逃';
  return a;
}

/* ---------- 单场：属性全同源（连斗志/疲劳/骑手都统一），只有跑法不同 ---------- */
function fieldSameStats(seed, styles, level) {
  const proto = S.makeHorse(S.mulberry32(seed + 4242), { style: '先', level: level || 70, id: 'p' });
  const protoStats = JSON.parse(JSON.stringify(proto.stats));
  const field = [];
  for (let i = 0; i < 8; i++) {
    const h = S.makeHorse(S.mulberry32(seed + 4242), { style: styles[i], level: level || 70, id: 'h' + i });
    Object.assign(h.stats, JSON.parse(JSON.stringify(protoStats)));
    h['斗志'] = 70; h['疲劳'] = 0; h.jockeyGrade = '普通';
    field.push(h);
  }
  return field;
}
function runRace(field, opts, seed) {
  const rc = S.createRace(field, Object.assign({
    surface: '草地', state: '良', profile: '缓坂',
    styleCoefs: 'balanced', rng: S.mulberry32((seed * 31 + 7) >>> 0),
  }, opts));
  let g = 0;
  while (!rc.race.finished && g++ < 400000) rc.step(1 / 30);
  return rc;
}

/* ============================================================
 * ① 胜率结构：跑法 × 距离
 * 口径 = 胜场 / 该跑法的出赛次数；无跑法优势时 = 1/8 = 12.5%
 * ============================================================ */
function styleMatrix() {
  const rows = [];
  DISTS.forEach((L) => {
    const win = { '逃': 0, '先': 0, '差': 0, '追': 0 };
    const start = { '逃': 0, '先': 0, '差': 0, '追': 0 };
    for (let t = 0; t < PER; t++) {
      const seed = 20260101 + t * 7919;
      const styles = realComposition(S.mulberry32((seed * 2654435761) >>> 0));
      styles.forEach((s) => { start[s]++; });
      const rc = runRace(fieldSameStats(seed, styles), { length: L }, seed);
      const w = rc.race.order[0];
      if (w) win[w.style]++;
    }
    const p = STYLES.map((s) => win[s] / Math.max(1, start[s]));
    rows.push({
      L, p, start,
      spread: Math.max.apply(null, p) - Math.min.apply(null, p),
    });
  });
  return rows;
}

/* ============================================================
 * ② 着差 + ③ 悬念：混合阵容（属性有差异，更接近真实场次）
 * ============================================================ */
function dramaAndMargin(n) {
  const margins = [];        // 冠军-亚军 着差（马身）
  const spreads = [];        // 冠军-末位 着差（马身）
  let decidedEarly = 0, changesTotal = 0, finishers = 0;
  const posAtHalf = [];
  const styleWin = { '逃': 0, '先': 0, '差': 0, '追': 0 };

  for (let k = 0; k < n; k++) {
    const seed = 900001 + k * 7919;
    const rng = S.mulberry32(seed);
    const field = [];
    /* 场次内能力跨度 ±2（64/66/68）。
       刻意不用 ±4 以上的跨度：现实同班次马的实力要接近得多，
       游戏内的对手生成也已按 FIELD_LEVEL_SPAN=2 收窄（见 sim.js）。 */
    const styles = realComposition(rng);
    for (let i = 0; i < 8; i++) {
      /* ⚠️ level 必须【独立于跑法】随机分配。
         旧版用 level = 64 + (i%3)*2 按序号分配，而风格也按序号排（STYLES[i%4]），
         两者耦合 → 某匹「差」恰好拿到高 level，测出的胜率是【能力优势】而非跑法优势。
         场次内能力跨度取 ±2（64/66/68），与 sim.js 的 FIELD_LEVEL_SPAN 一致。 */
      const lv = 64 + Math.floor(rng() * 3) * 2;
      field.push(S.makeHorse(rng, { style: styles[i], level: lv, id: 'h' + i }));
    }
    const rc = S.createRace(field, {
      length: 2000, surface: '草地', state: '良', profile: '缓坂',
      styleCoefs: 'balanced', rng: S.mulberry32((seed * 31 + 7) >>> 0),
    });
    const frames = [];
    let g = 0;
    while (!rc.race.finished && g++ < 300000) {
      rc.step(1 / 30);
      if (g % 15 === 0) {
        const act = rc.race.horses.filter((h) => !h.dnf);
        const lead = act.reduce((m, h) => (m === null || h.s > m.s ? h : m), null);
        const prog = Math.max.apply(null, act.map((h) => h.s)) / 2000;
        frames.push({ prog, leadId: lead ? lead.id : null,
                      pos: act.map((h) => ({ id: h.id, s: h.s })).sort((a, b) => b.s - a.s) });
      }
    }
    if (!rc.race.order.length) continue;
    finishers++;
    const winner = rc.race.order[0];
    styleWin[winner.style]++;

    /* 着差：冠军冲线瞬间，亚军离终点线的距离 */
    const second = rc.race.order[1];
    if (second && second.gapAtWin != null) margins.push(second.gapAtWin / HORSE_LEN);
    const last = rc.race.order[rc.race.order.length - 1];
    if (last && last.gapAtWin != null) spreads.push(last.gapAtWin / HORSE_LEN);

    /* 悬念 */
    let changes = 0, prev = null;
    frames.forEach((f) => { if (prev !== null && f.leadId !== prev) changes++; prev = f.leadId; });
    changesTotal += changes;
    const half = frames.find((f) => f.prog >= 0.5);
    if (half) {
      const i = half.pos.findIndex((p) => p.id === winner.id);
      posAtHalf.push(i < 0 ? 99 : i + 1);
      if (half.leadId === winner.id) decidedEarly++;
    }
  }
  return { margins, spreads, decidedEarly, changesTotal, finishers, posAtHalf, styleWin };
}

/* ============================================================
 * 输出
 * ============================================================ */
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const p90 = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.9)] : NaN; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('  真实度体检 · 胜率结构 / 马身差距 / 不可预测性');
console.log('══════════════════════════════════════════════════════════════════════');

/* ---- ① 胜率结构 ---- */
console.log('');
console.log('【① 胜率结构】跑法 × 距离');
console.log('  口径：胜场 / 该跑法的出赛次数（属性全同源，仅跑法不同；每档 ' + PER + ' 场）');
console.log('  构成：游戏真实分布（逃1 先2~3 差2 追2），非「4 跑法各 2 匹」');
console.log('  基准：无跑法优势时 = 1/8 = 12.5%');
rule();
console.log('  距离      逃       先       差       追    │实测(相对基准)          目标                最大偏差');
let spreadOK = true, monoOK = true, fitOK = true;
const frontShare = [];
styleMatrix().forEach((r) => {
  const front = r.p[0] + r.p[1];
  const back = r.p[2] + r.p[3];
  frontShare.push(front);
  if (r.spread > 0.25) spreadOK = false;
  const ratio = r.p.map((x) => x / 0.125);
  const T = (REAL_REF[r.L] && REAL_REF[r.L].target) || null;
  const dev = T ? Math.max.apply(null, ratio.map((x, i) => Math.abs(x - T[i]))) : NaN;
  if (T && dev > 0.35) fitOK = false;
  console.log('  ' + String(r.L).padStart(4) + 'm  ' +
    r.p.map((x) => (pct(x) + '%').padStart(7)).join(' ') +
    ' │' + ratio.map((x) => x.toFixed(2).padStart(6)).join(' ') +
    '    ' + (T ? T.map((x) => x.toFixed(2).padStart(5)).join(' ') : '（无靶）') +
    '    ' + (T ? ('±' + dev.toFixed(2)).padStart(6) : '     ') +
    (T && dev > 0.60 ? '  ❌' : T && dev > 0.35 ? '  ⚠️' : '  ✅'));
});
/* 单调性：前速占比应随距离下降 */
for (let i = 1; i < frontShare.length; i++) if (frontShare[i] > frontShare[i - 1] + 0.02) monoOK = false;
rule();
console.log('  跑法间极差 ≤25%：' + (spreadOK ? '✅ 通过' : '❌ 未通过'));
console.log('  与现实的贴合度（各距离最大偏差 ≤0.35）：' + (fitOK ? '✅ 通过' : '❌ 未通过'));
console.log('  前速占比随距离单调下降：' + (monoOK ? '✅ 通过' : '❌ 未通过')
  + '  （1200m ' + pct(frontShare[0]) + '% → 3000m ' + pct(frontShare[frontShare.length - 1]) + '%）');

console.log('');
console.log('  ── 标定目标（JRA 芝 · 全競馬場 · 脚質按 4角通過順）──');
console.log('     实测区间只有 1400~2100m；短途与长距离为外推，见来源说明。');
DISTS.forEach((L) => {
  const R = REAL_REF[L];
  if (!R) return;
  console.log('  ' + String(L).padStart(4) + 'm  ' + (R.extrap ? '※' : ' ') + R.label.padEnd(24) +
    ' 目标 ' + R.target.map((x) => x.toFixed(2).padStart(5)).join(' / ') +
    (R.rate ? '   相对基准 ' + STYLES.map((s) => (R.rate[s] / (1 / R.field)).toFixed(2).padStart(5)).join('/') : ''));
});
console.log('  ⚠️ 现实里【逃】在 1400~2100m 全区间 per-start 胜率都【最高】（≈2.2× 均等），');
console.log('     【追】最低（≈0.4×）——「短途前速、长途后上」并不被这份数据支持。');
console.log('     距离依赖只在【最高级别】显现：東京芝 G1 近 37 战，逃 0 胜。');
console.log('     ※ 短途/长距离两档没有同等量级的公开数据，按「短距离前更有利、');
console.log('       长距离（上級条件に近づくほど逃げ切りが難しい）前稍减」保守外推。');

/* ---- ② ③ ---- */
const d = dramaAndMargin(DRAMA_N);
console.log('');
console.log('【② 马身差距】2000m · ' + d.finishers + ' 场（1 马身 = ' + HORSE_LEN + 'm）');
rule();
console.log('  冠军-亚军着差：中位数 ' + med(d.margins).toFixed(2) + ' 马身　'
  + '平均 ' + mean(d.margins).toFixed(2) + '　p90 ' + p90(d.margins).toFixed(2));
console.log('  冠军-末位着差：中位数 ' + med(d.spreads).toFixed(2) + ' 马身　'
  + '平均 ' + mean(d.spreads).toFixed(2) + '　p90 ' + p90(d.spreads).toFixed(2));
const marginOK = med(d.margins) <= 3.0 && p90(d.margins) <= 10;
console.log('  判读：' + (marginOK ? '✅ 落在真实量级' : '❌ 马群被拉得过开（现实一级赛多以 クビ~2 马身 决出胜负）'));

console.log('');
console.log('【③ 不可预测性】2000m · ' + d.finishers + ' 场');
rule();
const decided = d.decidedEarly / Math.max(1, d.finishers);
const chg = d.changesTotal / Math.max(1, d.finishers);
console.log('  半程领先者即冠军：' + pct(decided) + '%   （目标 ≤60%，越接近随机 50% 越有悬念）');
console.log('  平均每场领先交替：' + chg.toFixed(2) + ' 次   （目标 ≥1.5）');
console.log('  冠军半程名次中位数：' + med(d.posAtHalf) + '   （目标 3~5，太小说明领头者通吃）');
const dramaOK = decided <= 0.60 && chg >= 1.5;
console.log('  判读：' + (dramaOK ? '✅ 比赛是展开的' : '❌ 仍偏"注定"'));

console.log('');
console.log('  混合阵容（能力随机 64/66/68，与跑法解耦）跑法胜率：');
console.log('    ' + STYLES.map((s) =>
  s + ' ' + pct(d.styleWin[s] / Math.max(1, d.finishers)) + '%').join('　')
  + '　（基准 12.5%）');

console.log('');
rule('═');
const allOK = spreadOK && monoOK && marginOK && dramaOK && fitOK;
console.log(allOK ? '  ✅ 三项全部通过' : '  ⚠️ 仍有未达标项（见上方 ❌）');
console.log('  复现：node tests/realism.js ' + PER + ' ' + DRAMA_N);
rule('═');
console.log('');
process.exit(allOK ? 0 : 1);
