#!/usr/bin/env node
'use strict';
// Read-only summary of one candidate screen. Every metric and failed gate stays
// visible; no weighted scalar decides selection or hides correlated residuals.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {q,HASH}=require('./system-reality-v9'),{METRICS}=require('./race-validation-v11'),{audit}=require('./check-validation-v11');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);return i<0?value:args[i+1];};
const input=arg('--input'),output=arg('--out');assert(input&&output,'--input and --out required');
const bytes=fs.readFileSync(path.resolve(ROOT,input)),raw=bytes[0]===0x1f&&bytes[1]===0x8b?zlib.gunzipSync(bytes):bytes,report=JSON.parse(raw),proof=audit(input,args.includes('--allow-incomplete'));
const comparisons=report.comparisons,rows=report.samples;assert(rows.every(row=>row.kind==='race'),'This summary is for official-event candidate screens');
const summary={input,inputNormalizedSha256:HASH(raw.toString('utf8')),source:report.protocol.engineNormalizedSha256,parameters:report.protocol.parameters,cohort:report.protocol.cohort,proof,
  metrics:Object.fromEntries(METRICS.map(key=>[key,{realMedian:q(comparisons.map(c=>c.metrics[key].real)),simMedian:q(comparisons.map(c=>c.metrics[key].sim)),medianError:q(comparisons.map(c=>c.metrics[key].error)),meanAbsoluteError:comparisons.length?comparisons.reduce((sum,c)=>sum+Math.abs(c.metrics[key].error),0)/comparisons.length:null}])),
  eventResiduals:comparisons.map(c=>({id:c.id,length:c.length,metrics:Object.fromEntries(METRICS.map(key=>[key,{error:c.metrics[key].error,relativeError:c.metrics[key].relativeError}]))})),
  gateFailures:comparisons.flatMap(c=>Object.entries(c.gates).filter(([,passed])=>!passed).map(([gate])=>({id:c.id,gate}))),
  physical:{medianPost200ActualV:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.post200MeanPhysicalV))),medianPost200RequestedV:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.post200MeanRequest))),medianPeakV:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.peakV))),medianMeanActualPower:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.meanActualPower))),medianMeanOxygenOutput:q(rows.flatMap(r=>r.powerProfiles.map(h=>h.meanOxygenOutput))),medianFinishReserve:q(rows.flatMap(r=>r.horses.map(h=>h.reserve))),medianRunCpuSeconds:q(rows.map(r=>r.threadCpuSeconds)),medianRunWallSeconds:q(rows.map(r=>r.wallSeconds))},
  cohortDiagnostics:rows.map(r=>({id:r.id,inputHash:r.inputHash,diagnostics:r.fieldGenerationDiagnostics})),
  interpretation:'Training events with one predeclared seed per event are a basic calibration screen. All 12 residuals, failure gates, input hashes and power/reserve diagnostics remain separate. Generated entrants are distance/class proxies, not reconstructed real horses; changes in readiness selection prevent attributing outcomes to a single physical parameter.'};
fs.writeFileSync(path.resolve(ROOT,output),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({output,proof,metrics:summary.metrics,gateFailures:summary.gateFailures,physical:summary.physical}));
