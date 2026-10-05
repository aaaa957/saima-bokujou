#!/usr/bin/env node
'use strict';
// 分崩点涌现性测量（只读诊断，不参与验收）。
//
// 目的：验证「终盘有氧衰减」机制是否让马群【自然涌现】出 Spence et al. (2012)
// 观测到的集体分崩，而不是被硬编码在某个距离上。
//
// 对照目标（Spence 2012，44,803 次出赛 / 3,357 场）：
//   · 分崩点：剩余 478 ± 220 m
//   · 分崩后中位减速度 −0.080 m/s²；中段 −0.0093 m/s²；比值 ≈ 8.6
//   · 92% 的马在分崩点后减速
//   · 分崩点与最后一个弯道位置无关
//
// 用法：node tests/breakdown-emergence-v11.js [length ...]

const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

// 允许覆盖机制参数以便标定（只影响本探针进程）。
if (process.env.EMERGE_GATE) S.RACE_F.anaerobicGate = Number(process.env.EMERGE_GATE);
if (process.env.EMERGE_FADE) S.RACE_F.endgameFade = Number(process.env.EMERGE_FADE);

const DT = 1 / 30;

function makeField(n, seed) {
  const rng = S.mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = S.makeHorse(() => rng(), {
      id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
      jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
      physiology: S.neutralPhysiology(),
      behavior: { forwardness: 0.4 + (i % 3) * 0.2, settle: 0.6, tractability: 0.7 },
      racePlan: { position: 0.4 + (i % 3) * 0.2, risk: 0.5, patience: 0.6 },
    });
    for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
    out.push(h);
  }
  return out;
}

function run(length, n, seed) {
  const race = S.createRace(makeField(n, seed), { length, profile: '平坦', rng: S.mulberry32(seed) });
  const horses = race.race.horses;
  const series = horses.map(() => []);
  let guard = 0;
  while (!race.race.finished && guard++ < 400000) {
    race.step(DT);
    for (let i = 0; i < horses.length; i++) {
      const h = horses[i];
      if (!h.place) series[i].push({ t: race.race.t, s: h.s, v: h.v, reserve: h.stamina / h.staminaMax });
    }
  }
  return { length, horses, series, finishT: race.race.t };
}

// 在场平均速度（按距离分箱），返回 [{dist, v, reserve, decel}]
function profile(r, binM) {
  const bins = [];
  const nb = Math.floor(r.length / binM);
  for (let b = 0; b < nb; b++) {
    const lo = b * binM, hi = lo + binM;
    let sum = 0, cnt = 0, res = 0, resCnt = 0;
    for (const ser of r.series) {
      // 该马跨越 [lo,hi] 的用时
      let t0 = null, t1 = null, rMid = null;
      for (const p of ser) {
        if (p.s >= lo && t0 === null) t0 = p.t;
        if (p.s >= hi && t1 === null) { t1 = p.t; }
        if (p.s >= (lo + hi) / 2 && rMid === null) rMid = p.reserve;
        if (t1 !== null) break;
      }
      if (t0 !== null && t1 !== null && t1 > t0) { sum += binM / (t1 - t0); cnt++; }
      if (rMid !== null) { res += rMid; resCnt++; }
    }
    if (cnt) bins.push({ mid: (lo + hi) / 2, v: sum / cnt, reserve: resCnt ? res / resCnt : null });
  }
  for (let i = 1; i < bins.length; i++) {
    const a = bins[i - 1], b = bins[i];
    a.decel = (b.v - a.v) / ((binM / b.v + binM / a.v) / 2); // dv/dt 近似
  }
  return bins;
}

// 分崩点：最后一次 dv/dt 持续跌破阈值的位置
function breakPoint(bins, thresh = -0.03, holdBins = 3) {
  let last = null;
  for (let i = 1; i < bins.length; i++) {
    if (bins[i].decel === undefined) continue;
    if (bins[i].decel < thresh) {
      let ok = true;
      for (let k = i; k < Math.min(bins.length, i + holdBins); k++) {
        if (bins[k].decel === undefined || bins[k].decel >= thresh) { ok = false; break; }
      }
      if (ok) last = i;
    }
  }
  return last;
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; }

const lengths = process.argv.slice(2).map(Number).filter(Number.isFinite);
const targets = lengths.length ? lengths : [2000, 2400];
const N = Number(process.env.EMERGE_N || 16);

for (const L of targets) {
  const r = run(L, N, 20261005);
  const bins = profile(r, 50);
  const bp = breakPoint(bins);
  console.log(`\n=== ${L}m / ${N}匹   完赛 t=${r.finishT.toFixed(1)}s ===`);
  if (bp === null) {
    console.log('  未检出持续减速段（分崩点未涌现）');
  } else {
    const bpDist = bins[bp].mid;
    const before = bins.slice(1, bp).map(b => b.decel).filter(Number.isFinite);
    const after = bins.slice(bp).map(b => b.decel).filter(Number.isFinite);
    const mid = median(before), end = median(after);
    console.log(`  分崩点：距终点 ${(L - bpDist).toFixed(0)} m   （文献 478 ± 220 m）`);
    console.log(`  分崩前减速度中位：${mid.toFixed(4)} m/s²   分崩后：${end.toFixed(4)} m/s²`);
    console.log(`  比值 ${(end / mid).toFixed(2)}×             （文献 ≈ 8.6×）`);
    console.log(`  该点储备比例（全体均）：${bins[bp].reserve !== null ? (bins[bp].reserve * 100).toFixed(1) + '%' : 'n/a'}   （机制阈值 ${(S.RACE_F.anaerobicGate * 100).toFixed(1)}%）`);
  }
  // 92% 判据：完赛后段出现减速的马比例
  let slowed = 0, tot = 0;
  for (const ser of r.series) {
    if (ser.length < 40) continue;
    tot++;
    const n = ser.length;
    const last = ser[n - 1].v, midv = ser[Math.floor(n * 0.5)].v;
    if (last < midv) slowed++;
  }
  console.log(`  末段速度低于中段速度的马：${slowed}/${tot} = ${(100 * slowed / tot).toFixed(0)}%  （文献 92%）`);
  // 速度剖面（每 200m）
  const prof = profile(r, 200);
  console.log('  速度剖面（每 200m，场均值 / 剩余储备）：');
  console.log('    ' + prof.map(b => `${b.mid}m:${b.v.toFixed(2)}${b.reserve !== null ? '(' + (b.reserve * 100).toFixed(0) + '%)' : ''}`).join('  '));
}
