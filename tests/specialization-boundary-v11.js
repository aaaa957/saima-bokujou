// 边界扫描：固定 staminaPer=30，只动 baseSpeed.b，看专精在哪个 b 处消失。
// 并加一组抬高阻力(resistanceK)的配置，检验是否有"独立减速"的杠杆。
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

function patched({ bSpeed, staminaPer = 30, resistanceK = 0.250215 }) {
  let src = src0;
  const anchors = [
    ['baseSpeed:{a:0.020,b:15.30,min:1,max:115}', `baseSpeed:{a:0.020,b:${bSpeed},min:1,max:115}`],
    ['staminaPer:30, gutsPer:60, energyScale:1,', `staminaPer:${staminaPer}, gutsPer:60, energyScale:1,`],
    ['resistanceK:0.250215,', `resistanceK:${resistanceK},`],
  ];
  for (const [a, r] of anchors) { if (!src.includes(a)) throw new Error('锚点缺失: ' + a.slice(0, 30)); src = src.replace(a, r); }
  const f = path.join(os.tmpdir(), `bd_${String(bSpeed).replace('.', 'p')}_${staminaPer}_${String(resistanceK).replace('.', 'p')}.js`);
  fs.writeFileSync(f, src); return f;
}

const BASE = 86, ALL = ['速度', '耐力', '爆发力', '毅力', '力量', '体格', '出闸能力'];
function build(S, id, over, seed) {
  const h = S.makeHorse(S.mulberry32(seed), { id, name: id, level: BASE, surface: '草地', special: '左右皆可',
    jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(),
    behavior: { forwardness: 0.5, settle: 0.6, tractability: 0.7 }, racePlan: { position: 0.5, risk: 0.5, patience: 0.6 } });
  for (const k of ALL) if (h.stats[k] !== undefined) h.stats[k] = BASE;
  for (const [k, v] of Object.entries(over)) h.stats[k] = v;
  return h;
}
const PAIRS = [
  { label: '短', over: { '速度': 100, '爆发力': 100, '耐力': 72, '毅力': 72 } },
  { label: '长', over: { '速度': 72, '爆发力': 72, '耐力': 100, '毅力': 100 } },
];
function runAt(S, length) {
  const field = PAIRS.map((p, i) => build(S, 'h' + i, p.over, 20261005 + i));
  const r = S.createRace(field, { length, profile: '平坦', rng: S.mulberry32(20261005) });
  let g = 0; while (!r.race.finished && g++ < 800000) r.step(1 / 30);
  const rows = r.race.horses.map(h => ({ id: h.id, time: h.time })); rows.sort((a, b) => a.time - b.time);
  return { w: PAIRS[Number(rows[0].id.slice(1))].label, t: rows[0].time, gap: rows[1].time - rows[0].time };
}
const TA = 66.98, TB = 198.71;
console.log('配置'.padEnd(28) + '1200m'.padEnd(22) + '3200m'.padEnd(22) + '专精 偏差');
console.log('-'.repeat(92));
const CF = [
  { bSpeed: 15.30 }, { bSpeed: 15.40 }, { bSpeed: 15.50 },
  { bSpeed: 15.30, resistanceK: 0.28 }, { bSpeed: 15.50, resistanceK: 0.28 },
  { bSpeed: 15.30, staminaPer: 33 },
];
for (const c of CF) {
  const S = require(patched(c));
  const a = runAt(S, 1200), d = runAt(S, 3200);
  const spec = (a.w === '短' && d.w === '长') ? 'OK' : '--';
  const dev = ((a.t / TA - 1) * 100).toFixed(1) + '% / ' + ((d.t / TB - 1) * 100).toFixed(1) + '%';
  const tag = `b${c.bSpeed}` + (c.resistanceK ? `/R${c.resistanceK}` : '') + (c.staminaPer ? `/sp${c.staminaPer}` : '');
  console.log(tag.padEnd(26) + (a.w + ' ' + a.t.toFixed(2) + ' (领先' + a.gap.toFixed(2) + ')').padEnd(24) +
    (d.w + ' ' + d.t.toFixed(2)).padEnd(22) + spec + '  ' + dev);
}
