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
 *       默认 50 150
 * ============================================================ */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const PER = Number(process.argv[2]) || 50;
const DRAMA_N = Number(process.argv[3]) || 150;

const STYLES = ['逃', '先', '差', '追'];
const DISTS = [1200, 1600, 2000, 2400, 3000];
const HORSE_LEN = 2.4;               // 1 马身 ≈ 2.4m（JRA 通行换算）

const rule = (c) => console.log((c || '─').repeat(74));
const pct = (x) => (x * 100).toFixed(1);

/* ---------- 单场：属性同源，只有跑法不同 ---------- */
function fieldSameStats(seed, level) {
  const proto = S.makeHorse(S.mulberry32(seed + 4242), { style: '先', level: level || 70, id: 'p' });
  const field = [];
  for (let i = 0; i < 8; i++) {
    const h = S.makeHorse(S.mulberry32(seed + 4242), { style: STYLES[i % 4], level: level || 70, id: 'h' + i });
    Object.assign(h.stats, JSON.parse(JSON.stringify(proto.stats)));
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
 * ============================================================ */
function styleMatrix() {
  const rows = [];
  DISTS.forEach((L) => {
    const win = { '逃': 0, '先': 0, '差': 0, '追': 0 };
    let fin = 0;
    for (let t = 0; t < PER; t++) {
      const seed = 20260101 + t * 7919;
      const rc = runRace(fieldSameStats(seed), { length: L }, seed);
      const w = rc.race.order[0];
      if (w) { win[w.style]++; fin++; }
    }
    const p = STYLES.map((s) => win[s] / Math.max(1, fin));
    rows.push({ L, p, spread: Math.max.apply(null, p) - Math.min.apply(null, p) });
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
    for (let i = 0; i < 8; i++) {
      field.push(S.makeHorse(rng, { style: STYLES[i % 4], level: 62 + (i % 3) * 4, id: 'h' + i }));
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
console.log('【① 胜率结构】跑法 × 距离（属性同源，仅跑法不同；每档 ' + PER + ' 场）');
rule();
console.log('  距离      逃       先       差       追     极差   前速(逃+先)  后上(差+追)');
let spreadOK = true, monoOK = true;
const frontShare = [];
styleMatrix().forEach((r) => {
  const front = r.p[0] + r.p[1];
  const back = r.p[2] + r.p[3];
  frontShare.push(front);
  if (r.spread > 0.25) spreadOK = false;
  console.log('  ' + String(r.L).padStart(4) + 'm  ' +
    r.p.map((x) => (pct(x) + '%').padStart(7)).join('  ') +
    '  ' + (pct(r.spread) + '%').padStart(6) +
    '  ' + (pct(front) + '%').padStart(10) +
    '  ' + (pct(back) + '%').padStart(11) +
    (r.spread > 0.40 ? '  ❌' : r.spread > 0.25 ? '  ⚠️' : '  ✅'));
});
/* 单调性：前速占比应随距离下降 */
for (let i = 1; i < frontShare.length; i++) if (frontShare[i] > frontShare[i - 1] + 0.02) monoOK = false;
rule();
console.log('  极差 ≤25%：' + (spreadOK ? '✅ 通过' : '❌ 未通过'));
console.log('  前速占比随距离单调下降：' + (monoOK ? '✅ 通过' : '❌ 未通过')
  + '  （1200m ' + pct(frontShare[0]) + '% → 3000m ' + pct(frontShare[frontShare.length - 1]) + '%）');
console.log('  现实参照：短途由前速主导（逃+先 ≥55%），长途由后上主导（差+追 ≥55%）');

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
console.log('  本场跑法胜率：' + STYLES.map((s) =>
  s + ' ' + pct(d.styleWin[s] / Math.max(1, d.finishers)) + '%').join('　'));

console.log('');
rule('═');
const allOK = spreadOK && monoOK && marginOK && dramaOK;
console.log(allOK ? '  ✅ 三项全部通过' : '  ⚠️ 仍有未达标项（见上方 ❌）');
console.log('  复现：node tests/realism.js ' + PER + ' ' + DRAMA_N);
rule('═');
console.log('');
process.exit(allOK ? 0 : 1);
