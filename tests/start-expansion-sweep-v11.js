// 扫描：让马群早期展开的两条候选路径，哪条有效？
//  A) 出闸反应个体化：startDelay 由属性驱动（放大 K1、压缩随机 K2）
//  B) 起跑强度差异化：放大 paceIntentSpan（战术意图对早期配速的偏置）
// 只读——源码打补丁到临时文件，不改仓库文件。
//
// 用法：node tests/start-expansion-sweep-v11.js [length]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

const A_DELAY = "startDelay:0.12+(100-adj['出闸能力'])*0.003+rng()*0.15,";
const A_INTENT = "paceIntentSpan:0.05,";

function patched(name, repl) {
  let s = src0;
  for (const [a, b] of repl) { if (!s.includes(a)) throw new Error('锚点缺失: ' + a.slice(0, 40)); s = s.replace(a, b); }
  const f = path.join(os.tmpdir(), `startsw_${name}_${Date.now()}.js`);
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
  const delays = H.map(h => h.startDelay);
  let g = 0, next = 0;
  while (!r.race.finished && g++ < 700000) {
    r.step(DT);
    if (r.race.t >= next) { for (let i = 0; i < H.length; i++) tr[i].push(H[i].s); next += 0.5; }
  }
  const fin = H.filter(h => h.time !== null && h.time !== undefined).sort((a, b) => a.time - b.time);
  const T = fin.map(h => h.time - fin[0].time);
  const at = k => { const i = Math.min(tr[0].length - 1, Math.floor(k / 0.5)); const a = tr.map(t => t[i]); return Math.max(...a) - Math.min(...a); };
  const t200 = H.map((h, i) => { const a = tr[i]; for (let k = 0; k < a.length; k++) if (a[k] >= 200) return k * 0.5; return NaN; }).filter(Number.isFinite);
  return {
    rho: pearson(fin.map(h => h.gate), T), cv: sd(fin.map(h => h.time)) / mean(fin.map(h => h.time)),
    within1: T.filter(t => t <= 1).length / fin.length,
    spread10: at(10), t200Sd: sd(t200),
    dSd: sd(delays), dRange: Math.max(...delays) - Math.min(...delays),
  };
}

const L = Number(process.argv[2]) || 1200;
// A) 出闸反应个体化：K1 放大、K2 压缩（总和保持相近量级）
const delay = (k1, k2) => `startDelay:0.12+(100-adj['出闸能力'])*${k1}+rng()*${k2},`;
// B) 起跑强度：放大早期配速偏置
const intent = v => `paceIntentSpan:${v},`;

const variants = [
  ['现状 (K1=.003 K2=.15 span=.05)', []],
  ['A1 属性化 K1=.010 K2=.05', [[A_DELAY, delay(0.010, 0.05)]]],
  ['A2 属性化 K1=.020 K2=.03', [[A_DELAY, delay(0.020, 0.03)]]],
  ['A3 属性化 K1=.035 K2=.02', [[A_DELAY, delay(0.035, 0.02)]]],
  ['B1 起跑强度 span=.10', [[A_INTENT, intent(0.10)]]],
  ['B2 起跑强度 span=.20', [[A_INTENT, intent(0.20)]]],
  ['B3 起跑强度 span=.35', [[A_INTENT, intent(0.35)]]],
  ['A2+B2 组合', [[A_DELAY, delay(0.020, 0.03)], [A_INTENT, intent(0.20)]]],
];

console.log(`=== ${L}m / ${N}匹 / seed ${SEED} ===`);
console.log('变体'.padEnd(34) + 'spread10 |  闸位ρ   时间CV  within1 | 延迟SD(范围)  过200m SD');
for (const [name, repl] of variants) {
  S = require(patched(name.replace(/[^a-z0-9]/gi, '_'), repl));
  const r = run(L);
  console.log(
    name.padEnd(32) + r.spread10.toFixed(1).padStart(7) + '  |  ' +
    r.rho.toFixed(3).padStart(5) + (r.cv * 100).toFixed(3).padStart(8) + '%' +
    (r.within1 * 100).toFixed(1).padStart(7) + '%' + ' | ' +
    `${r.dSd.toFixed(3)}(${r.dRange.toFixed(3)})`.padStart(16) + r.t200Sd.toFixed(2).padStart(10));
}
