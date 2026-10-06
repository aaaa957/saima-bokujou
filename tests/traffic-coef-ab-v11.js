// A/B：车道系数缓存是否真的有净收益？
//   变体 base   —— 现状（嵌套 Map + 每步重建）
//   变体 nocache—— 直接调用 laneProgressCoef（完全去掉缓存）
//   变体 flat   —— 单层缓存：按 s 缓存 routeReferencePoint 的派生量
// 同时校验三者结果是否逐位一致（缓存不应改变数值）。只读——源码打补丁到临时文件。
//
// 用法：node tests/traffic-coef-ab-v11.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const src0 = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');

const A_FN = `    function trafficProgressCoef(s,t) {
      let lane=trafficProgressCache.get(t);
      if(lane){const value=lane.get(s);if(value!==undefined)return value;}
      const value=laneProgressCoef(s,t,geo);
      if(trafficProgressCacheSize>=16384){trafficProgressCache.clear();trafficProgressCacheSize=0;lane=null;}
      if(!lane){lane=new Map();trafficProgressCache.set(t,lane);}
      lane.set(s,value);trafficProgressCacheSize++;return value;
    }`;

const NOCACHE = `    function trafficProgressCoef(s,t) {
      return laneProgressCoef(s,t,geo);
    }`;

// 单层缓存：只按 s 缓存 routeReferencePoint(s) 的 (metric,k)，再按 t 求值。
const FLAT = `    let _tpcCache=new Map(),_tpcEpoch=0,_tpcLastS=NaN,_tpcLastR=null;
    function trafficProgressCoef(s,t) {
      let r;
      if(s===_tpcLastS) r=_tpcLastR;
      else {
        r=_tpcCache.get(s);
        if(r===undefined){const p=routeReferencePoint(s,geo);r=[p.metric??1,p.k];_tpcCache.set(s,r);}
        _tpcLastS=s;_tpcLastR=r;
      }
      const raw=1/(r[0]*(1+r[1]*(t-geo.referenceLane)));
      return 1+(raw-1)*RACE_F.laneBias;
    }`;

function patched(tag, repl) {
  let s = src0;
  if (!s.includes(A_FN)) throw new Error('锚点缺失');
  s = s.replace(A_FN, repl);
  const f = path.join(os.tmpdir(), `tpc_${tag}_${Date.now()}.js`);
  fs.writeFileSync(f, s);
  return f;
}

const DT = 1 / 30, N = 16, LEN = 2400;
const mk = i => {
  const h = S.makeHorse(() => 0.5, { id: 'h' + i, level: 86, surface: '草地', special: '左右皆可', jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(), behavior: { forwardness: .4 + (i % 3) * .2, settle: .6, tractability: .7 }, racePlan: { position: .4 + (i % 3) * .2, risk: .5, patience: .6 } });
  for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
  return h;
};
let S;
const STEPS = 400;
function bench(steps) {
  const r = S.createRace(Array.from({ length: N }, (_, i) => mk(i)), { length: LEN, profile: '平坦', rng: S.mulberry32(7) });
  const c0 = process.cpuUsage();
  for (let i = 0; i < steps; i++) r.step(DT);
  const c = process.cpuUsage(c0);
  const cpuSec = (c.user + c.system) / 1e6;          // ← 微秒 → 秒（踩过坑的单位）
  const rows = r.race.horses.map(h => ({ id: h.id, s: +h.s.toFixed(9), t: +h.t.toFixed(9), v: +h.v.toFixed(9), st: +h.stamina.toFixed(9) }));
  const dig = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  return { cpuSec, dig, t: r.race.t };
}

const variants = [
  ['base    (嵌套Map+每步重建)', []],
  ['nocache (直接调用)', [[A_FN, NOCACHE]]],
  ['flat    (单层按s缓存)', [[A_FN, FLAT]]],
];

console.log(`=== ${N}匹 @${LEN}m / ${STEPS} 步 / seed 7 ===`);
console.log('（cpuSec = 微秒/1e6，单位已核对）');
console.log('');
const results = {};
for (const [tag, repl] of variants) {
  S = require(patched(tag.split(/\s/)[0], repl.length ? repl[0][1] : A_FN));
  // 预热 + 5 轮取最小
  bench(30);
  const runs = [];
  let dig = null;
  for (let i = 0; i < 5; i++) { const r = bench(STEPS); runs.push(r.cpuSec); dig = r.dig; }
  const best = Math.min(...runs);
  results[tag] = { best, dig };
  console.log(tag.padEnd(30) + 'CPU=' + best.toFixed(2) + 's  摘要=' + dig);
}
const base = results['base    (嵌套Map+每步重建)'].best;
console.log('');
console.log('=== 相对 base 的加速 ===');
for (const [tag, v] of Object.entries(results)) {
  console.log('  ' + tag.padEnd(30) + (base / v.best).toFixed(3) + '×');
}
console.log('');
console.log('=== 逐位等价性（与 base 比较摘要） ===');
for (const [tag, v] of Object.entries(results)) {
  console.log('  ' + tag.padEnd(30) + (v.dig === results['base    (嵌套Map+每步重建)'].dig ? '✅ 逐位相同' : '❌ 不同 ' + v.dig));
}
