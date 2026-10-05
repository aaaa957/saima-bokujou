#!/usr/bin/env node
'use strict';
// 储备轨迹离散度诊断（只读，不跑仿真；直接分析已有批次产物）。
//
// 目的：找出【为什么模拟的马群比现实散】——是能力差异太大，
// 还是比赛动力学把小差异放大了。
//
// 用法：
//   node tests/reserve-dispersion-v11.js [json 路径]
//   默认 docs/candidate-final-all30.json（基线引擎 d2f9296d）

const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2] || path.join(__dirname, '..', 'docs', 'candidate-final-all30.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const races = data.samples.filter(s => s.kind === 'race');

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const cv = a => sd(a) / mean(a);
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pearson = (x, y) => {
  const n = Math.min(x.length, y.length); if (n < 3) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return sx && sy ? sxy / Math.sqrt(sx * sy) : NaN;
};

// 从 trace 求某匹马 reserve 首次跌破阈值时的【剩余距离】
function crossingDistanceToGo(trace, id, thresh, length) {
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1].horses.find(h => h.id === id), b = trace[i].horses.find(h => h.id === id);
    if (!a || !b) continue;
    if (a.reserve >= thresh && b.reserve < thresh) {
      const f = (thresh - a.reserve) / (b.reserve - a.reserve);
      const s = a.s + f * (b.s - a.s);
      return length - s;
    }
  }
  return null;
}

const rows = [];
for (const r of races) {
  const horses = r.horses || [];
  const fin = horses.filter(h => h.time !== undefined && h.time !== null && !h.dnf);
  if (fin.length < 4) continue;
  const P = new Map((r.parameters || []).map(p => [p.id, p]));   // maxV/capacity 在 parameters 里
  const times = fin.map(h => h.time);
  const maxVs = fin.map(h => P.get(h.id)?.maxV).filter(Number.isFinite);
  const caps = fin.map(h => P.get(h.id)?.capacity).filter(Number.isFinite);
  const finalRes = fin.map(h => h.reserve).filter(Number.isFinite);
  const winner = Math.min(...times);
  const tail = Math.max(...times) - winner;
  const within1 = times.filter(t => t - winner <= 1 + 1e-9).length / times.length;

  // 每匹马 reserve 跌破 0.5 / 1/3 时的剩余距离
  const d50 = [], d33 = [];
  for (const h of fin) {
    const a = crossingDistanceToGo(r.trace || [], h.id, 0.5, r.length); if (a !== null && Number.isFinite(a)) d50.push(a);
    const b = crossingDistanceToGo(r.trace || [], h.id, 1 / 3, r.length); if (b !== null && Number.isFinite(b)) d33.push(b);
  }

  // 能力 vs 成绩：相关系数与"放大倍数"
  const pairs = fin.filter(h => Number.isFinite(P.get(h.id)?.maxV));
  const rho = pearson(pairs.map(h => P.get(h.id).maxV), pairs.map(h => h.time));
  const cvT = cv(times), cvV = cv(maxVs);

  rows.push({
    id: r.id, length: r.length, n: fin.length, winner,
    tail, within1, within2: r.within2,
    cvTime: cvT, cvMaxV: cvV, amp: cvT / cvV,
    rho,
    capMean: mean(caps), capPerM: mean(caps) / r.length, capCv: cv(caps),
    resMean: mean(finalRes), resSd: sd(finalRes), resCv: cv(finalRes),
    d50: d50.length ? { mean: mean(d50), sd: sd(d50), cv: cv(d50) } : null,
    d33: d33.length ? { mean: mean(d33), sd: sd(d33), cv: cv(d33) } : null,
  });
}

console.log(`来源：${path.basename(file)}   引擎 ${(data.protocol.engineNormalizedSha256 || '').slice(0, 8)}   比赛数 ${rows.length}`);
console.log('');
console.log('=== 逐场（长距离优先）===');
console.log('    id      距离  匹数   首末差   within1   完赛CV   maxV-CV  放大倍  maxV~用时ρ   储备容量/米    跌破0.5剩余距离');
for (const r of [...rows].sort((a, b) => b.length - a.length)) {
  const f = (x, d = 3) => Number.isFinite(x) ? x.toFixed(d) : ' n/a';
  console.log(
    '  ' + r.id.padEnd(8) + String(r.length).padStart(5) + String(r.n).padStart(5) +
    f(r.tail, 2).padStart(9) + (r.within1 * 100).toFixed(1).padStart(8) + '%' +
    f(r.cvTime, 4).padStart(9) + f(r.cvMaxV, 4).padStart(9) + f(r.amp, 2).padStart(7) +
    f(r.rho, 2).padStart(12) + f(r.capPerM, 2).padStart(13) +
    (r.d50 ? ('  ' + f(r.d50.mean, 0) + 'm±' + f(r.d50.sd, 0) + ' (' + (r.d50.mean / r.length * 100).toFixed(0) + '%全程)') : '  n/a').padStart(24)
  );
}

console.log('');
console.log('=== 汇总（30 场中位）===');
const agg = k => med(rows.map(r => r[k]).filter(Number.isFinite));
const aggD = (k, sub) => med(rows.map(r => r[k] && r[k][sub]).filter(Number.isFinite));
console.log('  首末完赛差（中位）        ' + agg('tail').toFixed(2) + ' s      [现实 4.190]');
console.log('  冠军后 1s 内比例（中位）   ' + (agg('within1') * 100).toFixed(1) + '%      [现实 58.87%]');
console.log('  完赛时间 CV（中位）        ' + agg('cvTime').toFixed(4));
console.log('  maxV 的 CV（中位）         ' + agg('cvMaxV').toFixed(4));
console.log('  ★ 放大倍数 = 完赛CV/maxVCV ' + agg('amp').toFixed(2));
console.log('  maxV 与完赛用时 相关系数   ' + agg('rho').toFixed(3) + '   (负=更快者用时更短)');
console.log('  终局储备比例 均值 / SD     ' + agg('resMean').toFixed(3) + ' / ' + agg('resSd').toFixed(3) + '   (均值≈0.05 ⇒ 真实赛事里马确实榨干了)');
console.log('  储备容量 / 赛程长度        ' + agg('capPerM').toFixed(2) + '   (若近似常数 ⇒ 容量随赛程等比放大)');
console.log('  储备容量 CV（场间）        ' + agg('capCv').toFixed(4));
console.log('  ★ 跌破 0.5 时的剩余距离    ' + aggD('d50', 'mean').toFixed(0) + ' m ± ' + aggD('d50', 'sd').toFixed(0) +
  '（全场中位）');
console.log('    跌破 1/3 时的剩余距离    ' + aggD('d33', 'mean').toFixed(0) + ' m ± ' + aggD('d33', 'sd').toFixed(0));
console.log('');
console.log('  按赛程分组的"跌破 0.5 剩余距离"（看它随长度怎么变）：');
for (const L of [1200, 1600, 2000, 2400, 3000, 3200]) {
  const g = rows.filter(r => r.length === L && r.d50);
  if (!g.length) continue;
  console.log('    ' + String(L).padStart(4) + 'm : ' + g.length + ' 场   剩余 ' +
    mean(g.map(r => r.d50.mean)).toFixed(0) + ' m（占全程 ' +
    (mean(g.map(r => r.d50.mean)) / L * 100).toFixed(0) + '%）' +
    '   首末差 ' + mean(g.map(r => r.tail)).toFixed(2) + 's' +
    '   within1 ' + (mean(g.map(r => r.within1)) * 100).toFixed(1) + '%');
}
