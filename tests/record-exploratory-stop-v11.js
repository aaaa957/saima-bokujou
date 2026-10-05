#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {HASH}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),phase=process.argv[2],prefix='docs/calibration-screen-v11-headway.json',recordFile=path.join(ROOT,'docs/calibration-screen-v11-stop.json'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert(['before','after'].includes(phase),'before/after required');
const files=[prefix,prefix+'.source.js.gz',prefix+'.driver.js.gz',prefix+'.orchestrator.js.gz'],bytes=files.map(file=>fs.readFileSync(path.join(ROOT,file))),report=JSON.parse(bytes[0]);
assert.equal(report.protocol.sourceNormalizedSha256,'e1bd832dbe954407d9fa7c44a12aa535881d8e2ab46fee8cb6a234033ccdb56f');assert.equal(HASH(JSON.stringify(report.protocol)),report.protocolHash);assert.equal(report.protocol.jobs.length,24);
const evidence={at:new Date().toISOString(),files:files.map((file,i)=>({file,byteSha256:sha(bytes[i]),bytes:bytes[i].length})),completeRows:report.samples.length,unfinishedDeclaredJobs:report.protocol.jobs.length-report.samples.length,retainedErrors:report.errors.length,passedEngineeringRows:report.samples.filter(row=>row.engineering.passed).length};
fs.writeFileSync(path.join(ROOT,prefix+'.'+phase+'-stop-checkpoint'),bytes[0]);
if(phase==='before'){
  assert(!fs.existsSync(recordFile),'Stop record already exists; do not overwrite history');
  fs.writeFileSync(recordFile,JSON.stringify({reason:'Root explicitly stopped the obsolete exploratory six-arm source after a newer coarse-first/rank controller was adopted. The stop changes the exploration plan because of strategy replacement and measured compute cost, not because unfavorable numerical rows should be dropped.',pidVerifiedBeforeStop:15172,commandVerified:'node --max-old-space-size=192 tests/calibrate-validation-v11.js --source docs/race-validation-v11-mechanism-screen-source.js.gz --expected-source e1bd832dbe954407d9fa7c44a12aa535881d8e2ab46fee8cb6a234033ccdb56f --workers 2 --out docs/calibration-screen-v11-headway.json',before:evidence,knownProgress:'Completed rows are retained verbatim. At stopping, exact physical progress of the uncompleted running job is unknown; it is not counted as zero executions or as a completed full race. Remaining declared jobs are not claimed covered.'},null,2)+'\n');
}else{
  const record=JSON.parse(fs.readFileSync(recordFile,'utf8'));record.afterTermination=evidence;
  for(let i=1;i<files.length;i++)assert.equal(evidence.files[i].byteSha256,record.before.files[i].byteSha256,'Frozen archive changed during stop');
  report.errors.push({type:'administrative-exploratory-stop',at:evidence.at,reason:record.reason,uncompletedRunningJobSteppedProgress:'unknown',completedRowsRetained:report.samples.length});
  report.closed=true;report.integrity.complete=false;report.integrity.passedEngineering=false;report.administrativeStop={...evidence,reason:record.reason,scope:'All retained rows remain engineering-passed; this source is incomplete exploration, not a completed or failed-physics final validation.'};
  fs.writeFileSync(path.join(ROOT,prefix),JSON.stringify(report)+'\n');record.annotatedReportByteSha256=sha(fs.readFileSync(path.join(ROOT,prefix)));fs.writeFileSync(recordFile,JSON.stringify(record,null,2)+'\n');
}
console.log(JSON.stringify({phase,...evidence}));
