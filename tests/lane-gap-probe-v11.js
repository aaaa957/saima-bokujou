// 空档测量：变道被允许的前提是「与每个构成跟驰关系的对手纵向拉开 ≈3.4 m」。
// 本探针量：最外侧马与它内侧邻居的纵向间隔随时间的演化，以及它按规则【最多能内移多少】。
// 只读，不改引擎。
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const DT = 1 / 30, N = 14, SEED = 20261005;
const field = [];
for (let i = 0; i < N; i++) field.push(S.makeHorse(S.mulberry32(SEED + i * 7919), {
  id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
  jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
  physiology: S.neutralPhysiology(),
}));
const race = S.createRace(field, { length: 1200, profile: '平坦', rng: S.mulberry32(SEED) });
const H = race.race.horses;
const me = H.reduce((a, b) => a.gate > b.gate ? a : b);        // 最外侧闸位
const lenOf = h => 2.25 + 0.55 * (h.adj['体格'] / 100);
const widOf = h => 0.65 + 0.15 * (h.adj['体格'] / 100);

let g = 0, next = 0;
const rows = [];
while (!race.race.finished && g++ < 600000) {
  race.step(DT);
  if (race.race.t < next) continue;
  next += 2.0;
  // 纵向物理间隔：s 差（同一参考坐标）
  const inner = H.filter(F => F !== me && F.t < me.t).sort((a, b) => b.t - a.t);
  const dS = inner.map(F => F.s - me.s);                       // >0 = 邻居在前
  const clear = inner.map(F => lenOf(me) / 2 + lenOf(F) / 2 + 0.20 + 0.31);  // 跟驰所需纵向余量≈3.4
  // 规则允许的最内侧车道：对每个"纵向间隔小于阈值"的内侧邻居，至少要待在它外侧一个横向间隙之外
  let maxIn = me.t;
  for (let i = 0; i < inner.length; i++) {
    const F = inner[i];
    if (dS[i] > clear[i]) continue;                            // 已拉开足够纵向空档 → 不受限
    const lat = (widOf(me) + widOf(F)) / 2 + 0.10;
    maxIn = Math.min(maxIn, F.t + lat);
  }
  rows.push({ t: race.race.t, at: me.t, maxIn, dS: dS.slice(0, 5), clear: clear[0] });
}
console.log(`最外侧马：闸位 ${me.gate}，起跑车道 ${(1 + 1.286 * (me.gate - 0.5)).toFixed(2)}，参考车道 1.40`);
console.log(' t(s)  本马车道  规则允许的最内侧车道  可内移量   |  与内侧最近5个邻居的纵向间隔（米，>0=在前）  跟驰阈值');
for (const r of rows.slice(0, 16)) {
  console.log(`${r.t.toFixed(1).padStart(5)}  ${r.at.toFixed(2).padStart(8)}  ${r.maxIn.toFixed(2).padStart(18)}  ` +
    `${(r.at - r.maxIn).toFixed(2).padStart(7)}   |  ${r.dS.map(d => d.toFixed(1).padStart(6)).join(' ')}   ${r.clear.toFixed(1)}`);
}
