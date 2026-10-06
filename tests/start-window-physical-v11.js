// 验证：把"起跑窗口"从【赛程比例】改成【物理的加速过程】
//   现状 earlyWeight = 1 - s/(length*0.35)        ← 窗口随赛程伸缩
//   物理 earlyWeight = 1 - v/planned（起步完成即归零） ← 与速度进程绑定
// 并对照 paceIntentSpan（战术意图强度）。只读——源码打补丁到临时文件。
//
// 用法：node tests/start-window-physical-v11.js [length ...]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

const A_INTENT = "paceIntentSpan:0.05,";
const A_EARLY = "      const earlyWeight=clamp(1-H.s/Math.max(1,length*0.35),0,1);";
const PHYS_EARLY = "      const earlyWeight=H.startSettled?0:clamp(1-Math.max(0,H.v)/Math.max(1e-6,planned),0,1);";

function patched(name, repl) {
  let s = src0;
  for (const [a, b] of repl) { if (!s.includes(a)) throw new Error('锚点缺失: ' + a.slice(0, 50)); s = s.replace(a, b); }
  const f = path.join(os.tmpdir(), `swin_${name}_${Date.now()}.js`);
  fs.writeFileSync(f, s);
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
  while (!r.race.finished && g++ < 900000) {
    r.step(DT);
    if (r.race.t >= next) { for (let i = 0; i < H.length; i++) tr[i].push(H[i].s); next += 1; }
  }
  const fin = H.filter(h => h.time !== null && h.time !== undefined).sort((a, b) => a.time - b.time);
  const T = fin.map(h => h.time - fin[0].time);
  const at = k => { const i = Math.min(tr[0].length - 1, Math.floor(k / 1)); const a = tr.map(t => t[i]); return Math.max(...a) - Math.min(...a); };
  return {
    rho: pearson(fin.map(h => h.gate), T), cv: sd(fin.map(h => h.time)) / mean(fin.map(h => h.time)),
    within1: T.filter(t => t <= 1).length / fin.length, firstLast: T[T.length - 1],
    spread10: at(10), spread20: at(20),
    winner: mean(fin.map(h => h.time)),
  };
}

const lengths = process.argv.slice(2).map(Number).filter(Boolean);
const Ls = lengths.length ? lengths : [1200, 3200];

const variants = [
  ['base   span.05 比例窗口', []],
  ['prop   span.20 比例窗口', [[A_INTENT, 'paceIntentSpan:0.20,']]],
  ['phys   span.20 物理窗口', [[A_INTENT, 'paceIntentSpan:0.20,'], [A_EARLY, PHYS_EARLY]]],
  ['phys   span.15 物理窗口', [[A_INTENT, 'paceIntentSpan:0.15,'], [A_EARLY, PHYS_EARLY]]],
  ['phys   span.25 物理窗口', [[A_INTENT, 'paceIntentSpan:0.25,'], [A_EARLY, PHYS_EARLY]]],
];

for (const L of Ls) {
  console.log(`\n=== ${L}m / ${N}匹 / seed ${SEED} ===`);
  console.log('变体'.padEnd(26) + 'spread10  spread20 |  闸位ρ   时间CV  within1  首末差  冠军用时');
  for (const [name, repl] of variants) {
    S = require(patched(name.replace(/[^a-z0-9]/gi, '_') + '_' + L, repl));
    const r = run(L);
    console.log(
      name.padEnd(24) + r.spread10.toFixed(1).padStart(7) + r.spread20.toFixed(1).padStart(9) + '  |  ' +
      r.rho.toFixed(3).padStart(5) + (r.cv * 100).toFixed(3).padStart(8) + '%' +
      (r.within1 * 100).toFixed(1).padStart(7) + '%' + r.firstLast.toFixed(2).padStart(8) + 's' +
      r.winner.toFixed(2).padStart(10) + 's');
  }
}
