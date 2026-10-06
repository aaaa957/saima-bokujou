// 多 seed 验证：paceIntentSpan 的放大效果是否稳定（不是单场偶然）。
// 配对比较同一 seed 下的 base / 0.15 / 0.20。只读——源码打补丁到临时文件。
//
// 用法：node tests/pace-intent-multiseed-v11.js [length]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');
const A_INTENT = "paceIntentSpan:0.05,";

function patched(tag, span) {
  let s = src0;
  if (span !== 0.05) { if (!s.includes(A_INTENT)) throw new Error('锚点缺失'); s = s.replace(A_INTENT, `paceIntentSpan:${span},`); }
  const f = path.join(os.tmpdir(), `pims_${tag}_${Date.now()}.js`);
  fs.writeFileSync(f, s);
  return f;
}

const DT = 1 / 30, N = 14;
const SEEDS = [20261005, 777001, 31337, 991, 424242];
function makeField(seed) {
  const out = [];
  for (let i = 0; i < N; i++) out.push(S.makeHorse(S.mulberry32(seed + i * 7919), {
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
function run(length, seed) {
  const r = S.createRace(makeField(seed), { length, profile: '平坦', rng: S.mulberry32(seed) });
  const H = r.race.horses; const tr = H.map(() => []);
  let g = 0, next = 0;
  while (!r.race.finished && g++ < 900000) {
    r.step(DT);
    if (r.race.t >= next) { for (let i = 0; i < H.length; i++) tr[i].push(H[i].s); next += 1; }
  }
  const fin = H.filter(h => h.time !== null && h.time !== undefined).sort((a, b) => a.time - b.time);
  const T = fin.map(h => h.time - fin[0].time);
  const i10 = Math.min(tr[0].length - 1, 10);
  const a10 = tr.map(t => t[i10]);
  return {
    rho: pearson(fin.map(h => h.gate), T), cv: sd(fin.map(h => h.time)) / mean(fin.map(h => h.time)),
    within1: T.filter(t => t <= 1).length / fin.length, firstLast: T[T.length - 1],
    spread10: Math.max(...a10) - Math.min(...a10),
    winner: mean(fin.map(h => h.time)),
  };
}

const L = Number(process.argv[2]) || 1200;
const spans = [0.05, 0.15, 0.20];
const acc = {};
for (const s of spans) acc[s] = [];
console.log(`=== ${L}m / ${N}匹 / ${SEEDS.length} seeds ===`);
console.log('seed'.padEnd(12) + spans.map(s => `span=${s}`.padStart(34)).join(''));
for (const seed of SEEDS) {
  let line = String(seed).padEnd(12);
  for (const sp of spans) {
    S = require(patched(sp + '_' + seed + '_' + L, sp));
    const r = run(L, seed);
    acc[sp].push(r);
    line += (`ρ${r.rho.toFixed(2)} w1 ${(r.within1 * 100).toFixed(0)}% cv${(r.cv * 100).toFixed(2)}% f-l${r.firstLast.toFixed(2)}`).padStart(34);
  }
  console.log(line);
}
console.log('-' .repeat(114));
let sum = '均值'.padEnd(12);
for (const sp of spans) {
  const a = acc[sp];
  sum += (`ρ${mean(a.map(x => x.rho)).toFixed(3)} w1 ${(mean(a.map(x => x.within1)) * 100).toFixed(1)}% cv${(mean(a.map(x => x.cv)) * 100).toFixed(3)}% f-l${mean(a.map(x => x.firstLast)).toFixed(2)}`).padStart(34);
}
console.log(sum);
console.log('（口径：现实 within1 约 58.9%、首末差约 4.19s —— 但本探针为 14 匹同质阵容，仅作相对比较）');
