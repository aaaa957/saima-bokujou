#!/usr/bin/env node
'use strict';
// Population support and ability-confounding review, no production edit.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {api,HASH,q}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'sim.js'),'utf8').replace(/\r\n/g,'\n');
const old="forwardness:0.5+((s['出闸能力']??70)-(s['爆发力']??70))*0.006+(r()-0.5)*0.5";
const replacement='forwardness:0.5-Math.sin(Math.asin(1-2*r())/3)';
const baselineSource=source.includes(old)?source:source.includes(replacement)?source.replace(replacement,old):null;
assert(baselineSource,'Freeze a recognized before/after behavioral prior');
assert.equal(baselineSource.split(old).length-1,1);
const original=api(baselineSource),proposed=api(baselineSource.replace(old,replacement)),cases=[];
const styles=['追','差','先','逃'];
function corr(a,b){const mean=x=>x.reduce((s,v)=>s+v,0)/x.length,ma=mean(a),mb=mean(b);let cov=0,va=0,vb=0;
 for(let i=0;i<a.length;i++){cov+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2;}return cov/Math.sqrt(va*vb);}
function summary(horses){const a=horses.map(h=>h.behavior.forwardness),gateBurst=horses.map(h=>h.stats['出闸能力']-h.stats['爆发力']);
 return {n:a.length,min:q(a,0),p10:q(a,.1),median:q(a),p90:q(a,.9),max:q(a,1),
  binProportions:[0,.1,.25,.5,.75,.9,1].slice(0,-1).map((lo,i)=>{const hi=[.1,.25,.5,.75,.9,1][i];return {lo,hi,n:a.filter(x=>x>=lo&&(i===5?x<=hi:x<hi)).length};}),
  intentionLabels:Object.fromEntries(styles.map(s=>[s,horses.filter(h=>h.style===s).length])),
  pearsonIntentVsGateMinusBurst:corr(a,gateBurst),meanGateMinusBurst:gateBurst.reduce((s,x)=>s+x,0)/gateBurst.length};}
for(const level of [35,70,86]){
 const fields=[original,proposed].map(S=>Array.from({length:1000},(_,i)=>S.makeHorse(S.mulberry32(8100+i),{id:'intent-'+i,level})));
 for(let i=0;i<1000;i++){
  assert.deepEqual(fields[0][i].stats,fields[1][i].stats);assert.deepEqual(fields[0][i].physiology,fields[1][i].physiology);
  assert.equal(fields[0][i].behavior.settle,fields[1][i].behavior.settle);assert.equal(fields[0][i].behavior.tractability,fields[1][i].behavior.tractability);
 }
 const result={level,original:summary(fields[0]),proposed:summary(fields[1]),sameStatsPhysiologyAndOtherBehavior:true};cases.push(result);console.log(JSON.stringify(result));
}
const saved={id:'saved',stats:{'出闸能力':20,'爆发力':97,'智力':70},behavior:{forwardness:.9,settle:.2,tractability:.75}};
assert.deepEqual(proposed.horseBehavior(saved),original.horseBehavior(saved));
const oldHorse={id:'old-stable',stats:{'出闸能力':20,'爆发力':97,'智力':70}},newSkills=structuredClone(oldHorse);newSkills.stats['出闸能力']=97;newSkills.stats['爆发力']=20;
assert.equal(proposed.horseBehavior(oldHorse).forwardness,proposed.horseBehavior(newSkills).forwardness);
const report={generatedAt:new Date().toISOString(),sourceHash:HASH(source),baselineSourceHash:HASH(baselineSource),proposedSourceHash:HASH(baselineSource.replace(old,replacement)),
 productionSourceUnchanged:HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===HASH(source),
 fixture:{old,new:replacement},scope:'1000 deterministic newly generated horses per level. Proposed Beta(2,2) preference prior consumes the same one RNG draw, independent of physical ability; no win-rate tuning.',
 proposedPrior:{distribution:'Beta(2,2)',cdf:'3*x*x - 2*x*x*x',expectedAbove075:.15625,expectedBelow025:.15625,expectedAbove09:.028,expectedBelow01:.028},
 savedBehaviorPreserved:true,missingBehaviorStableAcrossAbilityChanges:true,cases};
fs.writeFileSync(path.join(root,'docs/behavior-intent-review-v11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:4,sourceHash:report.sourceHash,productionSourceUnchanged:report.productionSourceUnchanged}));
