// 横移速度扫描：lateralSpeed 是否过低、导致外侧闸位的马回不到内栏？
// 报闸位相关性与场内离散度。只读探针，改的是导出实时的 RACE_F。
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
function pearson(x, y) {
  const n = Math.min(x.length, y.length); if (n < 3) return NaN;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return (sx && sy) ? sxy / Math.sqrt(sx * sy) : NaN;
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); }

function run(length) {
  const r = S.createRace(makeField(N, SEED), { length, profile: '平坦', rng: S.mulberry32(SEED) });
  const H = r.race.horses; const tr = H.map(() => []);
  let g = 0, next = 0;
  while (!r.race.finished && g++ < 700000) {
    r.step(DT);
    if (r.race.t >= next) { for (let i = 0; i < H.length; i++) tr[i].push({ s: H[i].s, t: H[i].t }); next += 0.5; }
  }
  const fin = H.filter(h => h.time !== null && h.time !== undefined).sort((a, b) => a.time - b.time);
  const T = fin.map(h => h.time - fin[0].time);
  const within1 = T.filter(t => t <= 1).length / fin.length;
  const off = H.map((h, i) => {
    let num = 0, den = 0; const a = tr[i];
    for (let k = 1; k < a.length; k++) { const d = a[k].s - a[k - 1].s; num += a[k].t * d; den += d; }
    return den > 0 ? num / den : NaN;
  });
  return {
    gateRho: pearson(fin.map(h => h.gate), T),
    spdRho: pearson(fin.map(h => h.adj['速度']), T),
    cv: sd(fin.map(h => h.time)) / mean(fin.map(h => h.time)),
    within1, firstLast: T[T.length - 1],
    meanWide: mean(off.filter(Number.isFinite)),
  };
}

const save = S.RACE_F.lateralSpeed;
console.log('lateralSpeed  距离   闸位ρ   速度ρ   时间CV   within1   首末差   全场加权平均横向偏移');
for (const ls of [0.8, 1.2, 1.8, 2.5, 3.5]) {
  S.RACE_F.lateralSpeed = ls;
  for (const L of [1200, 3200]) {
    const r = run(L);
    console.log(`${String(ls).padEnd(12)} ${String(L).padStart(5)}m  ${r.gateRho.toFixed(3).padStart(6)}  ${r.spdRho.toFixed(3).padStart(6)}  ` +
      `${(r.cv * 100).toFixed(3).padStart(6)}%  ${(r.within1 * 100).toFixed(1).padStart(6)}%  ${r.firstLast.toFixed(2).padStart(6)}s  ${r.meanWide.toFixed(2).padStart(6)}`);
  }
}
S.RACE_F.lateralSpeed = save;
