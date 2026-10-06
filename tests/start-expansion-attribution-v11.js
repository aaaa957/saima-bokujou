// 归因实验：出发 10s 的纵向跨度（spread10，现状约 5.1m）由什么贡献？
// 分别关掉「起步延迟差异」「配速意图差异」「加速度属性差异」，看 spread10 掉多少。
// 只读——源码打补丁到临时文件，不改仓库文件。
//
// 用法：node tests/start-expansion-attribution-v11.js [length]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

const A_DELAY = "startDelay:0.12+(100-adj['出闸能力'])*0.003+rng()*0.15,";
const A_INTENT = "paceIntentSpan:0.05,";

function patched(name, { fixedDelay = false, noIntent = false } = {}) {
  let s = src0;
  if (fixedDelay) { if (!s.includes(A_DELAY)) throw new Error('锚点缺失: delay'); s = s.replace(A_DELAY, 'startDelay:0.20,'); }
  if (noIntent) { if (!s.includes(A_INTENT)) throw new Error('锚点缺失: intent'); s = s.replace(A_INTENT, 'paceIntentSpan:0,'); }
  const f = path.join(os.tmpdir(), `startattr_${name}_${Date.now()}.js`);
  fs.writeFileSync(f, s);
  return f;
}

const DT = 1 / 30, N = 14, SEED = 20261005;
// override: { statKey: value } —— 从外部把某些属性统一（纯外部操作，无需补丁）
function makeField(override) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const h = S.makeHorse(S.mulberry32(SEED + i * 7919), {
      id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
      jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
      physiology: S.neutralPhysiology(),
    });
    if (override) for (const k of Object.keys(override)) if (h.stats[k] !== undefined) h.stats[k] = override[k];
    out.push(h);
  }
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
function run(length, override) {
  const r = S.createRace(makeField(override), { length, profile: '平坦', rng: S.mulberry32(SEED) });
  const H = r.race.horses; const tr = H.map(() => []);
  const delays = H.map(h => h.startDelay);
  let g = 0, next = 0;
  while (!r.race.finished && g++ < 700000) {
    r.step(DT);
    if (r.race.t >= next) { for (let i = 0; i < H.length; i++) tr[i].push({ s: H[i].s, v: H[i].v }); next += 0.5; }
  }
  const fin = H.filter(h => h.time !== null && h.time !== undefined).sort((a, b) => a.time - b.time);
  const T = fin.map(h => h.time - fin[0].time);
  const idx = k => Math.min(tr[0].length - 1, Math.floor(k / 0.5));
  const spreadAt = k => { const i = idx(k); const a = tr.map(t => t[i].s); return Math.max(...a) - Math.min(...a); };
  // 到达 200m 的用时（逐马，用 0.5s 栅格近似）
  const t200 = H.map((h, i) => { const a = tr[i]; for (let k = 0; k < a.length; k++) if (a[k].s >= 200) return k * 0.5; return NaN; }).filter(Number.isFinite);
  return {
    rho: pearson(fin.map(h => h.gate), T), cv: sd(fin.map(h => h.time)) / mean(fin.map(h => h.time)),
    within1: T.filter(t => t <= 1).length / fin.length, firstLast: T[T.length - 1],
    spread4: spreadAt(4), spread10: spreadAt(10), spread20: spreadAt(20),
    delayMean: mean(delays), delaySd: sd(delays), delayRange: Math.max(...delays) - Math.min(...delays),
    t200Sd: sd(t200), t200Range: Math.max(...t200) - Math.min(...t200),
  };
}

const L = Number(process.argv[2]) || 1200;
const variants = [
  ['base              (现状)', {}, null],
  ['fixedDelay        (延迟全同)', { fixedDelay: true }, null],
  ['noIntent          (关配速意图)', { noIntent: true }, null],
  ['fixedDelay+noIntent', { fixedDelay: true, noIntent: true }, null],
  ['stat:gate=90      (出闸能力全同)', {}, { '出闸能力': 90 }],
  ['stat:gate+burst=90', {}, { '出闸能力': 90, '爆发力': 90 }],
];

console.log(`=== ${L}m / ${N}匹 / seed ${SEED} ===`);
console.log('变体'.padEnd(30) + 'spread4  spread10  spread20 |  闸位ρ   时间CV  within1  首末差 | 延迟均值±SD(范围) | 过200m SD(范围)');
for (const [name, patchOpt, override] of variants) {
  S = require(patched(name.replace(/[^a-z0-9]/gi, '_'), patchOpt));
  const r = run(L, override);
  console.log(
    name.padEnd(28) +
    r.spread4.toFixed(1).padStart(6) + r.spread10.toFixed(1).padStart(9) + r.spread20.toFixed(1).padStart(9) + ' |  ' +
    r.rho.toFixed(3).padStart(5) + (r.cv * 100).toFixed(3).padStart(8) + '%' +
    (r.within1 * 100).toFixed(1).padStart(7) + '%' + r.firstLast.toFixed(2).padStart(7) + 's' + ' | ' +
    `${r.delayMean.toFixed(3)}±${r.delaySd.toFixed(3)}(${r.delayRange.toFixed(3)})`.padStart(20) + ' | ' +
    `${r.t200Sd.toFixed(2)}(${r.t200Range.toFixed(2)})`.padStart(15));
}
