#!/usr/bin/env node
'use strict';
// 储备消耗机制探针（只读诊断）：固定配速下，储备耗尽点随赛程怎么移动？
//
// 目的：区分两种模型
//   (A) 绝对存量型：储备按【超出有氧的功率】消耗 ⇒ 耗尽点应在【近似固定的绝对距离】
//   (B) 预算平摊型：骑手把预算摊到余程上 ⇒ 耗尽点应在【全程的固定比例】
//
// 做法：绕开骑手（h.control 固定 targetV），只留能量系统在动。
//
// 用法：node tests/reserve-consumption-probe-v11.js [速度 m/s ...]

const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));
const DT = 1 / 30;

function field(n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = S.makeHorse(rng, { level: 86, id: 'h' + i, player: false });
    h.name = 'h' + i;
    out.push(h);
  }
  return out;
}

function run(length, targetV, n = 8) {
  const rng = S.mulberry32(20261005);
  const r = S.createRace(field(n, rng), { length, profile: '平坦', surface: '草地', state: '良', rng: S.mulberry32(7) });
  for (const h of r.race.horses) h.control = { targetV };
  const series = r.race.horses.map(() => []);
  let guard = 0;
  while (!r.race.finished && guard++ < 400000) {
    r.step(DT);
    for (const h of r.race.horses) if (!h.place) series[r.race.horses.indexOf(h)].push({ s: h.s, reserve: h.stamina / h.staminaMax });
  }
  return { length, series, t: r.race.t };
}

function crossDist(ser, th, length) {
  for (let i = 1; i < ser.length; i++) {
    const a = ser[i - 1], b = ser[i];
    if (a.reserve >= th && b.reserve < th) {
      const f = (th - a.reserve) / (b.reserve - a.reserve);
      const s = a.s + f * (b.s - a.s);
      return length - s;
    }
  }
  return null;
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;

const speeds = process.argv.slice(2).map(Number).filter(Number.isFinite);
const V = speeds.length ? speeds : null;

console.log('=== 固定配速下，储备耗尽点随赛程如何移动 ===');
console.log('（绕开骑手，h.control 固定 targetV，只看能量系统）\n');

for (const length of [1200, 1600, 2000, 2400, 3200]) {
  // 用同一个绝对速度跑所有距离
  const targetV = V ? V[0] : 16.0;
  const r = run(length, targetV);
  const d50 = [], d33 = [], fin = [];
  for (const ser of r.series) {
    if (ser.length < 10) continue;
    const a = crossDist(ser, 0.5, length); if (Number.isFinite(a)) d50.push(a);
    const b = crossDist(ser, 1 / 3, length); if (Number.isFinite(b)) d33.push(b);
    fin.push(ser[ser.length - 1].reserve);
  }
  const f = x => Number.isFinite(x) ? x.toFixed(0) : '  —';
  console.log(
    String(length).padStart(5) + 'm  v=' + targetV.toFixed(1) + 'm/s  完赛 t=' + r.t.toFixed(1) + 's' +
    '  跌破0.5剩余=' + f(mean(d50)).padStart(5) + 'm (' + (Number.isFinite(mean(d50)) ? (mean(d50) / length * 100).toFixed(0) : '—') + '%全程)' +
    '  跌破1/3剩余=' + f(mean(d33)).padStart(5) + 'm' +
    '  终局储备=' + (mean(fin) * 100).toFixed(0) + '%'
  );
}

console.log('\n=== 判读 ===');
console.log('  若"跌破0.5剩余距离"跨距离近似【常数】 ⇒ 绝对存量型（符合现实，Spence 478±220m）');
console.log('  若它随赛程等比放大（占比恒定）      ⇒ 预算平摊型（当前的病灶）');
