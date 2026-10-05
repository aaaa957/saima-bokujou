#!/usr/bin/env node
'use strict';
// Measures the per-step cost of the frozen source against each isolated,
// proven-equivalent optimization so the gain of every change is attributable.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), os = require('node:os');
const root = path.resolve(__dirname, '..');
const frozen = zlib.gunzipSync(fs.readFileSync(path.join(root, 'docs/race-validation-v11-final-source-v2026.10.04.1.js.gz'))).toString('utf8');

const OLD_FIND = '          const nextKey=routeCorners.find(s=>s>local.s+1e-6);';
const NEW_FIND = '          const nextKey=nextRouteKey(local.s);';
const ANCHOR = '      const opponents=multipleOpponents?options.opponents.map(observation).filter((F,i,a)=>a.indexOf(F)===i):[];\n      function run(action,isTail,index) {';
const CURSOR = `      const opponents=multipleOpponents?options.opponents.map(observation).filter((F,i,a)=>a.indexOf(F)===i):[];
      let cornerCursor=0;
      function nextRouteKey(s) {
        while(cornerCursor>0&&routeCorners[cornerCursor-1]>s+1e-6)cornerCursor--;
        while(cornerCursor<routeCorners.length&&routeCorners[cornerCursor]<=s+1e-6)cornerCursor++;
        return cornerCursor<routeCorners.length?routeCorners[cornerCursor]:undefined;
      }
      function run(action,isTail,index) {`;
const cursorSrc = frozen.replace(OLD_FIND, NEW_FIND).replace(ANCHOR, CURSOR);
const OLD_SORT = `          const activeVisible=visible.filter(F=>!F.finished),ordered=activeVisible.slice().sort((a,b)=>a.s-b.s);
          const wake=ordered.find(F=>projectionWake(local,F))||null;
          const drafting=!!wake||!activeVisible.length&&(action.draft===true||Number.isFinite(action.draftUntil)&&local.s<action.draftUntil);
          const front=ordered.find(F=>F.s>local.s&&Math.abs(F.t-local.t)<(followingBodyWidth(local)+followingBodyWidth(F))/2+0.2)||null;`;
const NEW_SORT = `          const activeVisible=[];
          let wake=null,front=null;
          for(const F of visible) {
            if(F.finished)continue;
            activeVisible.push(F);
            if(projectionWake(local,F)&&(wake===null||F.s<wake.s))wake=F;
            if(F.s>local.s&&Math.abs(F.t-local.t)<(followingBodyWidth(local)+followingBodyWidth(F))/2+0.2&&
              (front===null||F.s<front.s))front=F;
          }
          const drafting=!!wake||!activeVisible.length&&(action.draft===true||Number.isFinite(action.draftUntil)&&local.s<action.draftUntil);`;
const noSortSrc = cursorSrc.replace(OLD_SORT, NEW_SORT);
const OLD_COPY = '      return {...H,adj:{...H.adj},behavior:{...H.behavior},statsSummary:{...H.statsSummary}};';
const NEW_COPY = '      return {...H};';
const OLD_INIT = '      const local=projectionCopy(H),initial=projectionCopy(H),atTime=race.t;';
const NEW_INIT = '      const local=projectionCopy(H),initial={s:H.s,t:H.t,v:H.v},atTime=race.t;';
const noCopySrc = noSortSrc.replace(OLD_COPY, NEW_COPY).replace(OLD_INIT, NEW_INIT);

const variants = {
  'frozen (309e6ad6)': frozen,
  'frozen + cursor': cursorSrc,
  'frozen + cursor + nosort': noSortSrc,
  'frozen + cursor + nosort + copy': noCopySrc,
  'working tree (all fixes)': fs.readFileSync(path.join(root, 'sim.js'), 'utf8'),
};
const files = {};
for (const [name, src] of Object.entries(variants)) {
  const f = path.join(os.tmpdir(), 'perf-' + name.replace(/[^a-z0-9]+/gi, '_') + '.js');
  fs.writeFileSync(f, src); files[name] = f;
}
function bench(file, horses, length, steps) {
  delete require.cache[require.resolve(file)];
  const S = require(file);
  const field = Array.from({ length: horses }, (_, i) => {
    const h = S.makeHorse(() => 0.5, { id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
      jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57, physiology: S.neutralPhysiology(),
      behavior: { forwardness: 0.4 + (i % 3) * 0.2, settle: 0.6, tractability: 0.7 },
      racePlan: { position: 0.4 + (i % 3) * 0.2, risk: 0.5, patience: 0.6 } });
    for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
    return h;
  });
  const race = S.createRace(field, { length, profile: '平坦', rng: S.mulberry32(20261004) });
  for (let i = 0; i < 12; i++) race.step(1 / 30);
  // Wall clock on a 4-core laptop varies by 30-60% between rounds, which is larger
  // than the effects being attributed. CPU time is the honest currency here.
  const c0 = process.cpuUsage();
  for (let i = 0; i < steps; i++) race.step(1 / 30);
  const c = process.cpuUsage(c0);
  return (c.user + c.system) / 1000 / steps;
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const ROUNDS = 3, STEPS = 40;
for (const [n, len] of [[8, 2000], [16, 2400]]) {
  console.log(`\n=== ${n} horses @ ${len}m  (median of ${ROUNDS} interleaved rounds, ${STEPS} steps each) ===`);
  const samples = Object.fromEntries(Object.keys(files).map(k => [k, []]));
  for (const k of Object.keys(files)) bench(files[k], n, len, 8);
  for (let r = 0; r < ROUNDS; r++) {
    const order = Object.keys(files);
    if (r % 2) order.reverse();
    for (const name of order) samples[name].push(bench(files[name], n, len, STEPS));
  }
  const base = med(samples['frozen (309e6ad6)']);
  for (const [name, arr] of Object.entries(samples)) {
    console.log(`  ${name.padEnd(26)} ${med(arr).toFixed(2)} ms/step   ${(base / med(arr)).toFixed(3)}x vs frozen   [${arr.map(v => v.toFixed(1)).join(' ')}]`);
  }
}
