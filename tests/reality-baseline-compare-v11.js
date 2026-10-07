#!/usr/bin/env node
'use strict';
// 把一份 race-validation 批次产物与**现实基准**做完整对照。
//   · 既有 12 项：直接读批次里的 comparisons[].metrics[k].{real,sim}
//    · 扩展项（within0.5 / within3 / 第1-2 时差）：从 samples[].horses 与参考 JSON 各自复算
//    · 输出三层：总览（30 场等权）/ 按距离（每距离 5 场）/ 按分区
//
// 用法：node tests/reality-baseline-compare-v11.js <batch.json>
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const REAL_FILES = [
  'docs/current-engine-reality-sources-2026-10-02.json',
  'docs/system-external-reference-2022.json',
  'tests/fixtures/race-validation-reference-2020-v11.json',
];
const METRICS = ['winnerTime', 'winnerFinal600', 'first200', 'first400', 'first600', 'remainingSpeed',
  'tailSeconds', 'within1', 'within2', 'final600Span', 'post200Cv', 'last200Difference'];
const ZH = {
  winnerTime: '冠军完赛时间', winnerFinal600: '冠军个人末600m', first200: '起步200m', first400: '首400m',
  first600: '首600m', remainingSpeed: '200m后速度代理', tailSeconds: '首末完赛差',
  within1: '冠军后1s内比例', within2: '冠军后2s内比例', final600Span: '全场末600m极差',
  post200Cv: '首200m后分段CV', last200Difference: '最后200m减前200m',
  gap12: '第1-第2 时差', w05: '冠军后0.5s内比例', w3: '冠军后3s内比例', winnerTimeRaw: '冠军用时(复算)',
};
const PCT = new Set(['within1', 'within2', 'post200Cv', 'w05', 'w3']);
const EXT = ['gap12', 'w05', 'w3', 'winnerTimeRaw'];
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const med = a => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const fmt = (k, v) => !Number.isFinite(v) ? '   n/a' : (PCT.has(k) ? (v * 100).toFixed(2) + '%' : v.toFixed(3));

function readMaybeGz(p) {
  const b = fs.readFileSync(p);
  if (b[0] === 0x1f && b[1] === 0x8b) return require('node:zlib').gunzipSync(b).toString('utf8');
  return b.toString('utf8');
}
const batch = JSON.parse(readMaybeGz(path.resolve(process.argv[2])));

// ---------- 现实侧：复算扩展项（与 race-validation references() 同一取数口径） ----------
function cv(a) { if (!a.length) return null; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) / m; }
const realById = new Map();
for (const f of REAL_FILES) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const r of j.races) {
    const fin = r.horses.filter(h => Number.isFinite(h.finishTime)).sort((a, b) => a.finishTime - b.finishTime);
    const w = fin[0], n = fin.length;
    const within = k => fin.filter(h => h.finishTime - w.finishTime <= k + 1e-9).length / n;
    realById.set(r.id, {
      id: r.id, length: r.length, n,
      winnerTimeRaw: w.finishTime,
      gap12: fin.length > 1 ? fin[1].finishTime - w.finishTime : NaN,
      w05: within(0.5), w3: within(3),
    });
  }
}

// ---------- 引擎侧：从 samples[].horses 复算同一批扩展项 ----------
const simById = new Map();
for (const s of batch.samples || []) {
  if (s.kind !== 'race') continue;
  const fin = (s.horses || []).filter(h => Number.isFinite(h.time)).sort((a, b) => a.time - b.time);
  if (fin.length < 2) { simById.set(s.id, { id: s.id, length: s.length, n: fin.length }); continue; }
  const w = fin[0], n = fin.length;
  const within = k => fin.filter(h => h.time - w.time <= k + 1e-9).length / n;
  simById.set(s.id, {
    id: s.id, length: s.length, n,
    winnerTimeRaw: w.time,
    gap12: fin[1].time - w.time,
    w05: within(0.5), w3: within(3),
  });
}

// ---------- 合并 ----------
const rows = [];
for (const c of batch.comparisons || []) {
  const R = realById.get(c.id), S = simById.get(c.id);
  if (!R || !S) continue;
  const rec = { id: c.id, partition: c.partition, length: c.length, n: R.n ||
    (batch.samples.find(x => x.kind === 'race' && x.id === c.id) || {}).n };
  for (const k of METRICS) { rec[k] = { real: c.metrics[k].real, sim: c.metrics[k].sim }; }
  for (const k of EXT) { rec[k] = { real: R[k], sim: S[k] }; }
  rows.push(rec);
}

const KEYS = [...METRICS, ...EXT];
const agg = (list, k) => ({ real: mean(list.map(r => r[k].real)), sim: mean(list.map(r => r[k].sim)) });
function line(label, list, k, width) {
  const a = agg(list, k);
  const bias = a.sim - a.real;
  const rel = a.real === 0 ? NaN : (a.sim / a.real - 1);
  const err = Number.isFinite(rel) ? (rel * 100).toFixed(2).padStart(7) + '%' : '    n/a';
  console.log('  ' + (ZH[k] || k).padEnd(width) + fmt(k, a.real).padStart(11) + fmt(k, a.sim).padStart(11) +
    (Number.isFinite(bias) ? bias.toFixed(3).padStart(10) : '       n/a') + err);
}

