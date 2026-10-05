#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {api,HASH}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'sim.js'),'utf8');
const S=api(source);
console.log('sourceHash',HASH(source));

function horse(id,position=.5){
  const h=S.makeHorse(()=>.5,{id,name:id,level:70,surface:'草地',special:'左右皆可',jockeyGrade:'优秀',
    '斗志':50,'疲劳':0,bodyMass:480,carriedWeight:57,physiology:S.neutralPhysiology(),
    behavior:{forwardness:position,settle:.6,tractability:.8},racePlan:{position,risk:.5,patience:.6}});
  for(const key of Object.keys(h.stats))h.stats[key]=70;return h;
}
const race=(field,opts={})=>S.createRace(field,{length:1200,course:'标准',profile:'平坦',rng:S.mulberry32(2026101103),...opts});

for(const length of [1200,2400]){
  const out=[];
  for(const intent of [.1,.9]){
    const r=race(Array.from({length:8},(_,i)=>horse('launch-'+i,intent)),{length});
    r.step(1/60);
    const h=r.race.horses[0];
    const cands=(h.planning&&h.planning.candidates)||[];
    out.push({intent,
      meanRequest:r.race.horses.reduce((s,x)=>s+x.targetV,0)/8,
      firstRequest:h.targetV,
      selected:h.planning&&h.planning.selected,
      selectedScore:h.planning&&h.planning.selectedScore,
      cands:cands.map(c=>({mode:c.mode,score:c.score,targetV:c.targetV,targetT:c.targetT}))});
  }
  console.log('\n===== length',length,'=====');
  out.forEach(o=>{
    console.log('intent',o.intent,'| meanReq',o.meanRequest.toFixed(4),'| horse0 req',o.firstRequest.toFixed(4),'| selected',o.selected);
    o.cands.forEach(c=>console.log('    cand',c.mode,'score=',(c.score===undefined||c.score===null?'null':c.score.toFixed(4)),'targetV=',(c.targetV===undefined?null:c.targetV.toFixed(3))));
  });
  console.log('meanRequest delta (.9-.1) =',(out[1].meanRequest-out[0].meanRequest).toFixed(4));
  const s0=out[0].cands.find(c=>c.mode==='start-position');
  const s1=out[1].cands.find(c=>c.mode==='start-position');
  console.log('start-position score .1/.9 =',s0?s0.score:'none','/',s1?s1.score:'none');
}
