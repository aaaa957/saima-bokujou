// 定位"探针阵容"与"真实阵容"的差别：同一距离、同一 seed，只变阵容构造方式。
//   A 探针造法   直接 makeHorse（每匹马单独 rng）—— 此前所有密度探针用的就是这个
//   B makeField 传 race   —— 批次实际路径（走 selectRaceCohort 按距离筛选）
//   C makeField 不传 race —— 引擎的"无 race"简支路
// 同时打印属性剖面，看"筛选"到底改变了什么。只读。
//
// 用法：node tests/probe-vs-field-v11.js [length]
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const DT = 1 / 30, SEED = 20261005;
const L = Number(process.argv[2]) || 1200;
const raceCfg = { length: L, surface: '草地', state: '良', course: '中山芝外A', dir: '右回', profile: '平坦' };

// —— 批次 fieldFor 的后处理，三组一致套用 ——
function post(h) {
  for (const x of h) {
    x.surface = '草地'; x.special = '左右皆可';
    Object.assign(x, { '疲劳': 0, '斗志': 50, jockeyGrade: '优秀', bodyMass: 480, carriedWeight: 57 });
    x.physiology = S.neutralPhysiology();
  }
  return h;
}
function fieldProbe(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(S.makeHorse(S.mulberry32(seed + i * 7919), {
    id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
    physiology: S.neutralPhysiology(),
  }));
  return out;
}
function fieldCohort(n, seed) { return post(S.makeField(S.mulberry32(seed), { n, level: 86, race: raceCfg })); }
function fieldPlain(n, seed) { return post(S.makeField(S.mulberry32(seed), { n, level: 86 })); }

const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); }
const K = ['速度', '耐力', '爆发力', '出闸能力'];

function profile(field) {
  const o = {};
  for (const k of K) {
    const v = field.map(h => h.stats[k]).filter(Number.isFinite);
    o[k] = { mean: mean(v), sd: sd(v), range: Math.max(...v) - Math.min(...v) };
  }
  return o;
}

let gid = 0;
function run(makeFieldFn, tag) {
  const field = makeFieldFn();
  const race = S.createRace(field, { length: L, profile: '平坦', rng: S.mulberry32(SEED + (gid++)) });
  const H = race.race.horses;
  // 逐马属性落到 H.adj 上（引擎归一化后的值，更接近物理）
  const adjOf = k => H.map(h => h.adj[k]).filter(Number.isFinite);
  let g = 0;
  while (!race.race.finished && g++ < 900000) race.step(DT);
  const fin = H.filter(h => h.time !== null && h.time !== undefined).sort((a, b) => a.time - b.time);
  const T = fin.map(h => h.time - fin[0].time);
  const p = profile(field);
  return {
    tag, n: field.length,
    within1: T.filter(t => t <= 1).length / fin.length,
    within2: T.filter(t => t <= 2).length / fin.length,
    tail: T[T.length - 1],
    winner: mean(fin.map(h => h.time)),
    cvTime: sd(fin.map(h => h.time)) / mean(fin.map(h => h.time)),
    maxVcv: sd(H.map(h => h.maxV)) / mean(H.map(h => h.maxV)),
    adjSpeed: { m: mean(adjOf('速度')), sd: sd(adjOf('速度')) },
    adjStam: { m: mean(adjOf('耐力')), sd: sd(adjOf('耐力')) },
    prof: p,
  };
}

console.log(`=== ${L}m / seed ${SEED} / 引擎 = 当前工作树 ===`);
console.log('（within1 = 冠军后 1s 内比例；现实约 58.9%）');
console.log('');
const rows = [
  run(() => fieldProbe(14, SEED), 'A 探针造法 n=14'),
  run(() => fieldCohort(14, SEED), 'B makeField+race n=14'),
  run(() => fieldPlain(14, SEED), 'C makeField 无race n=14'),
  run(() => fieldProbe(18, SEED), 'A 探针造法 n=18'),
  run(() => fieldCohort(18, SEED), 'B makeField+race n=18'),
];
console.log('组'.padEnd(26) + 'n   within1  within2   首末差  冠军用时 时间CV  maxV-CV | 速度均值±SD 耐力均值±SD');
for (const r of rows) {
  console.log(
    r.tag.padEnd(24) + String(r.n).padStart(2) +
    (r.within1 * 100).toFixed(1).padStart(9) + '%' +
    (r.within2 * 100).toFixed(1).padStart(8) + '%' +
    r.tail.toFixed(2).padStart(9) + 's' + r.winner.toFixed(2).padStart(9) + 's' +
    (r.cvTime * 100).toFixed(3).padStart(8) + '%' + (r.maxVcv * 100).toFixed(3).padStart(8) + '%' + ' | ' +
    `${r.adjSpeed.m.toFixed(1)}±${r.adjSpeed.sd.toFixed(2)}`.padStart(13) +
    `${r.adjStam.m.toFixed(1)}±${r.adjStam.sd.toFixed(2)}`.padStart(15));
}
console.log('');
console.log('=== 属性剖面（stats，%) ===');
for (const r of rows) {
  console.log('  ' + r.tag.padEnd(24) + K.map(k =>
    `${k}=${r.prof[k].mean.toFixed(1)}±${r.prof[k].sd.toFixed(2)}(极差${r.prof[k].range.toFixed(0)})`).join('  '));
}
