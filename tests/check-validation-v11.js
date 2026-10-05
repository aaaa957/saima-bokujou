#!/usr/bin/env node
'use strict';
// Read-only audit of persisted measurements, including cohort-selection state.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {HASH}=require('./system-reality-v9'),{engineering,compare,references}=require('./race-validation-v11');
const ROOT=path.resolve(__dirname,'..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function audit(file,allowIncomplete=false){
  const bytes=fs.readFileSync(path.resolve(ROOT,file)),raw=bytes[0]===0x1f&&bytes[1]===0x8b?require('node:zlib').gunzipSync(bytes):bytes,report=JSON.parse(raw.toString('utf8')),declared=new Map(report.protocol.jobs.map(job=>[sha(JSON.stringify(job)),job])),seen=new Set(),failures=[];
  const originalFile=file.endsWith('.json.gz')?file.slice(0,-3):file;
  const multipleArms=Array.isArray(report.arms),execution=report.execution||{closed:report.closed,sourceSnapshotArtifact:originalFile+'.source.js.gz',driverSnapshotArtifact:originalFile+'.driver.js.gz',driverNormalizedSha256:report.protocol.driverNormalizedSha256};
  assert.equal(HASH(JSON.stringify(report.protocol)),report.protocolHash,'Protocol hash mismatch');
  assert.equal(declared.size,report.protocol.jobs.length,'Duplicate declared jobs');
  const currentRefs=references();assert.deepEqual(report.protocol.referenceHashes,currentRefs.hashes,'Reference changed since measurement');
  let sourceProof='legacy smoke has no archived source';
  const engineHash=report.protocol.engineNormalizedSha256||report.protocol.sourceNormalizedSha256;
  if(execution.sourceSnapshotArtifact){const snapshot=require('node:zlib').gunzipSync(fs.readFileSync(path.join(ROOT,execution.sourceSnapshotArtifact))).toString('utf8');assert.equal(HASH(snapshot),engineHash,'Archived engine source mismatch');sourceProof='archived immutable source verified';}
  if(execution.driverSnapshotArtifact){const driver=require('node:zlib').gunzipSync(fs.readFileSync(path.join(ROOT,execution.driverSnapshotArtifact))).toString('utf8');assert.equal(HASH(driver),execution.driverNormalizedSha256,'Archived validation driver mismatch');}
  let metadataRows=0;
  for(const row of report.samples){
    assert(declared.has(row.jobKey)&&!seen.has(row.jobKey),'Foreign or duplicate row');seen.add(row.jobKey);const job=declared.get(row.jobKey);
    for(const [key,value] of Object.entries(job))assert.deepEqual(row[key],value,'Job identity mismatch: '+key);
    assert(Number.isInteger(row.frames)&&row.frames>0&&row.inputHash,'Invalid frame count or input hash');
    assert.equal(row.horses.length,row.n,'Missing horses');assert.equal(new Set(row.horses.map(h=>h.id)).size,row.n,'Duplicate horse identity');
    for(const h of row.horses){const ss=h.sectionals;assert(Array.isArray(ss),'Missing sectional array');if(row.completed)assert(ss.length>=3,'Completed start lacks600 marker');let previous=0;
      for(let i=0;i<ss.length;i++){assert.equal(ss[i].distance,(i+1)*200);if(row.finite){assert(Number.isFinite(ss[i].time)&&ss[i].time>previous&&Number.isFinite(ss[i].split)&&ss[i].split>0);
        assert(Math.abs(ss[i].time-previous-ss[i].split)<1e-8,'Sectional inconsistency');}previous=ss[i].time;}
      if(row.completed&&(row.kind==='race'||row.kind==='forecast')){assert.equal(ss.length,row.length/200,'Incomplete completed-race sectionals');assert(Math.abs(previous-h.time)<1e-8,'Finish/sectional disagreement');}
    }
    assert.deepEqual(row.engineering,engineering(row,row.kind),'Saved engineering check mismatch');
    if(!row.engineering.passed)failures.push({jobKey:row.jobKey,failedChecks:row.engineering.failedChecks});
    if(row.fieldGenerationDiagnostics){metadataRows++;const d=row.fieldGenerationDiagnostics;assert.equal(d.selected,row.n);assert.equal(d.entries.length,row.n);
      assert.equal(d.fallback,d.entries.filter(e=>!e.eligible).length,'Fallback count does not match selected entries');
      assert(d.eligible>=0&&d.shortage>=0&&d.candidates>=row.n,'Invalid selection counts');
      for(const e of d.entries){const actual=row.parameters.find(h=>h.id===e.id);assert(actual,'Selection identity not in executed race');
        for(const key of ['capacity','aerobic','maxV'])assert(Math.abs(e.forecast[key]-actual[key])<1e-8,'Selection/actual initial-state mismatch '+key+' '+e.id);}
    }
  }
  for(const e of report.errors)if(e.jobKey){assert(declared.has(e.jobKey)&&!seen.has(e.jobKey),'Foreign or duplicate retained failure');seen.add(e.jobKey);}
  const complete=seen.size===declared.size&&execution.closed;
  assert.equal(report.integrity.complete,complete,'Completion declaration mismatch');
  if(!allowIncomplete)assert(complete,'Report is incomplete; do not claim final validation');
  if(multipleArms)for(const arm of report.arms)assert.deepEqual(arm.comparisons,compare(report.samples.filter(r=>r.gridVariant===arm.name),currentRefs.races),'Stored candidate comparisons differ from raw results');
  else assert.deepEqual(report.comparisons,compare(report.samples,currentRefs.races),'Stored comparison differs from raw results');
  const forecasts=report.samples.filter(r=>r.prediction),feasible=forecasts.filter(r=>r.prediction.feasible);
  return {file,sourceProof,source:engineHash,declared:declared.size,covered:seen.size,complete,metadataRows,retainedErrors:report.errors.length,retainedEngineeringFailures:failures,
    forecastCoverage:{queries:forecasts.length,feasible:feasible.length,infeasible:forecasts.length-feasible.length,maxFeasibleTimeError:feasible.length?Math.max(...feasible.map(r=>Math.abs(r.prediction.timeError))):null},consistent:true};
}
if(require.main===module){const args=process.argv.slice(2),i=args.indexOf('--input');assert(i>=0&&args[i+1],'--input report path required');console.log(JSON.stringify(audit(args[i+1],args.includes('--allow-incomplete')),null,2));}
module.exports={audit};
