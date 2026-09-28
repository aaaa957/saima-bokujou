#!/usr/bin/env node
/* ============================================================
 * 属性敏感度体检：每个属性单独 +20，看它对胜率的真实影响
 * ------------------------------------------------------------
 * 用途：验证"马匹能力由多个属性共同构成"是否成立。
 * 公平竞争时 8 匹马的基准胜率约 12.5%；若某属性 +20 后胜率飙升到 90%，
 * 说明该属性一票决定胜负，其它属性形同虚设。
 *
 * 期望（每个属性都该有存在感，速度可以最强但不能独裁）：
 *   速度    +12 ~ +22 个百分点
 *   爆发力  +8  ~ +16
 *   耐力    +6  ~ +14   （2000m）
 *   出闸能力 +4 ~ +12
 *   毅力/力量/体格  +2 ~ +8
 *
 * 用法：node tests/attribute-impact.js [每个属性的试验场次]
 * ============================================================ */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const N = Number(process.argv[2]) || 200;
const BASE = 70;
const BUMP = 20;
const STYLES = ['先', '差'];

function buildField(seed, makeStats, style) {
  const fld = [];
  for (let i = 0; i < 8; i++) {
    const h = S.makeHorse(S.mulberry32(seed + i * 977), { style, level: BASE, id: 'h' + i });
    Object.assign(h.stats, makeStats(i, h));
    fld.push(h);
  }
  return fld;
}
function runField(fld, seed, opts) {
  const rc = S.createRace(fld, Object.assign({
    length: 2000, surface: '草地', state: '良', profile: '缓坂',
    styleCoefs: 'balanced', rng: S.mulberry32(seed >>> 0),
  }, opts || {}));
  let g = 0;
  while (!rc.race.finished && g++ < 300000) rc.step(1 / 30);
  return rc.race.order[0];
}

/* 统一的基准属性表：8 匹马完全相同，只有第 0 匹加一项。
   注意 bumpKey 只在 i===0 时应用——早期版本误让 8 匹全部加成，
   等于"大家都快 20 点"，测出来自然全是 0。 */
const FLAT = { '速度': BASE, '爆发力': BASE, '耐力': BASE, '出闸能力': BASE,
               '力量': BASE, '毅力': BASE, '智力': BASE, '体格': BASE, '血统力': 50 };

function measure(bumpKey, style) {
  let win0 = 0, fin = 0;
  for (let t = 0; t < N; t++) {
    const seed = 424242 + t * 104729;
    const fld = [];
    for (let i = 0; i < 8; i++) {
      const h = S.makeHorse(S.mulberry32(seed + i * 977), { style, level: BASE, id: 'h' + i });
      const s = Object.assign({}, FLAT);
      if (bumpKey && i === 0) s[bumpKey] = BASE + BUMP;
      Object.assign(h.stats, s);
      fld.push(h);
    }
    const w = runField(fld, seed * 31 + 7, {});
    if (w) { fin++; if (w.id === 'h0') win0++; }
  }
  return { rate: fin ? win0 / fin : NaN, fin };
}

const rule = () => console.log('─'.repeat(68));
console.log('');
console.log('属性敏感度体检：单项 +' + BUMP + '（基准 ' + BASE + '）对胜率的影响');
rule();
console.log('每个属性 ' + N + ' 场；8 匹公平竞争的理论基准胜率 = 12.5%');
console.log('');

for (const style of STYLES) {
  console.log('【跑法 ' + style + '】');
  const base = measure(null, style);
  console.log('  基准（全 8 匹完全相同）胜率 = ' + (base.rate * 100).toFixed(1) + '%');
  console.log('  ' + '属性'.padEnd(8) + '胜率     相对基准');
  const rows = [];
  for (const k of ['速度', '爆发力', '耐力', '出闸能力', '毅力', '力量', '体格']) {
    const r = measure(k, style);
    const d = (r.rate - base.rate) * 100;
    rows.push({ k, rate: r.rate, d });
    console.log('  ' + k.padEnd(8) + (r.rate * 100).toFixed(1).padStart(5) + '%   ' +
      (d >= 0 ? '+' : '') + d.toFixed(1).padStart(5) + ' 个百分点');
  }
  const mx = Math.max.apply(null, rows.map((x) => x.d));
  const mn = Math.min.apply(null, rows.map((x) => x.d));
  console.log('  → 最强属性 +' + mx.toFixed(1) + '，最弱 +' + mn.toFixed(1) +
    '，落差 ' + (mx - mn).toFixed(1) + ' 个百分点');
  if (mx - mn > 40) console.log('     ⚠️ 落差过大：有属性在"独裁"，其余形同虚设');
  else if (mx - mn > 25) console.log('     ⚠️ 落差偏大，仍可优化');
  else console.log('     ✅ 属性之间比较均衡');
  console.log('');
}

rule();
console.log('说明');
rule();
console.log('  · 若全部属性影响都接近 0，说明该跑法/距离下属性没被引擎用上');
console.log('  · 速度天生应该最强（它作用于全程），但不该到"一票决定"的程度');
console.log('  · 耐力在长距离（2400m+）应显著上升，可用 --long 参数验证');
console.log('');
