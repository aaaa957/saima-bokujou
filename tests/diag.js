#!/usr/bin/env node
/* 诊断探针：拆解"跑法胜率失衡"的来源
 * 1) 四种跑法的属性模板对比（谁天生强）
 * 2) 关闭 tier 强马加成后的胜率（排除强马落点干扰）
 * 3) 各跑法在不同阶段的系数对比
 */
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const DT = 1 / 30, MAX_STEPS = 300000;

/* ── 1) 属性模板对比 ── */
// 复刻 sim.js 的 makeHorse 中位形态：shaped = mid（roll 取中值）
// 直接引用引擎内的权威定义，避免手工抄错
const RANGES = {
  '逃': { '速度': [70, 92], '耐力': [68, 90], '出闸能力': [65, 92], '爆发力': [40, 70], '力量': [45, 75], '毅力': [45, 75], '智力': [40, 80], '体格': [45, 85] },
  '先': { '速度': [62, 88], '耐力': [55, 80], '出闸能力': [55, 85], '爆发力': [55, 80], '力量': [50, 80], '毅力': [55, 85], '智力': [50, 85], '体格': [45, 80] },
  '差': { '速度': [60, 88], '耐力': [50, 75], '出闸能力': [45, 75], '爆发力': [70, 92], '力量': [55, 85], '毅力': [55, 85], '智力': [50, 85], '体格': [50, 85] },
  '追': { '速度': [62, 90], '耐力': [40, 65], '出闸能力': [35, 65], '爆发力': [75, 95], '力量': [50, 80], '毅力': [65, 95], '智力': [50, 85], '体格': [45, 80] },
};
console.log('\n【诊断 1】四种跑法属性模板的"档位中值"（level=70 时的实际取值）');
console.log('跑法  ' + Object.keys(RANGES['逃']).map(k => k.padEnd(6)).join(''));
for (const st of ['逃', '先', '差', '追']) {
  const row = Object.values(RANGES[st]).map(([lo, hi]) => {
    const mid = (lo + hi) / 2;
    // makeHorse: stats = level + (shaped - 70) * 0.8, shaped=mid
    return String(Math.round(70 + (mid - 70) * 0.8)).padEnd(6);
  });
  console.log(st + '    ' + row.join(''));
}
console.log('（属性越高越强；注意 速度 与 爆发力 的此消彼长）');

/* ── 2) 关闭 tier 加成 & 关闭马群跟跑，看胜率 ── */
function winRates(coefMode, trials, opts) {
  const o = opts || {};
  const win = { 逃: 0, 先: 0, 差: 0, 追: 0 };
  for (let i = 0; i < trials; i++) {
    const seed = 1000 + i * 31;
    const field = S.makeField(S.mulberry32(seed), {
      n: 8, strongIndex: 2, playerIndex: 2, level: 70,
    });
    if (o.flat) for (const h of field) h.stats['血统力'] = 50;
    const r = S.createRace(field, {
      length: 2000, surface: '草地', state: '良', profile: '缓坂',
      styleCoefs: coefMode, rng: S.mulberry32((seed + 7) ^ 0x9e3779b9),
    });
    let g = 0;
    while (!r.race.finished && g++ < MAX_STEPS) r.step(DT);
    const w = r.race.order[0];
    if (w) win[w.style]++;
  }
  const n = trials;
  return Object.keys(win).map(k => k + ' ' + (win[k] / n * 100).toFixed(1) + '%').join('  ');
}

const N = Number(process.argv[2]) || 200;
console.log('\n【诊断 2】胜率对比（' + N + ' 场/档，strongIndex 固定 2）');
console.log('  文档原版      : ' + winRates('doc', N));
console.log('  平衡档        : ' + winRates('balanced', N));

/* ── 3) 把 strongIndex 轮转到每一匹，看强马落点的影响 ── */
console.log('\n【诊断 3】strongIndex 轮转（每档 × 每位置，共 ' + (N * 8) + ' 场）');
for (const mode of ['doc', 'balanced']) {
  const win = { 逃: 0, 先: 0, 差: 0, 追: 0 };
  let total = 0;
  for (let si = 0; si < 8; si++) {
    for (let i = 0; i < N; i++) {
      const seed = 2000 + si * 100000 + i * 31;
      const field = S.makeField(S.mulberry32(seed), { n: 8, strongIndex: si, level: 70 });
      const r = S.createRace(field, {
        length: 2000, surface: '草地', state: '良', profile: '缓坂',
        styleCoefs: mode, rng: S.mulberry32((seed + 7) ^ 0x9e3779b9),
      });
      let g = 0;
      while (!r.race.finished && g++ < MAX_STEPS) r.step(DT);
      const w = r.race.order[0];
      if (w) { win[w.style]++; total++; }
    }
  }
  console.log('  ' + (mode === 'doc' ? '文档原版' : '平衡档  ') + '    : ' +
    Object.keys(win).map(k => k + ' ' + (win[k] / total * 100).toFixed(1) + '%').join('  '));
}
console.log('');
