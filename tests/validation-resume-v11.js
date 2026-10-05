#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {readArchive}=require('./helpers/read-archive-v11');
const ROOT=path.resolve(__dirname,'..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'race-validation-resume-v11-'));
const call=(script,args)=>spawnSync(process.execPath,[script,...args],{cwd:ROOT,encoding:'utf8',maxBuffer:1e6});
const fresh=path.join(tmp,'check-only.json'),result=call('tests/race-validation-v11.js',['--mode','baseline','--scope','external','--workers','1','--check-source','--out',fresh]);
assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).totalJobs,72);assert.deepEqual(fs.readdirSync(tmp),[],'Read-only source check wrote artifacts');
const args=process.argv.slice(2),inputIndex=args.indexOf('--input'),legacy='docs/race-validation-v11-baseline-external.json',input=readArchive(path.resolve(ROOT,inputIndex<0?legacy:args[inputIndex+1])),
 archives=[path.relative(ROOT,input.file).replace(/\\/g,'/'),legacy+'.source.js.gz',legacy+'.driver.js.gz'],before=archives.map(file=>sha(fs.readFileSync(path.join(ROOT,file))));
// The active driver writes raw checkpoints only. Check a decoded temporary copy
// rather than asking it to resume/overwrite the immutable tracked gzip.
const temporaryLegacy=path.join(tmp,'legacy.json'),copies=[temporaryLegacy,temporaryLegacy+'.source.js.gz',temporaryLegacy+'.driver.js.gz'];
fs.writeFileSync(temporaryLegacy,input.decoded);
for(let i=1;i<copies.length;i++)fs.copyFileSync(path.join(ROOT,archives[i]),copies[i]);
const mismatch=call('tests/race-validation-v11.js',['--mode','baseline','--scope','external','--workers','1','--resume','--check-resume','--out',temporaryLegacy]);
assert.notEqual(mismatch.status,0,'Changed validation definition should reject an old checkpoint');assert.match(mismatch.stderr,/Resume (validation driver changed|protocol\/source\/reference mismatch)/);
assert.deepEqual(archives.map(file=>sha(fs.readFileSync(path.join(ROOT,file)))),before,'Rejected resume changed evidence artifacts');
const source='docs/race-validation-v11-cohort-initial-training.json.source.js.gz',grid='docs/calibration-screen-v11-oom.json',gridArchives=[grid,grid+'.source.js.gz',grid+'.driver.js.gz',grid+'.orchestrator.js.gz'],gridBefore=gridArchives.map(file=>sha(fs.readFileSync(path.join(ROOT,file))));
const check=call('tests/calibrate-validation-v11.js',['--source',source,'--expected-source','1ca77ab4eacdd18ec98ed8bcc6b5e3cfa74525dd16dfca3f2fbe6d151304f818','--workers','1','--check-source','--out',grid]);
assert.equal(check.status,0,check.stderr);assert.equal(JSON.parse(check.stdout).totalJobs,24);assert.deepEqual(gridArchives.map(file=>sha(fs.readFileSync(path.join(ROOT,file)))),gridBefore,'Grid source check changed the old OOM evidence');
for(const file of copies)fs.unlinkSync(file);fs.rmdirSync(tmp);
const report={passed:3,checks:['read-only fresh source check','changed-validation-definition resume rejection retains all old byte hashes','read-only grid source check retains OOM artifacts'],steppedRaceExecutions:0,forecastQueries:0,
  archiveByteHashes:archives.map((file,i)=>({file,sha256:before[i]})),temporaryDecodedResumeCopy:true,oomArchiveByteHashes:gridArchives.map((file,i)=>({file,sha256:gridBefore[i]})),development:[{attempt:1,result:'Test assertion expected specifically the new driver-hash rejection, but the historical baseline has an earlier protocol-definition mismatch and was correctly rejected before that check. The test now verifies either legitimate definition mismatch and unchanged byte hashes; no numerical or engineering tolerance changed.'}]};
fs.writeFileSync(path.join(ROOT,'docs/validation-resume-v11.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
