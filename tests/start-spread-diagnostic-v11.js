// 诊断验证：把起步离散度放大（模拟"马群在出闸后真的拉开"），
// 看「闸位决定名次」是否随之减弱。只读——源码打补丁到临时文件，不改仓库文件。
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

function patched(mult) {
  const a = "startDelay:0.12+(100-adj['出闸能力'])*0.003+rng()*0.15";
  if (!src0.includes(a)) throw new Error('锚点缺失');
  const f = path.join(os.tmpdir(), `startspread_${mult}.js`);
  fs.writeFileSync(f, src0.replace(a, `startDelay:0.12+(100-adj['出闸能力'])*0.003+rng()*${mult}`));
  return f;
}

const DT = 1 / 30, N = 14, SEED = 20261005;
function makeField() {
  const out = [];
  for (let i = 0; i < N; i++) out.push(S.makeHorse(S.mulberry32(SEED + i * 7919), {
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

let S;
function run(length) {
  const r = S.createRace(makeField(), { length, profile: '平坦', rng: S.mulberry32(SEED) });
  const H = r.race.horses; const tr = H.map(() => []);
  let g = 0, next = 0;
  while (!r.race.finished && g++ < 700000) {
    r.step(DT);
    if (r.race.t >= next) { for (let i = 0; i < H.length; i++) tr[i].push({ s: H[i].s, t: H[i].t }); next += 0.5; }
  }
  const fin = H.filter(h => h.time !== null && h.time !== undefined).sort((a, b) => a.time - b.time);
  const T = fin.map(h => h.time - fin[0].time);
  const off = H.map((h, i) => {
    let num = 0, den = 0; const a = tr[i];
    for (let k = 1; k < a.length; k++) { const d = a[k].s - a[k - 1].s; num += a[k].t * d; den += d; }
    return den > 0 ? num / den : NaN;
  });
  // 出发后 10 s 时的纵向跨度
  const idx = Math.min(tr[0].length - 1, Math.floor(10 / 0.5));
  const spread10 = Math.max(...H.map((_, i) => tr[i][idx].s)) - Math.min(...H.map((_, i) => tr[i][idx].s));
  return {
    rho: pearson(fin.map(h => h.gate), T), cv: sd(fin.map(h => h.time)) / mean(fin.map(h => h.time)),
    within1: T.filter(t => t <= 1).length / fin.length, firstLast: T[T.length - 1],
    meanWide: mean(off.filter(Number.isFinite)), spread10,
  };
}

console.log('起步离散倍率  距离   闸位ρ   时间CV   within1  首末差  平均横向偏移  出发10s纵向跨度');
for (const mult of [0.15, 0.45, 0.90]) {
  S = require(patched(mult));
  for (const L of [1200]) {
    const r = run(L);
    console.log(`${String(mult).padEnd(12)} ${String(L).padStart(5)}m  ${r.rho.toFixed(3).padStart(6)}  ` +
      `${(r.cv * 100).toFixed(3).padStart(6)}%  ${(r.within1 * 100).toFixed(1).padStart(6)}%  ${r.firstLast.toFixed(2).padStart(6)}s  ` +
      `${r.meanWide.toFixed(2).padStart(10)}  ${r.spread10.toFixed(1).padStart(12)}m`);
  }
}
