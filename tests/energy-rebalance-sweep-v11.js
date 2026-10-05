// 第二轮：用能量侧旋钮(staminaPer)拉回长途用时，并定位「翻转点」落在哪个距离。
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

function patched({ aerobicPower, clampMax, bSpeed, staminaPer }) {
  let src = src0;
  const anchors = [
    ['aerobicPower:50, aerobicPerPoint:0.24, aerobicTau:10,', `aerobicPower:${aerobicPower}, aerobicPerPoint:0.24, aerobicTau:10,`],
    ["clamp(RACE_F.aerobicPower+(adj['耐力']-70)*RACE_F.aerobicPerPoint,35,68)",
     `clamp(RACE_F.aerobicPower+(adj['耐力']-70)*RACE_F.aerobicPerPoint,35,${clampMax})`],
    ['baseSpeed:{a:0.020,b:15.80,min:1,max:115}', `baseSpeed:{a:0.020,b:${bSpeed},min:1,max:115}`],
    ['staminaPer:35, gutsPer:60, energyScale:1,', `staminaPer:${staminaPer}, gutsPer:60, energyScale:1,`],
  ];
  for (const [a, r] of anchors) { if (!src.includes(a)) throw new Error('锚点缺失'); src = src.replace(a, r); }
  const f = path.join(os.tmpdir(), `rb2_${aerobicPower}_${clampMax}_${String(bSpeed).replace('.', 'p')}_${staminaPer}.js`);
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
  return { w: PAIRS[Number(rows[0].id.slice(1))].label, t: rows[0].time };
}
// 基线（未改）
const S0 = require(path.join(root, 'sim.js'));
const baseTimes = {};
for (const L of [1200, 1600, 2000, 2400, 3200]) baseTimes[L] = runAt(S0, L);
console.log('基线: ' + [1200, 1600, 2000, 2400, 3200].map(L => L + 'm ' + baseTimes[L].w + '型 ' + baseTimes[L].t.toFixed(1)).join(' | '));
console.log('');
const CONFIGS = [
  { aerobicPower: 58, clampMax: 76, bSpeed: 15.30, staminaPer: 33 },
  { aerobicPower: 58, clampMax: 76, bSpeed: 15.30, staminaPer: 30 },
  { aerobicPower: 60, clampMax: 78, bSpeed: 15.30, staminaPer: 32 },
];
for (const c of CONFIGS) {
  const S = require(patched(c));
  const parts = [], devs = [];
  for (const L of [1200, 1600, 2000, 2400, 3200]) {
    const r = runAt(S, L); parts.push(L + ':' + r.w + '(' + r.t.toFixed(1) + ')');
    devs.push((r.t / baseTimes[L].t - 1) * 100);
  }
  console.log(`ap${c.aerobicPower}/cm${c.clampMax}/b${c.bSpeed}/sp${c.staminaPer}`);
  console.log('   ' + parts.join('  '));
  console.log('   偏差%: ' + devs.map((d, i) => [1200, 1600, 2000, 2400, 3200][i] + 'm ' + d.toFixed(1)).join('  '));
}
