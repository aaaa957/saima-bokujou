// 闸位几何惩罚核算：若某匹马整场留在起跑车道，它到终点要多跑多少米？
// L(offset) = L(参考) + offset × 扫过转角（平行曲线精确关系）
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

for (const L of [1200, 2000, 3200]) {
  const field = [S.makeHorse(S.mulberry32(1), { id: 'a', level: 86, surface: '草地', special: '左右皆可' })];
  const r = S.createRace(field, { length: L, profile: '平坦', rng: S.mulberry32(1) });
  const geo = r.race.geo;
  const W = geo.width || S.TRACK_WIDTH;
  const refLane = geo.referenceLane ?? (W / 2);
  const n = 14;
  const pitch = Math.min(1.6, (W - 2) / n);
  console.log(`\n=== ${L}m   赛道宽 ${W}  参考车道 ${refLane.toFixed(2)}  pitch ${pitch.toFixed(3)} ===`);
  const ref = S.laneArcDistance(0, L, refLane, geo);
  const rows = [];
  for (let g = 1; g <= n; g++) {
    const t = 1 + pitch * (g - 0.5);
    const d = S.laneArcDistance(0, L, t, geo);
    rows.push({ g, t, d, extra: d - ref });
  }
  const ex = rows.map(x => x.extra);
  const mn = Math.min(...ex), mx = Math.max(...ex);
  console.log(`  参考车道全程物理距离 ${ref.toFixed(1)} m`);
  console.log(`  1 号闸额外 ${rows[0].extra.toFixed(1)} m   ${n} 号闸额外 ${rows[n - 1].extra.toFixed(1)} m`);
  console.log(`  闸位间额外距离跨度 ${(mx - mn).toFixed(1)} m = 全程的 ${(((mx - mn) / ref) * 100).toFixed(2)}%`);
  // 用冠军速度换算成时间
  const v = L === 1200 ? 18.1 : L === 2000 ? 17.9 : 16.3;
  console.log(`  按 ${v} m/s 换算 ≈ ${((mx - mn) / v).toFixed(2)} s`);
}
