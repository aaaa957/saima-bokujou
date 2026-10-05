// 距离专精对照：用「现实里真正区分短途/长途的属性轴」构造对照马。
// 只读探针。属性：速度/耐力/爆发力/毅力（其余压平）。
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const BASE = 86;
const ALL = ['速度', '耐力', '爆发力', '毅力', '力量', '体格', '出闸能力'];

function mk(id, over, seed) {
  const h = S.makeHorse(S.mulberry32(seed), {
    id, name: id, level: BASE, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
    physiology: S.neutralPhysiology(),
    behavior: { forwardness: 0.5, settle: 0.6, tractability: 0.7 },
    racePlan: { position: 0.5, risk: 0.5, patience: 0.6 },
  });
  for (const k of ALL) if (h.stats[k] !== undefined) h.stats[k] = BASE;
  for (const [k, v] of Object.entries(over)) h.stats[k] = v;
  return h;
}

function runAt(length, seed, pairs) {
  const field = pairs.map((p, i) => mk('h' + i, p.over, seed + i));
  const r = S.createRace(field, { length, profile: '平坦', rng: S.mulberry32(seed) });
  let g = 0;
  while (!r.race.finished && g++ < 800000) r.step(1 / 30);
  const rows = r.race.horses.map(h => ({ id: h.id, time: h.time }));
  rows.sort((a, b) => a.time - b.time);
  return rows;
}

const SUITES = [
  {
    name: 'A 只动 速度/耐力',
    pairs: [
      { label: '速度型', over: { '速度': 100, '耐力': 72 } },
      { label: '耐力型', over: { '速度': 72, '耐力': 100 } },
    ],
  },
  {
    name: 'B 只动 爆发力（短跑功率）',
    pairs: [
      { label: '爆发型', over: { '爆发力': 100 } },
      { label: '普通', over: {} },
    ],
  },
  {
    name: 'C 全轴：短跑型 vs 长跑型',
    pairs: [
      { label: '短跑型', over: { '速度': 100, '爆发力': 100, '耐力': 72, '毅力': 72 } },
      { label: '长跑型', over: { '速度': 72, '爆发力': 72, '耐力': 100, '毅力': 100 } },
    ],
  },
];

console.log('=== 距离专精对照（同级别 86）===');
for (const s of SUITES) {
  console.log('\n' + s.name);
  for (const L of [1200, 2000, 3200]) {
    const rows = runAt(L, 20261005, s.pairs);
    const tag = rows.map(r => s.pairs[Number(r.id.slice(1))].label + ' ' + r.time.toFixed(2)).join('  |  ');
    console.log('  ' + String(L).padStart(5) + 'm  ' + tag);
  }
}