console.log('批次: ' + path.basename(process.argv[2]));
console.log('引擎: ' + String(batch.protocol?.engineNormalizedSha256 || '').slice(0, 16) +
  '   scope=' + batch.protocol?.scope + '  workers=' + batch.execution?.workers +
  '  墙钟=' + Math.round(batch.execution?.wallSeconds || 0) + 's');
console.log('完整性: ' + JSON.stringify({ complete: batch.integrity?.complete, passedEngineering: batch.integrity?.passedEngineering, errors: (batch.errors || []).length }));
console.log('');

console.log('=== 一、总览（' + rows.length + ' 场真实赛事等权平均）===');
console.log('  ' + '指标'.padEnd(16) + '现实'.padStart(11) + '引擎'.padStart(11) + '偏差(引擎-现实)'.padStart(18) + '相对'.padStart(9));
for (const k of KEYS) line('all', rows, k, 16);

const DISTS = [...new Set(rows.map(r => r.length))].sort((a, b) => a - b);
console.log('');
console.log('=== 二、按距离（每距离 ' + (rows.length / DISTS.length) + ' 场）===');
for (const k of ['winnerTime', 'first200', 'first600', 'winnerFinal600', 'tailSeconds', 'within1', 'within2', 'gap12', 'w05', 'w3']) {
  console.log('  -- ' + (ZH[k] || k));
  for (const L of DISTS) {
    const list = rows.filter(r => r.length === L);
    const a = agg(list, k);
    const rel = a.real === 0 ? NaN : (a.sim / a.real - 1);
    console.log('    ' + (L + 'm').padEnd(7) + fmt(k, a.real).padStart(10) + fmt(k, a.sim).padStart(10) +
      (Number.isFinite(rel) ? (rel * 100).toFixed(1).padStart(8) + '%' : '     n/a'));
  }
}

console.log('');
console.log('=== 三、按分区（带符号偏差 = 引擎 − 现实）===');
for (const P of [...new Set(rows.map(r => r.partition))]) {
  const list = rows.filter(r => r.partition === P);
  console.log('  -- ' + P + '（' + list.length + ' 场）');
  for (const k of ['winnerTime', 'first200', 'first600', 'tailSeconds', 'within1', 'within2', 'final600Span', 'gap12']) {
    const a = agg(list, k);
    const bias = a.sim - a.real, rel = a.real === 0 ? NaN : (a.sim / a.real - 1);
    console.log('     ' + (ZH[k] || k).padEnd(16) + fmt(k, a.real).padStart(10) + fmt(k, a.sim).padStart(10) +
      (Number.isFinite(bias) ? bias.toFixed(3).padStart(10) : '       n/a') +
      (Number.isFinite(rel) ? (rel * 100).toFixed(1).padStart(8) + '%' : '     n/a'));
  }
}

console.log('');
console.log('=== 四、门限判定（沿用脚本：冠军时 5% / 冠军末600 10% / 首马600 10% / 首马200 10%）===');
const gates = {
  winnerTime: 0.05, winnerFinal600: 0.10, first600: 0.10, first200: 0.10,
};
let allPass = true;
for (const [k, tol] of Object.entries(gates)) {
  const rels = rows.map(r => r[k].sim / r[k].real - 1);
  const m = med(rels.map(Math.abs));
  const pass = m <= tol;
  if (!pass) allPass = false;
  console.log('  ' + (ZH[k] || k).padEnd(18) + '中位|相对| ' + (m * 100).toFixed(2).padStart(6) + '%   门槛 ' + (tol * 100) + '%   ' + (pass ? '✅' : '❌'));
}
console.log('  ⇒ ' + (allPass ? '四项全过' : '存在未过项'));

console.log('');
console.log('=== 五、逐场（便于定位异常）===');
console.log('  ' + 'id'.padEnd(9) + '距离'.padStart(6) + ' n' + '现实冠军'.padStart(10) + '引擎冠军'.padStart(10) + '现实w1'.padStart(9) + '引擎w1'.padStart(9) + '现实tail'.padStart(10) + '引擎tail'.padStart(10));
for (const r of rows.sort((a, b) => a.length - b.length || a.id.localeCompare(b.id))) {
  console.log('  ' + String(r.id).padEnd(9) + String(r.length).padStart(6) + String(r.n).padStart(3) +
    r.winnerTime.real.toFixed(1).padStart(10) + r.winnerTime.sim.toFixed(1).padStart(10) +
    (100 * r.within1.real).toFixed(1).padStart(8) + '%' + (100 * r.within1.sim).toFixed(1).padStart(8) + '%' +
    r.tailSeconds.real.toFixed(1).padStart(10) + r.tailSeconds.sim.toFixed(1).padStart(10));
}
