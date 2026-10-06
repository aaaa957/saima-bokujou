// 12 项现实残差对照：把若干份批次 JSON 并排比。
// 用法：node tests/realism-comparison-v11.js <baseline.json> <cand1.json> [cand2.json ...]
// 只读批次产物，不跑仿真。
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('用法: node tests/realism-comparison-v11.js <baseline.json> <cand1.json> [cand2.json ...]');
  process.exit(1);
}
const load = p => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
const files = args.map(load);
const names = args.map(p => path.basename(p).replace(/\.json$/, '').replace(/^candidate-/, ''));

const M = ['winnerTime', 'winnerFinal600', 'first200', 'first400', 'first600', 'remainingSpeed',
  'tailSeconds', 'within1', 'within2', 'final600Span', 'post200Cv', 'last200Difference'];
const ZH = {
  winnerTime: '冠军完赛时间', winnerFinal600: '冠军个人末600m', first200: '起步200m',
  first400: '首400m', first600: '首600m', remainingSpeed: '200m后速度代理',
  tailSeconds: '首末完赛差', within1: '冠军后1s内比例', within2: '冠军后2s内比例',
  final600Span: '全场末600m极差', post200Cv: '首200m后分段CV', last200Difference: '最后200m减前200m',
};
const PCT = new Set(['within1', 'within2', 'post200Cv']);
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const fmt = (m, v) => !Number.isFinite(v) ? 'n/a' : (PCT.has(m) ? (v * 100).toFixed(2) + '%' : v.toFixed(3));

// 逐场配对：以 baseline 的 id 为键
const byId = d => new Map((d.comparisons || []).map(c => [c.id, c]));
const base = byId(files[0]);
const cands = files.slice(1).map(byId);

console.log('=== 12 项现实残差对照 ===');
console.log('基线: ' + names[0] + (files[0].protocol ? ' (引擎 ' + String(files[0].protocol.engineNormalizedSha256 || '').slice(0, 8) + ')' : ''));
for (let i = 1; i < files.length; i++)
  console.log('对照: ' + names[i] + (files[i].protocol ? ' (引擎 ' + String(files[i].protocol.engineNormalizedSha256 || '').slice(0, 8) + ')' : ''));
console.log('');

const header = ['指标', '现实'];
for (const n of names) header.push(n);
header.push('判定(最后一列 vs 基线)');
console.log(header.map((h, i) => i === 0 ? h.padEnd(18) : h.padStart(14)).join(''));

for (const m of M) {
  const row = [];
  let real = null;
  const sims = [], rels = [];
  for (let i = 0; i < files.length; i++) {
    const R = [], S = [], E = [];
    for (const [id, cb] of base) {
      const cc = i === 0 ? cb : cands[i - 1].get(id);
      if (!cc) continue;
      const x = cc.metrics && cc.metrics[m];
      if (!x || x.real == null || x.sim == null) continue;
      R.push(x.real); S.push(x.sim); E.push(Math.abs(x.relativeError));
    }
    if (i === 0 && R.length) real = mean(R);
    sims.push(mean(S));
    rels.push(med(E));
  }
  row.push(ZH[m].padEnd(18));
  row.push(fmt(m, real).padStart(14));
  for (const s of sims) row.push(fmt(m, s).padStart(14));
  // 判定：用中位相对误差比较最后一列 vs 基线
  const a = rels[0], b = rels[rels.length - 1];
  let verdict = '';
  if (Number.isFinite(a) && Number.isFinite(b)) {
    if (b < a * 0.97) verdict = '更好';
    else if (b > a * 1.03) verdict = '更差';
    else verdict = '持平';
  }
  row.push('  ' + verdict);
  console.log(row.join(''));
}
console.log('');
console.log('|相对误差| 中位（越低越好）');
console.log(['指标', ...names].map((h, i) => i === 0 ? h.padEnd(18) : h.padStart(14)).join(''));
for (const m of M) {
  const row = [ZH[m].padEnd(18)];
  for (let i = 0; i < files.length; i++) {
    const E = [];
    for (const [id, cb] of base) {
      const cc = i === 0 ? cb : cands[i - 1].get(id);
      if (!cc) continue;
      const x = cc.metrics && cc.metrics[m];
      if (!x || x.real == null || x.sim == null) continue;
      E.push(Math.abs(x.relativeError));
    }
    const v = med(E);
    row.push((PCT.has(m) ? (v * 100).toFixed(2) + '%' : v.toFixed(4)).padStart(14));
  }
  console.log(row.join(''));
}

// 分区
for (let i = 0; i < files.length; i++) {
  const parts = files[i].realismByPartition;
  if (!Array.isArray(parts) || !parts.length) continue;
  console.log('');
  console.log('=== 分区（' + names[i] + '）===');
  for (const p of parts) {
    const k = p.partition || p.name || p.id || '?';
    const bits = Object.entries(p).filter(([kk, vv]) => typeof vv === 'number' && !['n', 'count'].includes(kk));
    console.log('  ' + String(k).padEnd(16) + bits.map(([kk, vv]) =>
      kk + '=' + (Math.abs(vv) < 1 && vv !== 0 ? (vv * 100).toFixed(1) + '%' : vv.toFixed(3))).slice(0, 6).join('  '));
  }
}

// 完整性
console.log('');
console.log('=== 完整性 ===');
for (let i = 0; i < files.length; i++) {
  const d = files[i], it = d.integrity || {};
  console.log('  ' + names[i].padEnd(24) +
    'samples=' + (d.samples ? d.samples.length : '?') + '/' + (d.protocol ? d.protocol.jobs.length : '?') +
    '  errors=' + (d.errors ? d.errors.length : '?') +
    '  passedEng=' + it.passedEngineering +
    '  wall=' + (d.execution && d.execution.wallSeconds ? d.execution.wallSeconds.toFixed(0) + 's' : '?'));
}
