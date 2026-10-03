#!/usr/bin/env node
'use strict';
// Read-only decomposition. Paired within-run identities precede aggregation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {readArchived}=require('./helpers/frozen-v8');
const {HASH,q,distribution:D}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),names=['current-engine-reality-sources-2026-10-02.json','system-external-reference-2022.json','system-current-v2026.10.02.3.json','system-current-external2022-v2026.10.02.3.json'];
function read(name){const raw=readArchived(path.join(ROOT,'docs',name)).toString('utf8');return {name,hash:HASH(raw),data:JSON.parse(raw)};}
const inputs=names.map(read),engineHash=HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'));
const events=[];
for(const [refs,matrix,context] of [[inputs[0].data,inputs[2].data,'external'],[inputs[1].data,inputs[3].data,'external2022']]){
 assert(matrix.integrity.complete&&matrix.integrity.sourceUnchanged);
 for(const r of refs.races){
  const runs=matrix.samples.filter(x=>x.context===context&&String(x.id)===String(r.id));assert.equal(runs.length,3);
  const winner=r.horses.find(h=>h.finishPosition===1),first200=r.raceSectionals200m[0];
  const pairs=runs.map(s=>{
   const startError=s.first200-first200,totalError=s.winnerTime-winner.finishTime,remainingError=(s.winnerTime-s.first200)-(winner.finishTime-first200);
   assert(Math.abs(totalError-startError-remainingError)<1e-10);
   const rounded=s.horses.map(h=>Math.round(h.time*10)/10),w=Math.min(...rounded);
   return {seed:s.seed,totalError,startError,remainingError,remainingLeaderMeanSpeedReal:(r.length-200)/(winner.finishTime-first200),remainingLeaderMeanSpeedSim:(r.length-200)/(s.winnerTime-s.first200),
    within1Raw:s.within1,within2Raw:s.within2,tailRaw:s.tailSeconds,within1Rounded:rounded.filter(t=>t-w<=1+1e-8).length/rounded.length,
    within2Rounded:rounded.filter(t=>t-w<=2+1e-8).length/rounded.length,tailRounded:Math.max(...rounded)-w};
  });
  events.push({id:r.id,length:r.length,state:r.state,context,real:{winnerTime:winner.finishTime,first200},pairs,
   median:Object.fromEntries(Object.keys(pairs[0]).filter(k=>k!=='seed').map(k=>[k,q(pairs.map(x=>x[k]))]))});
 }
}
const metrics=['totalError','startError','remainingError','remainingLeaderMeanSpeedReal','remainingLeaderMeanSpeedSim','within1Raw','within1Rounded','within2Raw','within2Rounded','tailRaw','tailRounded'];
const summarize=rows=>({events:rows.length,...Object.fromEntries(metrics.map(k=>[k,D(rows.map(x=>x.median[k]))]))});
const byDistance=[1200,1600,2000,2400,3000,3200].map(length=>({length,...summarize(events.filter(r=>r.length===length))}));
const report={engineHash,numericEngineHash:inputs[2].data.engineHash,inputs:inputs.map(({name,hash})=>({name,hash})),
 protocol:'24 official events; three simulated runs each. Per-run total error = start200 error + remaining200-to-finish error exactly. Medians of components need not add. Remaining leader speed is a leader-envelope time interval, not one horse GPS velocity. A one-decimal rounding diagnostic changes only recorded finish times, never trajectories. Synthetic fields do not reconstruct the real runners.',
 events,byDistance,primary:summarize(events.filter(r=>r.context==='external')),external2022:summarize(events.filter(r=>r.context==='external2022')),
 integrity:{complete:events.length===24&&byDistance.every(r=>r.events===4),inputUnchanged:inputs.every(x=>read(x.name).hash===x.hash),sourceUnchanged:HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'))===engineHash,allFinite:events.every(r=>r.pairs.every(p=>Object.values(p).every(Number.isFinite)))}};
assert(Object.values(report.integrity).every(Boolean));
fs.writeFileSync(path.join(ROOT,'docs/causal-residual-decomposition-v10.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({byDistance,primary:report.primary,integrity:report.integrity},null,2));
