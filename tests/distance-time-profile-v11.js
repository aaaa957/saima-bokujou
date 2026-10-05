const A = require('../docs/candidate-final-all30.json');        // 基线：旧引擎 + 旧阵容生成
const B = require('../docs/candidate-specialization-v11.json'); // 本次：新引擎 + 修好的阵容生成
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const LS = [1200, 1600, 2000, 2400, 3000, 3200];
const races = d => d.samples.filter(s => s.kind === 'race');

console.log('=== 阵容是否变了？（同距离参赛马能力）===');
console.log('距离   批次  匹数  base均值  maxV均值  aerobic均值  capacity均值');
for (const L of LS) {
  for (const [tag, d] of [['基线', A], ['本次', B]]) {
    const P = races(d).filter(s => s.length === L).flatMap(s => s.parameters || []);
    if (!P.length) { console.log(String(L).padStart(5) + 'm  ' + tag + '  (无样本)'); continue; }
    const m = k => { const a = P.map(p => p[k]).filter(Number.isFinite); return a.length ? mean(a) : NaN; };
    console.log(String(L).padStart(5) + 'm  ' + tag + '  ' + String(P.length).padStart(4) +
      '  ' + m('base').toFixed(2).padStart(8) + '  ' + m('maxV').toFixed(3).padStart(8) +
      '  ' + m('aerobic').toFixed(2).padStart(11) + '  ' + m('capacity').toFixed(0).padStart(12));
  }
}

console.log('\n=== 完赛时间（同距离，逐场均值）===');
console.log('距离   基线冠军   本次冠军    差');
for (const L of LS) {
  const a = races(A).filter(s => s.length === L).map(s => s.winnerTime).filter(Number.isFinite);
  const b = races(B).filter(s => s.length === L).map(s => s.winnerTime).filter(Number.isFinite);
  if (!a.length || !b.length) { console.log(String(L).padStart(5) + 'm  (无双批次样本)'); continue; }
  console.log(String(L).padStart(5) + 'm  ' + mean(a).toFixed(2).padStart(8) + '  ' + mean(b).toFixed(2).padStart(8) +
    '  ' + (((mean(b) / mean(a) - 1) * 100).toFixed(1) + '%').padStart(8));
}

console.log('\n=== 现实参照（同距离）===');
for (const L of LS) {
  const r = races(B).filter(s => s.length === L).map(s => s.comparisons ? null : s).filter(Boolean);
  const real = B.comparisons.filter(c => c.length === L).map(c => c.metrics.winnerTime.real).filter(Number.isFinite);
  const sim = B.comparisons.filter(c => c.length === L).map(c => c.metrics.winnerTime.sim).filter(Number.isFinite);
  if (!real.length) { console.log(String(L).padStart(5) + 'm  (无)'); continue; }
  console.log(String(L).padStart(5) + 'm  现实 ' + mean(real).toFixed(2) + '   模拟 ' + mean(sim).toFixed(2) +
    '   偏差 ' + (((mean(sim) / mean(real) - 1) * 100).toFixed(1) + '%'));
}
