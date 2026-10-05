#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),{HASH}=require('./system-reality-v9');
const {pairedComparison}=require('./race-validation-v11'),{audit}=require('./check-validation-v11');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),arg=key=>{const i=args.indexOf(key);assert(i>=0&&args[i+1],key+' required');return args[i+1];};
const current=arg('--current'),reference=arg('--reference'),output=arg('--out');
const read=file=>{const bytes=fs.readFileSync(path.resolve(ROOT,file)),raw=bytes[0]===0x1f&&bytes[1]===0x8b?zlib.gunzipSync(bytes):bytes;return {report:JSON.parse(raw.toString('utf8')),normalizedSha256:HASH(raw.toString('utf8'))};};
const a=read(current),b=read(reference),proof=[audit(current),audit(reference)],paired=pairedComparison(a.report,b.report);
assert.equal(paired.rows.length,a.report.samples.length);assert(paired.rows.every(row=>row.matchedJob),'Reports must cover identical event/seed settings before paired interpretation');
assert.equal(a.report.samples.length,b.report.samples.length,'Matched candidate screens must have equal coverage');
const parameterKeys=[...new Set([...Object.keys(a.report.protocol.parameters),...Object.keys(b.report.protocol.parameters)])],parameterDifferences=parameterKeys.filter(key=>JSON.stringify(a.report.protocol.parameters[key])!==JSON.stringify(b.report.protocol.parameters[key])).map(key=>({key,current:a.report.protocol.parameters[key],reference:b.report.protocol.parameters[key]}));
for(const pair of paired.rows){const row=a.report.samples.find(r=>r.jobKey===pair.jobKey),base=b.report.samples.find(r=>r.kind===row.kind&&r.id===row.id&&r.length===row.length&&r.seed===row.seed&&r.raceSeed===row.raceSeed&&r.replicate===row.replicate);assert(base);pair.id=row.id??null;pair.length=row.length;pair.seed=row.seed;
  if(row.kind==='race'){const reality=a.report.comparisons.find(c=>c.id===row.id).metrics;pair.absoluteResidualChanges=Object.fromEntries(Object.keys(reality).map(key=>[key,Math.abs(row[key]-reality[key].real)-Math.abs(base[key]-reality[key].real)]));}}
const report={current,reference,currentReportNormalizedSha256:a.normalizedSha256,referenceReportNormalizedSha256:b.normalizedSha256,currentSource:a.report.protocol.engineNormalizedSha256,referenceSource:b.report.protocol.engineNormalizedSha256,
  currentParameters:a.report.protocol.parameters,referenceParameters:b.report.protocol.parameters,parameterDifferences,proof,paired,
  interpretation:'Shared source isolates the selected global parameter configurations only when serialized entrant input is also identical. If readiness selection changes input, the paired event/seed contrast includes population selection as well as parameter effects. This tool performs no new race or forecast execution.'};
fs.writeFileSync(path.resolve(ROOT,output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,source:report.currentSource,rows:paired.rows.length,sameInputFields:paired.rows.filter(row=>row.sameInputField).length,proof}));
