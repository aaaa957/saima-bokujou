// 放大来源定位：把「能力差 → 成绩差」的传递拆成两段
//   第 1 段：能力 → 自己的计划速度（用【单独跑】隔离，无对手/无交通）
//   第 2 段：计划速度 → 实际完赛（整场，含交通/跟驰/重规划）
// 若单跑离散度 ≈ 整场离散度 ⇒ 放大在"能力→速度"这一段
// 若单跑离散度 ≪ 整场离散度 ⇒ 放大在"交通/跟驰/重规划"这一段
// 只读，不改引擎。
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const DT = 1 / 30;
const N = Number(process.env.AMP_N || 14);
const SEED = Number(process.env.AMP_SEED || 20261005);

function makeField(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(S.makeHorse(S.mulberry32(seed + i * 7919), {
    id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
    physiology: S.neutralPhysiology(),
  }));
  return out;
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); }
const cv = a => sd(a) / mean(a);

function raceOnce(field, length, seed) {
  const r = S.createRace(field.map(h => ({ ...h })), { length, profile: '平坦', rng: S.mulberry32(seed) });
  let g = 0;
  while (!r.race.finished && g++ < 600000) r.step(DT);
  return { horses: r.race.horses, H: r.race.horses };
}
function pearson(x, y) {
  const n = Math.min(x.length, y.length); if (n < 3) return NaN;
  const mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return (sx && sy) ? sxy / Math.sqrt(sx * sy) : NaN;
}

const base = makeField(N, SEED);
for (const L of [1200, 2000, 3200]) {
  // 单跑：每匹马一场（无对手）
  const soloT = [];
  for (let i = 0; i < N; i++) {
    const r = raceOnce([base[i]], L, SEED + i * 104729);
    const h = r.horses[0];
    soloT.push(h.time !== null && h.time !== undefined ? h.time : NaN);
  }
  // 整场
  const full = raceOnce(base, L, SEED);
  const H = full.horses;
  const fullT = H.map(h => h.time).filter(t => t !== null && t !== undefined);
  const maxV = H.map(h => h.maxV), base0 = H.map(h => h.base);
  const sta = H.map(h => h.staminaMax), aer = H.map(h => h.aerobic);

  const ok = soloT.every(Number.isFinite) && fullT.length === N;
  console.log(`\n=== ${L}m / ${N}匹 ===`);
  console.log(`  能力 CV：base ${(cv(base0) * 100).toFixed(3)}%   maxV ${(cv(maxV) * 100).toFixed(3)}%` +
    `   staminaMax ${(cv(sta) * 100).toFixed(3)}%   aerobic ${(cv(aer) * 100).toFixed(3)}%`);
  const cSolo = cv(soloT), cFull = cv(fullT);
  console.log(`  单跑时间 CV ${(cSolo * 100).toFixed(3)}%   整场时间 CV ${(cFull * 100).toFixed(3)}%`);
  console.log(`  放大：单跑/能力 = ${(cSolo / cv(base0)).toFixed(2)}×    整场/能力 = ${(cFull / cv(base0)).toFixed(2)}×` +
    `    整场/单跑 = ${(cFull / cSolo).toFixed(2)}×`);
  // 谁能预测单跑成绩
  const spd = H.map(h => h.adj['速度']), end = H.map(h => h.adj['耐力']);
  console.log(`  单跑成绩 vs 速度 ρ=${pearson(spd, soloT).toFixed(3)}   vs 耐力 ρ=${pearson(end, soloT).toFixed(3)}`);
  if (!ok) console.log('  ⚠️ 有样本未完赛');
}
