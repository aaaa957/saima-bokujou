#!/usr/bin/env node
'use strict';
// Exercise checkpoint recovery with temporary copies; production result files
// and the simulation source are never written, and no races are simulated.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
const {archivePath}=require('./helpers/v9-numeric-snapshot');
const ROOT=path.resolve(__dirname,'..'),CLI=path.join(__dirname,'system-reality-v9.js');
const tempRoot=path.resolve(os.tmpdir()),scratch=fs.mkdtempSync(path.join(tempRoot,'saima-resume-v9-'));
const copy=x=>JSON.parse(JSON.stringify(x));
const read=n=>{const raw=fs.readFileSync(path.join(ROOT,'docs',n));return JSON.parse((raw[0]===0x1f&&raw[1]===0x8b?zlib.gunzipSync(raw):raw).toString('utf8'));};
let passed=0;
function runFixture(label,report,{scope='full',mode='current',check=true,expectedStatus=0,expectedError}={}){
  const output=path.join(scratch,label+'.json'),before=JSON.stringify(report,null,2)+'\n';fs.writeFileSync(output,before);
  const args=[CLI,'--mode',mode,'--scope',scope,'--seeds','12','--workers','1','--out',output,'--resume'];
  if(mode==='current')args.push('--source-archive',archivePath);
  if(check)args.push('--check-resume');
  const result=spawnSync(process.execPath,args,{cwd:ROOT,encoding:'utf8',timeout:30000,maxBuffer:2e6});
  assert.equal(result.error,undefined,label+': '+result.error);
  assert.equal(result.status,expectedStatus,label+': '+result.stdout+'\n'+result.stderr);
  if(expectedError)assert.match(result.stderr,expectedError,label);
  if(check)assert.equal(fs.readFileSync(output,'utf8'),before,label+': read-only validation changed checkpoint');
  else assert.doesNotMatch(result.stdout,/Measured \d+\//,label+': completed jobs were simulated again');
  passed++;return {result,output,report:JSON.parse(fs.readFileSync(output,'utf8'))};
}
try{
  const current=read('system-current-v2026.10.02.3.json'),external=read('system-current-external2022-v2026.10.02.3.json');
  runFixture('valid-current',current);
  runFixture('valid-external2022',external,{scope:'external2022'});
  const negative=[
    ['engine-hash',x=>x.engineHash='wrong',/source\/baseline hash mismatch/],
    ['baseline-hash',x=>x.baselineHash='wrong',/source\/baseline hash mismatch/],
    ['protocol-dt',x=>x.protocol.dt=1/30,/protocol mismatch: dt/],
    ['source-changed',x=>x.integrity.sourceUnchanged=false,/source-unchanged checkpoint/],
    ['existing-errors',x=>x.errors.push({error:'fixture'}),/no errors/],
    ['duplicate-job',x=>x.samples.push(copy(x.samples[0])),/foreign or duplicate job/],
    ['foreign-job',x=>x.samples[0].seed=(x.samples[0].seed+1)>>>0,/foreign or duplicate job/],
    ['horse-time',x=>x.samples[0].horses[0].time=null,/invalid horse result time/],
    ['horse-id',x=>x.samples[0].horses[1].id=x.samples[0].horses[0].id,/invalid horse IDs/],
    ['horse-place',x=>x.samples[0].horses[1].place=x.samples[0].horses[0].place,/invalid finishing places/],
    ['horse-sectional-count',x=>x.samples[0].horses[0].sectionals.pop(),/invalid horse sectionals/],
    ['horse-sectional-distance',x=>x.samples[0].horses[0].sectionals[0].distance=201,/invalid horse sectional values/],
    ['horse-sectional-split',x=>x.samples[0].horses[0].sectionals[0].split+=.01,/invalid horse sectional values/],
    ['leader-sectional-count',x=>x.samples[0].leaderSectionals.pop(),/invalid leader sectionals/]
  ];
  for(const [label,mutate,expectedError] of negative){const fixture=copy(current);mutate(fixture);runFixture(label,fixture,{expectedStatus:1,expectedError});}
  const baseline=read('system-baseline-v2026.10.02.3.json.gz'),refs=read('race-reality-reference.json');
  const holdoutIds=new Set(refs.samples.filter(r=>r.split==='holdout').map(r=>r.id));
  const smoke={...baseline,protocol:{...baseline.protocol,scope:'smoke',totalRaces:holdoutIds.size},samples:baseline.samples.filter(r=>r.context==='external'&&r.replicate===0&&holdoutIds.has(r.id)),errors:[],elapsedSeconds:1.5,integrity:{complete:false,sourceUnchanged:true}};
  assert.equal(smoke.samples.length,holdoutIds.size,'Complete smoke fixture missing a declared job');
  const finalized=runFixture('already-complete',smoke,{scope:'smoke',mode:'baseline',check:false});
  assert.equal(finalized.report.integrity.complete,true);
  assert.equal(finalized.report.integrity.allFinish,true);
  assert.equal(finalized.report.integrity.allFinite,true);
  assert.equal(finalized.report.samples.length,smoke.samples.length);
  assert.ok(finalized.report.elapsedSeconds>=1.5);
  const byId=rows=>rows.slice().sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(byId(finalized.report.samples),byId(smoke.samples),'Zero-worker finalization changed race outputs');
  for(const flag of ['finished','finite']){
    const failedFixture=copy(smoke);failedFixture.samples[0][flag]=false;
    const retained=runFixture('retain-'+flag,failedFixture,{scope:'smoke',mode:'baseline',check:false,expectedStatus:1});
    assert.equal(retained.report.integrity.complete,true,'Completed failed result should remain a completed measurement');
    assert.equal(retained.report.integrity[flag==='finished'?'allFinish':'allFinite'],false);
    assert.equal(retained.report.samples.find(r=>r.id===failedFixture.samples[0].id)[flag],false,'Failure was silently discarded');
  }
  console.log(JSON.stringify({passed,failed:0,productionFilesChanged:false,racesSimulated:0,zeroWorkerFinalization:true},null,2));
}finally{
  const resolved=path.resolve(scratch);
  if(path.dirname(resolved)!==tempRoot||!path.basename(resolved).startsWith('saima-resume-v9-'))throw new Error('Refusing cleanup outside the temporary fixture directory');
  fs.rmSync(resolved,{recursive:true,force:true});
}
