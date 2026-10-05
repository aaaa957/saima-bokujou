#!/usr/bin/env node
'use strict';
// Compose review fixtures in memory; never call the installer that writes files.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{gunzipSync}=require('node:zlib');
const {HASH}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..'),patch=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/race-cohort-v11.patch'),'utf8'));
const baselineArchive=path.join(root,'docs/race-validation-v11-baseline-external.json.source.js.gz');
const baseline=gunzipSync(fs.readFileSync(baselineArchive)).toString('utf8').replace(/\r\n/g,'\n');
assert.equal(HASH(baseline),patch.baseEngineHash,'Archived initial validation source must match registered fixture baseline');
let rebuilt=require('./fixtures/race-prediction-v11-install').applyPredictionPatch(baseline);
rebuilt=require('./fixtures/rider-controller-v11').applyController(rebuilt);
const counts=[];
for(const c of patch.changes.filter(c=>c.file==='sim.js')){
 const count=rebuilt.split(c.old).length-1;assert.equal(count,1,'Exact unique cohort fragment: '+c.description);
 rebuilt=rebuilt.replace(c.old,c.new);counts.push({description:c.description,matches:count});
}
rebuilt=require('./fixtures/route-station-lookup-v11').applyRouteStationLookupPatch(rebuilt);
const releaseFile=path.join(__dirname,'fixtures/race-release-v11.patch'),release=fs.existsSync(releaseFile)?JSON.parse(fs.readFileSync(releaseFile,'utf8')):null;
if(release)rebuilt=require('./fixtures/race-release-v11').applyReleasePatch(rebuilt,release);
const current=fs.readFileSync(path.join(root,'sim.js'),'utf8').replace(/\r\n/g,'\n'),a=rebuilt.split('\n'),b=current.split('\n');
const report={generatedAt:new Date().toISOString(),baselineArchive:path.relative(root,baselineArchive).replace(/\\/g,'/'),
 baselineHash:HASH(baseline),cohortFixtureHash:HASH(fs.readFileSync(path.join(__dirname,'fixtures/race-cohort-v11.patch'),'utf8')),
 lookupFixtureHash:HASH(fs.readFileSync(path.join(__dirname,'fixtures/route-station-lookup-v11.js'),'utf8')),lookupPatchApplied:true,
 releaseFixtureHash:release?HASH(fs.readFileSync(releaseFile,'utf8')):null,releasePatchApplied:!!release,declaredFinalEngineHash:release?.finalEngineHash||null,
 rebuiltHash:HASH(rebuilt),productionHash:HASH(current),exactEquality:rebuilt===current,counts,
 firstDifferentLines:Array.from({length:Math.max(a.length,b.length)},(_,i)=>i).filter(i=>a[i]!==b[i]).slice(0,8).map(i=>({line:i+1,fixture:a[i],production:b[i]}))};
fs.writeFileSync(path.join(root,'docs/cohort-fixture-proof-v11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.exactEquality)process.exitCode=1;
