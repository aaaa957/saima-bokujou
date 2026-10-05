// 横向轨迹：外侧闸位的马到底什么时候回到内栏？如果整场都待在外侧，
// 那 4.5–6.6% 的几何惩罚就会全额兑现。只读，不改引擎。
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const DT = 1 / 30, N = 14, SEED = 20261005;
function makeField(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(S.makeHorse(S.mulberry32(seed + i * 7919), {
    id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
    physiology: S.neutralPhysiology(),
  }));
  return out;
}
for (const L of [1200, 3200]) {
  const r = S.createRace(makeField(N, SEED), { length: L, profile: '平坦', rng: S.mulberry32(SEED) });
  const geo = r.race.geo, W = geo.width || S.TRACK_WIDTH, refLane = geo.referenceLane ?? W / 2;
  const H = r.race.horses;
  const track = H.map(() => []);
  let g = 0, next = 0;
  while (!r.race.finished && g++ < 600000) {
    r.step(DT);
    if (r.race.t >= next) {
      for (let i = 0; i < H.length; i++) track[i].push({ s: H[i].s, t: H[i].t });
      next += Math.max(1, L / 12) / 18;   // 约每 1/12 赛程采一次
    }
  }
  console.log(`\n=== ${L}m  轨道宽 ${W}  参考车道 ${refLane.toFixed(2)} ===`);
  console.log('  闸位 → 沿赛程的横向位置 t（每 1/12 赛程一格）');
  for (let i = 0; i < H.length; i++) {
    const tr = track[i].filter((_, k) => k % Math.ceil(track[i].length / 10) === 0).slice(0, 10);
    console.log(`  闸${String(H[i].gate).padStart(2)}  完赛 ${H[i].time ? H[i].time.toFixed(2) : '-'}  t: ` +
      tr.map(x => x.t.toFixed(1)).join(' → '));
  }
  // 平均“整场加权”横向偏移：用 s 加权
  const wavg = H.map(h => 0);
  console.log('');
  for (let i = 0; i < H.length; i++) {
    const tr = track[i];
    let num = 0, den = 0;
    for (let k = 1; k < tr.length; k++) { const d = tr[k].s - tr[k - 1].s; num += tr[k].t * d; den += d; }
    wavg[i] = den > 0 ? num / den : NaN;
  }
  console.log('  闸位 → 全程加权平均车道偏移（扣除参考车道后，米）:');
  console.log('   ' + H.map((h, i) => `闸${h.gate}:${(wavg[i] - refLane).toFixed(1)}`).join('  '));
}
