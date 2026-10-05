#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {q,HASH}=require('./system-reality-v9'),{METRICS,references}=require('./race-validation-v11'),{audit}=require('./check-validation-v11');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);return i<0?value:args[i+1];};
const requestedInput=arg('--input','docs/calibration-screen-v11-headway.json');
const input=fs.existsSync(path.resolve(ROOT,requestedInput))?requestedInput:requestedInput+'.gz';
const bytes=fs.readFileSync(path.resolve(ROOT,input));
const raw=(bytes[0]===0x1f&&bytes[1]===0x8b?require('node:zlib').gunzipSync(bytes):bytes).toString('utf8');
const report=JSON.parse(raw),proof=audit(input,args.includes('--allow-incomplete')),ref=references();
assert(Array.isArray(report.arms),'Expected multi-arm calibration grid');
const arms=report.arms.map(arm=>{const rows=report.samples.filter(row=>row.gridVariant===arm.name),metrics=Object.fromEntries(METRICS.map(key=>[key,{realMedian:q(arm.comparisons.map(c=>c.metrics[key].real)),simMedian:q(arm.comparisons.map(c=>c.metrics[key].sim)),medianError:arm.metrics[key].medianError,meanAbsoluteError:arm.metrics[key].meanAbsoluteError}]));
  return {name:arm.name,completed:rows.length,metrics,gateFailures:arm.gateFailures,engineeringFailures:arm.engineeringFailures,
    physical:{medianPost200ActualV:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.post200MeanPhysicalV))),medianPost200RequestedV:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.post200MeanRequest))),medianPeakV:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.peakV))),medianMeanActualPower:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.meanActualPower))),medianMeanOxygenOutput:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.meanOxygenOutput))),medianFinishReserve:q(rows.flatMap(r=>r.horses.map(h=>h.reserve))),medianRunCpuSeconds:q(rows.map(r=>r.threadCpuSeconds)),medianRunWallSeconds:q(rows.map(r=>r.wallSeconds))}};
});
const completeArms=arms.filter(a=>a.completed===4),current=arms.find(a=>a.name==='current');
for(const arm of arms){arm.meanAbsoluteResidualChangeFromCurrent=current&&arm!==current?Object.fromEntries(METRICS.map(key=>[key,arm.metrics[key].meanAbsoluteError-current.metrics[key].meanAbsoluteError])):null;
  arm.paretoDominatedBy=completeArms.filter(other=>other!==arm&&METRICS.every(key=>other.metrics[key].meanAbsoluteError<=arm.metrics[key].meanAbsoluteError+1e-10)&&METRICS.some(key=>other.metrics[key].meanAbsoluteError<arm.metrics[key].meanAbsoluteError-1e-10)).map(a=>a.name);}
const summary={input,inputNormalizedSha256:HASH(raw),source:report.protocol.sourceNormalizedSha256,cohort:report.protocol.cohort,proof,arms,
  scope:'Four 2023/2024 real events, one simulated seed each per parameter arm. Event medians/errors and all 12 metrics remain separate; no scalar weighting hides correlated start/total/pack metrics. Physical medians across generated horses are mechanism diagnostics, not matched real GPS/power observations. Pareto domination is strict across all 12 event-weighted MAEs and is not evidence of generalization.'};
const output=arg('--out',input.replace(/\.json(?:\.gz)?$/,'.summary.json'));fs.writeFileSync(path.resolve(ROOT,output),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({output,proof,arms:arms.map(a=>({name:a.name,completed:a.completed,medianErrors:Object.fromEntries(['winnerTime','first200','winnerFinal600','remainingSpeed','tailSeconds','within1','within2','post200Cv'].map(k=>[k,a.metrics[k].medianError])),gateFailures:a.gateFailures,physical:a.physical,paretoDominatedBy:a.paretoDominatedBy}))}));
