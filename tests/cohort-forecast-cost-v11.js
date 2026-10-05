#!/usr/bin/env node
'use strict';
// Performance-only equivalence: production files are read once and never edited.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {api,HASH}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'sim.js'),'utf8').replace(/\r\n/g,'\n');
const old=String.raw`    let low=3,high=H.maxV,best=H.finishPlan(low,0);
    for(let i=0;i<9;i++){
      const requested=(low+high)/2,forecast=H.finishPlan(requested,0);
      if(forecast.feasible){low=requested;best=forecast;}else high=requested;
    }`;
const replacement=String.raw`    let low=3,high=H.maxV,best=null;
    for(let i=0;i<9;i++){
      const requested=(low+high)/2,forecast=H.finishPlan(requested,0,{earlyExit:true});
      if(forecast.feasible){low=requested;best=forecast;}else high=requested;
    }
    if(!best)best=H.finishPlan(low,0);`;
const baselineSource=source.includes(old)?source:source.includes(replacement)?source.replace(replacement,old):null;
assert(baselineSource,'Freeze a recognized before/after forecast fragment');
assert.equal(baselineSource.split(old).length-1,1);
const expose='H.finishPlan=(requestedV,draftDistance=0,options={})=>finishPlan(H,requestedV,draftDistance,options);';
assert.equal(source.split(expose).length-1,1);
function measuredSource(text){return text.replace(expose,
 `H.finishPlan=(requestedV,draftDistance=0,options={})=>{const result=finishPlan(H,requestedV,draftDistance,options);globalThis.__cohortForecastCost.push({steps:result.steps,feasible:result.feasible,complete:result.complete,earlyExit:!!options.earlyExit,request:requestedV});return result;};`);}
const baseline=api(measuredSource(baselineSource)),optimized=api(measuredSource(baselineSource.replace(old,replacement))),cases=[];
for(const spec of [{level:70,length:1200,seed:178},{level:86,length:3200,seed:409}]){
 const pool=baseline.makeRaceCandidatePool(baseline.mulberry32(spec.seed),{n:12,level:spec.level,
   entryOverrides:{surface:'草地',special:'左右皆可','疲劳':0,'斗志':50,bodyMass:480,carriedWeight:57}});
 const opts={n:8,level:spec.level,race:{length:spec.length,course:'標準',surface:'草地',state:'良',profile:'平坦',dir:'左回'}};
 const runs=[baseline,optimized].map(S=>{
   globalThis.__cohortForecastCost=[];const start=performance.now(),cpu=process.cpuUsage();
   const result=S.selectRaceCohort(structuredClone(pool),S.mulberry32(20001),opts);
   return {result,milliseconds:performance.now()-start,cpuMicroseconds:process.cpuUsage(cpu),
     calls:globalThis.__cohortForecastCost.length,steps:globalThis.__cohortForecastCost.reduce((sum,f)=>sum+f.steps,0),
     infeasibleCalls:globalThis.__cohortForecastCost.filter(f=>!f.feasible).length,
     incompleteEarlyExitCalls:globalThis.__cohortForecastCost.filter(f=>f.earlyExit&&!f.complete).length};
 });
 assert.deepEqual(runs[1].result,runs[0].result,'Every selected identity, classification and published forecast must remain exact');
 const result={...spec,exactSelectionAndForecastEquality:true,selectedIds:runs[0].result.horses.map(h=>h.id),
   baseline:{...runs[0],result:undefined},optimized:{...runs[1],result:undefined},
   stepReduction:1-runs[1].steps/runs[0].steps,wallRatio:runs[1].milliseconds/runs[0].milliseconds};
 cases.push(result);console.log(JSON.stringify(result));
}
delete globalThis.__cohortForecastCost;
const report={generatedAt:new Date().toISOString(),sourceHash:HASH(source),baselineSourceHash:HASH(baselineSource),optimizedSourceHash:HASH(baselineSource.replace(old,replacement)),
 productionSourceUnchanged:HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===HASH(source),
 scope:'Same nine bisections and shared full feasible projections; only skip unused minimum-speed run and abort irrevocably infeasible demand.',
 fixture:{old,new:replacement},cases};
fs.writeFileSync(path.join(root,'docs/cohort-forecast-cost-v11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:cases.length,sourceHash:report.sourceHash,productionSourceUnchanged:report.productionSourceUnchanged}));
