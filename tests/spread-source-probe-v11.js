// 整场分散来源定位：把完赛时间与【闸位 / 起步延迟 / 被挡时长 / 跟跑时长】做相关，
// 看整场那 5×（1200m）到底由什么驱动。只读，不改引擎。
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const DT = 1 / 30;
const N = Number(process.env.SP_N || 14);
const SEED = Number(process.env.SP_SEED || 20261005);

function makeField(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(S.makeHorse(S.mulberry32(seed + i * 7919), {
    id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
    physiology: S.neutralPhysiology(),
  }));
  return out;
}
function pearson(x, y) {
  const n = Math.min(x.length, y.length); if (n < 3) return NaN;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return (sx && sy) ? sxy / Math.sqrt(sx * sy) : NaN;
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); }

for (const L of [1200, 2000, 3200]) {
  const race = S.createRace(makeField(N, SEED), { length: L, profile: '平坦', rng: S.mulberry32(SEED) });
  let g = 0; while (!race.race.finished && g++ < 600000) race.step(DT);
  const H = race.race.horses.filter(h => h.time !== null && h.time !== undefined).sort((a, b) => a.time - b.time);
  const T = H.map(h => h.time - H[0].time);                 // 相对冠军
  const gate = H.map(h => h.gate);
  const delay = H.map(h => h.startDelay);
  const blocked = H.map(h => h.statsSummary.blockedSeconds || 0);
  const draft = H.map(h => h.statsSummary.draftSeconds || 0);
  const laneJit = H.map(h => h.laneJitter || 0);
  const spd = H.map(h => h.adj['速度']), sta = H.map(h => h.adj['耐力']);
  const lat = H.map(h => h.t);                              // 横向位置

  console.log(`\n=== ${L}m / ${N}匹   冠军 ${H[0].time.toFixed(2)}s   首末差 ${(H[H.length - 1].time - H[0].time).toFixed(2)}s ===`);
  console.log(`  相对冠军(s): ` + T.map(t => t.toFixed(2)).join(', '));
  console.log(`  闸位:       ` + gate.join(', '));
  console.log(`  起步延迟(s): ` + delay.map(d => d.toFixed(3)).join(', '));
  console.log(`  被挡秒数:   ` + blocked.map(b => b.toFixed(1)).join(', '));
  console.log(`  跟跑秒数:   ` + draft.map(b => b.toFixed(1)).join(', '));
  console.log(`  横向位置 t: ` + lat.map(b => b.toFixed(1)).join(', '));
  console.log(`  ---- 与「相对冠军」的相关 ----`);
  console.log(`  闸位 ρ=${pearson(gate, T).toFixed(3)}   起步延迟 ρ=${pearson(delay, T).toFixed(3)}` +
    `   被挡 ρ=${pearson(blocked, T).toFixed(3)}   跟跑 ρ=${pearson(draft, T).toFixed(3)}` +
    `   横向 ρ=${pearson(lat, T).toFixed(3)}`);
  console.log(`  速度 ρ=${pearson(spd, T).toFixed(3)}   耐力 ρ=${pearson(sta, T).toFixed(3)}`);
  console.log(`  离散度：被挡秒 SD=${sd(blocked).toFixed(2)}  起步延迟 SD=${sd(delay).toFixed(3)}  闸位 SD=${sd(gate).toFixed(2)}`);
}
