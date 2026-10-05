#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {api,HASH,BASE,DT}=require('./system-reality-v9');
const {observe,controlledField,BASELINE,BASELINE_HASH}=require('./race-validation-v11');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),sourceArg=args.indexOf('--source'),outArg=args.indexOf('--out'),sequence=args.includes('--sequence');
const source=sourceArg<0?execFileSync('git',['show',BASELINE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6}):fs.readFileSync(path.resolve(ROOT,args[sourceArg+1]),'utf8');
if(sourceArg<0)assert.equal(HASH(source),BASELINE_HASH);
const B=api(execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6}));
const job={kind:'start',n:8,length:1200,level:86,intent:0.5,seed:2026101103,raceSeed:2026101103^0x9e3779b9};
function run(observed){const S=api(source),field=controlledField(S,B,job),r=S.createRace(field,{length:job.length,course:'标准',profile:'平坦',surface:'草地',state:'良',wind:0,rng:S.mulberry32(job.raceSeed)}),instrument=observed?observe(S,r):null,digest=crypto.createHash('sha256');let frames=0;
  if(sequence){assert(r.step.length>=2,'Constructed sequence proof requires internal callback API');for(const H of r.race.horses){H.lastObserve=1000;H.riderSequence={at:0,mode:'diagnostic-sequence',stage:-1,
    actions:[{duration:0.237,targetV:16,targetT:H.t},{duration:0.529,targetV:18,targetT:H.t},{duration:100,targetV:16.5,targetT:H.t}]};}}
  while(!r.race.horses.every(h=>h.s>=600||h.place)&&r.race.t<610){if(observed)instrument.step();else r.step(DT);frames++;digest.update(JSON.stringify(r.race));}
  return {observed,frames,digest:digest.digest('hex'),end:HASH(JSON.stringify(r.race)),completed:r.race.horses.every(h=>h.s>=600||h.place),...(observed?{engineering:instrument.result()}:{})};}
const plain=run(false),observed=run(true);assert(plain.completed&&observed.completed);assert.equal(plain.frames,observed.frames);assert.equal(plain.digest,observed.digest);assert.equal(plain.end,observed.end);
if(sequence)assert(observed.engineering.internalTicks>observed.frames,'Proof did not exercise fractional action substeps');
const output=outArg<0?path.join(ROOT,'docs/race-validation-v11-observer-proof.json'):path.resolve(ROOT,args[outArg+1]);fs.writeFileSync(output,JSON.stringify({sourceNormalizedSha256:HASH(source),job,interpretation:sequence?'Identical whole race object JSON at every outer60Hz frame. Constructed 8-horse finite action sequence at noninteger0.237/0.529s boundaries; AI observation held to isolate transition execution, positive speed at second boundary. Internal callback sees every fractional tick; no tolerance relaxation. Two partial executions, zero full races/diagnostic forecast queries.':'Identical whole race object JSON at every 60Hz frame, plain versus read-only observer; constructed natural-AI 8-horse standard flat first600. Two stepped partial races, zero completed full races, zero explicit finishPlan diagnostic queries.',
  counts:{initializedRaces:2,steppedPartialRaces:2,fullRaces:0,frames:plain.frames+observed.frames},passed:true,plain,observed},null,2)+'\n');console.log(JSON.stringify({output,passed:true,framesEach:plain.frames,digest:plain.digest}));
