// 干净验证：把「有氧基线」提高（并同步放开被写死的 68 上限），
// 看是否能让「短途由功率(速度)决定 / 长途由能量(耐力)决定」真正分开。
// 做法：把 sim.js 源码打补丁写到临时文件再 require，不修改仓库文件。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

function patched(aerobicPower, clampMax) {
  let src = src0;
  const a = 'aerobicPower:50, aerobicPerPoint:0.24, aerobicTau:10,';
  const b = "clamp(RACE_F.aerobicPower+(adj['耐力']-70)*RACE_F.aerobicPerPoint,35,68)";
  if (!src.includes(a) || !src.includes(b)) throw new Error('锚点缺失');
  src = src.replace(a, `aerobicPower:${aerobicPower}, aerobicPerPoint:0.24, aerobicTau:10,`);
  src = src.replace(b, `clamp(RACE_F.aerobicPower+(adj['耐力']-70)*RACE_F.aerobicPerPoint,35,${clampMax})`);
  const f = path.join(os.tmpdir(), `spec_${aerobicPower}_${clampMax}.js`);
  fs.writeFileSync(f, src);
  return f;
}

const BASE = 86;
const ALL = ['速度', '耐力', '爆发力', '毅力', '力量', '体格', '出闸能力'];

function build(S, id, over, seed) {
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

function runAt(S, length, pairs) {
  const field = pairs.map((p, i) => build(S, 'h' + i, p.over, 20261005 + i));
  const r = S.createRace(field, { length, profile: '平坦', rng: S.mulberry32(20261005) });
  let g = 0;
  while (!r.race.finished && g++ < 800000) r.step(1 / 30);
  const rows = r.race.horses.map(h => ({ id: h.id, time: h.time }));
  rows.sort((a, b) => a.time - b.time);
  return rows;
}

const PAIRS = [
  { label: '短跑型', over: { '速度': 100, '爆发力': 100, '耐力': 72, '毅力': 72 } },
  { label: '长跑型', over: { '速度': 72, '爆发力': 72, '耐力': 100, '毅力': 100 } },
];

for (const [ap, cm] of [[50, 68], [62, 80], [70, 88]]) {
  const S = require(patched(ap, cm));
  const tag = `aerobicPower=${ap} clampMax=${cm}${ap === 50 ? '（=基线）' : ''}`;
  const out = [];
  for (const L of [1200, 2000, 3200]) {
    const rows = runAt(S, L, PAIRS);
    out.push(String(L).padStart(4) + 'm ' + PAIRS[Number(rows[0].id.slice(1))].label + ' ' + rows[0].time.toFixed(2) + 's');
  }
  console.log(tag.padEnd(34) + out.join('   '));
}
