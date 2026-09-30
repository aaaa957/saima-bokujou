#!/usr/bin/env node
/* ============================================================
 * 四种跑法的胜率 × 距离扫描
 * ------------------------------------------------------------
 * 隔离变量：8 匹马只有跑法不同、属性与随机种子完全一致
 * （4 种跑法各 2 匹），因此胜率差异只归因于跑法。
 * 理想值是每种跑法 25%。
 *
 * 用法：node tests/style-by-distance.js [每种跑法场次] [档位]
 * ============================================================ */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const PER = Number(process.argv[2]) || 60;
const COEF = process.argv[3] || 'balanced';
const STYLES = ['逃', '先', '差', '追'];
const DISTS = [1200, 1600, 2000, 2400, 3000];

const rule = () => console.log('─'.repeat(74));

function run(length, n) {
  const win = { '逃': 0, '先': 0, '差': 0, '追': 0 };
  let fin = 0;
  for (let t = 0; t < n; t++) {
    const seed = 20260101 + t * 7919;
    const rng = S.mulberry32(seed);
    const field = [];
    /* 属性完全同源：用同一个种子造一匹基准马，8 匹共享其属性 */
    const proto = S.makeHorse(S.mulberry32(seed + 4242), { style: '先', level: 70, id: 'p' });
    for (let i = 0; i < 8; i++) {
      const h = S.makeHorse(S.mulberry32(seed + 4242), { style: STYLES[i % 4], level: 70, id: 'h' + i });
      Object.assign(h.stats, JSON.parse(JSON.stringify(proto.stats)));
      field.push(h);
    }
    const rc = S.createRace(field, {
      length, surface: '草地', state: '良', profile: '缓坂',
      styleCoefs: COEF, rng: S.mulberry32((seed * 31 + 7) >>> 0),
    });
    let g = 0;
    while (!rc.race.finished && g++ < 400000) rc.step(1 / 30);
    const w = rc.race.order[0];
    if (w) { win[w.style]++; fin++; }
  }
  return { win, fin };
}

console.log('');
console.log('四种跑法胜率 × 距离（隔离变量：属性完全相同，仅跑法不同）');
rule();
console.log('系数档位：' + COEF + '　每档 ' + PER + ' 场　理想值 每种跑法 25%');
console.log('');
console.log('距离     逃       先       差       追      极差');
DISTS.forEach((L) => {
  const { win, fin } = run(L, PER);
  const p = STYLES.map((s) => win[s] / fin * 100);
  const spread = Math.max.apply(null, p) - Math.min.apply(null, p);
  console.log('  ' + String(L).padStart(4) + 'm  ' +
    p.map((x) => (x.toFixed(1) + '%').padStart(7)).join('  ') +
    '  ' + (spread.toFixed(1) + '%').padStart(7) +
    (spread > 40 ? '  ❌' : spread > 25 ? '  ⚠️' : '  ✅'));
});
console.log('');
rule();
console.log('判读：极差 ≤25% 算平衡；>40% 说明某跑法在当前公式下几乎无法取胜');
console.log('');
