#!/usr/bin/env node
'use strict';
// Proves the whole performance-only patch set (route-key cursor, single-pass
// wake/front selection, de-duplicated projection copy) is bit-identical to the
// frozen v11 source. Every patch is applied to the frozen source text, so the only
// difference under test is the optimisation itself.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto'), os = require('node:os');
const root = path.resolve(__dirname, '..');
const frozen = zlib.gunzipSync(fs.readFileSync(path.join(root, 'docs/race-validation-v11-final-source-v2026.10.04.1.js.gz'))).toString('utf8');

const patches = [
  [ // 1. route-key cursor
    '          const nextKey=routeCorners.find(s=>s>local.s+1e-6);',
    '          const nextKey=nextRouteKey(local.s);',
  ],
  [ // 2. cursor helper
    '      const opponents=multipleOpponents?options.opponents.map(observation).filter((F,i,a)=>a.indexOf(F)===i):[];\n      function run(action,isTail,index) {',
    `      const opponents=multipleOpponents?options.opponents.map(observation).filter((F,i,a)=>a.indexOf(F)===i):[];
      let cornerCursor=0;
      function nextRouteKey(s) {
        while(cornerCursor>0&&routeCorners[cornerCursor-1]>s+1e-6)cornerCursor--;
        while(cornerCursor<routeCorners.length&&routeCorners[cornerCursor]<=s+1e-6)cornerCursor++;
        return cornerCursor<routeCorners.length?routeCorners[cornerCursor]:undefined;
      }
      function run(action,isTail,index) {`,
  ],
  [ // 3. single pass instead of filter+slice+sort+find
    `          const activeVisible=visible.filter(F=>!F.finished),ordered=activeVisible.slice().sort((a,b)=>a.s-b.s);
          const wake=ordered.find(F=>projectionWake(local,F))||null;
          const drafting=!!wake||!activeVisible.length&&(action.draft===true||Number.isFinite(action.draftUntil)&&local.s<action.draftUntil);
          const front=ordered.find(F=>F.s>local.s&&Math.abs(F.t-local.t)<(followingBodyWidth(local)+followingBodyWidth(F))/2+0.2)||null;`,
    `          const activeVisible=[];
          let wake=null,front=null;
          for(const F of visible) {
            if(F.finished)continue;
            activeVisible.push(F);
            if(projectionWake(local,F)&&(wake===null||F.s<wake.s))wake=F;
            if(F.s>local.s&&Math.abs(F.t-local.t)<(followingBodyWidth(local)+followingBodyWidth(F))/2+0.2&&
              (front===null||F.s<front.s))front=F;
          }
          const drafting=!!wake||!activeVisible.length&&(action.draft===true||Number.isFinite(action.draftUntil)&&local.s<action.draftUntil);`,
  ],
  [ // 4. share read-only nested objects
    '      return {...H,adj:{...H.adj},behavior:{...H.behavior},statsSummary:{...H.statsSummary}};',
    '      return {...H};',
  ],
  [ // 5. only the three fields actually read back
    '      const local=projectionCopy(H),initial=projectionCopy(H),atTime=race.t;',
    '      const local=projectionCopy(H),initial={s:H.s,t:H.t,v:H.v},atTime=race.t;',
  ],
];
let patched = frozen;
for (const [from, to] of patches) {
  if (!patched.includes(from)) throw new Error('patch anchor not found: ' + from.slice(0, 60));
  patched = patched.replace(from, to);
}
if (patched === frozen) throw new Error('no patch applied');

const A = path.join(os.tmpdir(), 'perfeq-A-frozen.js'), B = path.join(os.tmpdir(), 'perfeq-B-perfonly.js');
fs.writeFileSync(A, frozen); fs.writeFileSync(B, patched);

function runRace(file, length, horses) {
  delete require.cache[require.resolve(file)];
  const S = require(file);
  const field = Array.from({ length: horses }, (_, i) => {
    const h = S.makeHorse(() => 0.5, { id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
      jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
      physiology: S.neutralPhysiology(), behavior: { forwardness: 0.4 + (i % 3) * 0.2, settle: 0.6, tractability: 0.7 },
      racePlan: { position: 0.4 + (i % 3) * 0.2, risk: 0.5, patience: 0.6 } });
    for (const k of Object.keys(h.stats)) h.stats[k] = 80 + (i % 5);
    return h;
  });
  const race = S.createRace(field, { length, profile: '平坦', rng: S.mulberry32(20261004) });
  let g = 0;
  while (!race.race.finished && g++ < 400000) race.step(1 / 30);
  const rows = race.race.horses.map(h => ({
    id: h.id, time: h.time, place: h.place, s: h.s, t: h.t, stamina: h.stamina, guts: h.guts,
    workUsed: h.statsSummary.workUsed, energyUsed: h.statsSummary.energyUsed,
    recovered: h.statsSummary.recovered, unpaidWork: h.statsSummary.unpaidWork,
    peakSpeed: h.statsSummary.peakSpeed, launches: h.statsSummary.launches || 0,
    withdrawals: h.statsSummary.withdrawals || 0, blockedSeconds: h.statsSummary.blockedSeconds,
    sprintAt: h.sprintAt, draftingSeconds: h.statsSummary.draftSeconds,
  }));
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') + '  t=' + race.race.t.toFixed(6) + ' steps=' + g;
}
let bad = 0;
for (const [len, n] of [[1200, 8], [1600, 8], [2000, 8]]) {
  const a = runRace(A, len, n), b = runRace(B, len, n);
  const same = a === b;
  if (!same) bad++;
  console.log(`${n} horses @ ${len}m\n  frozen        : ${a}\n  perf-only set : ${b}\n  ${same ? 'IDENTICAL (bit-for-bit)' : '*** DIFFERENT ***'}`);
}
console.log(bad ? `\n${bad} configuration(s) differ` : '\nAll configurations bit-for-bit identical under the performance-only patch set.');
process.exit(bad ? 1 : 0);
