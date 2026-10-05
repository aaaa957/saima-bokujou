// 分崩点设计探针：用【有真实异质性】的阵容，测三件事——
//   ① 速度剖面（场均值，按赛程百分比分箱）
//   ② 储备轨迹（场均值 + 离散度）
//   ③ 完赛密度（冠军后 1s / 2s 内比例）与「能力→成绩」放大倍数
// 只读，不改引擎。用法：node tests/breakdown-design-probe-v11.js [距离...]
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const DT = 1 / 30;
const N = Number(process.env.DP_N || 16);
const SEED = Number(process.env.DP_SEED || 20261005);

// 复用引擎自己的 makeHorse（它已内建「同班次能力接近」的压缩），
// 只让每匹马的随机种子不同 —— 这样阵容与真实批次一致。
function makeField(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = S.makeHorse(S.mulberry32(seed + i * 7919), {
      id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
      jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
      physiology: S.neutralPhysiology(),
    });
    out.push(h);
  }
  // DP_IDENTICAL=1：把所有马的属性/行为/计划设成与第一匹完全相同，
  // 用于分离「能力差造成的分散」与「结构噪声（闸位/交通/重规划）造成的分散」。
  if (process.env.DP_IDENTICAL === '1') {
    const ref = out[0];
    for (let i = 1; i < out.length; i++) {
      out[i].stats = { ...ref.stats };
      out[i].behavior = { ...ref.behavior };
      out[i].racePlan = { ...ref.racePlan };
      out[i].physiology = { ...ref.physiology };
      out[i].bodyMass = ref.bodyMass; out[i].carriedWeight = ref.carriedWeight;
      out[i].jockeyGrade = ref.jockeyGrade;
    }
  }
  return out;
}

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); }

function run(length) {
  const race = S.createRace(makeField(N, SEED), { length, profile: '平坦', rng: S.mulberry32(SEED) });
  const hs = race.race.horses;
  const samples = [];
  let steps = 0;
  while (!race.race.finished && steps++ < 600000) {
    race.step(DT);
    if (steps % 12 === 0) {                       // 每 0.4 s 采一次
      samples.push({
        t: race.race.t,
        s: hs.map(h => h.s), v: hs.map(h => h.v),
        res: hs.map(h => h.stamina / (h.staminaMax || 1)),
      });
    }
  }
  const fin = hs.filter(h => h.time !== null && h.time !== undefined && !h.dnf);
  const times = fin.map(h => h.time);
  const winner = Math.min(...times);
  const within1 = times.filter(t => t - winner <= 1).length;
  const within2 = times.filter(t => t - winner <= 2).length;
  // 按赛程百分比分箱的场均值
  const BINS = 10, vBin = Array.from({ length: BINS }, () => []), rBin = Array.from({ length: BINS }, () => []);
  for (const smp of samples) {
    const prog = mean(smp.s) / length;
    const b = Math.min(BINS - 1, Math.floor(prog * BINS));
    for (const v of smp.v) if (v > 1) vBin[b].push(v);
    for (const r of smp.res) rBin[b].push(r);
  }
  const vProf = vBin.map(mean), rProf = rBin.map(mean);
  // 末段 vs 中段（用第 7–8 箱 作中段、第 9–10 箱 作末段）
  const mid = mean(vBin.slice(6, 8).flat()), end = mean(vBin.slice(8, 10).flat());
  // 能力→成绩 放大倍数
  const maxV = fin.map(h => h.maxV), cvT = sd(times) / mean(times), cvV = sd(maxV) / mean(maxV);
  return { length, winner, n: fin.length, within1, within2, times, cvT, cvV, amp: cvT / cvV, vProf, rProf, mid, end };
}

const lengths = process.argv.slice(2).map(Number).filter(Boolean);
for (const L of (lengths.length ? lengths : [1200, 2000, 3200])) {
  const r = run(L);
  console.log(`\n=== ${L}m / ${r.n}匹   冠军 ${r.winner.toFixed(2)}s ===`);
  console.log(`  冠军后1s内 ${r.within1}/${r.n} = ${(100 * r.within1 / r.n).toFixed(1)}%   现实 ≈58.9%`);
  console.log(`  冠军后2s内 ${r.within2}/${r.n} = ${(100 * r.within2 / r.n).toFixed(1)}%   现实 ≈81.4%`);
  console.log(`  完赛时间 CV ${(r.cvT * 100).toFixed(3)}%   maxV CV ${(r.cvV * 100).toFixed(3)}%   放大 ${r.amp.toFixed(2)}×   （理论 ≈1×）`);
  console.log(`  中段均速 ${r.mid.toFixed(3)}  末段均速 ${r.end.toFixed(3)}  差 ${(r.end - r.mid).toFixed(3)} m/s`);
  console.log('  速度剖面(每10%): ' + r.vProf.map(v => v.toFixed(2)).join(' → '));
  console.log('  储备剖面(每10%): ' + r.rProf.map(v => (v * 100).toFixed(0) + '%').join(' → '));
}
