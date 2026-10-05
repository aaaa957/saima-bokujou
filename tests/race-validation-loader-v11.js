#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {api,HASH,BASE,DT}=require('./system-reality-v9'),{compileSource,controlledField}=require('./race-validation-v11');
const ROOT=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'),generator=execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6});
const parent=require.cache[require.resolve('./system-reality-v9')],before=parent.children.length;
for(let i=0;i<5;i++)api('module.exports={value:'+i+'};');const afterLegacy=parent.children.length;
for(let i=0;i<5;i++)compileSource('module.exports={value:'+i+'};');const afterIsolated=parent.children.length;
assert.equal(afterLegacy-before,5);assert.equal(afterIsolated-afterLegacy,0);
const job={n:1,length:1200,level:86,intent:.5,seed:2026101103,raceSeed:2026101103^0x9e3779b9};
function run(compiler){const S=compiler(source),B=compiler(generator),field=controlledField(S,B,job),r=S.createRace(field,{length:1200,course:'标准',profile:'平坦',surface:'草地',state:'良',wind:0,rng:S.mulberry32(job.raceSeed)}),H=r.race.horses[0],digest=crypto.createHash('sha256');
  Object.assign(H,{t:1.8,targetT:1.8,startDelay:.2,aiBias:0,control:{targetV:16.5,targetT:1.8}});let frames=0;
  while(H.s<600&&!H.place&&r.race.t<610){r.step(DT);frames++;digest.update(JSON.stringify(r.race));}return {frames,digest:digest.digest('hex'),completed:H.s>=600||!!H.place};}
const legacy=run(api),isolated=run(compileSource);assert(legacy.completed&&isolated.completed);assert.deepEqual(legacy,isolated);
const report={sourceNormalizedSha256:HASH(source),moduleRetention:{nonEngineCompiles:10,parentChildrenBefore:before,parentChildrenAfterFiveLegacy:afterLegacy,parentChildrenAfterFiveIsolated:afterIsolated},job,legacy,isolated,passed:true,
  scope:'Compiler parent-reference ownership only; identical virtual filename/resolution. Two actual partial starts to600, zero full races/explicit forecast queries. Ten trivial module compilations are not engine executions.'};
fs.writeFileSync(path.join(ROOT,'docs/race-validation-v11-loader-proof.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
