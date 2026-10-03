#!/usr/bin/env node
'use strict';
// Diagnostic interventions, never production calibration. All variants start
// with identical field-generated traits, lane, reaction delay and bias.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {api,fieldFor,HASH,BASE,DT,distribution:D}=require('./system-reality-v9');
const {NUMERIC_HASH}=require('./helpers/v9-numeric-snapshot');
const ROOT=path.resolve(__dirname,'..');
const args=process.argv.slice(2),archiveIndex=args.indexOf('--source-archive');
if(archiveIndex>=0&&!args[archiveIndex+1])throw new Error('--source-archive requires a path');
const sourcePath=path.resolve(ROOT,archiveIndex>=0?args[archiveIndex+1]:'sim.js');
const readSource=()=>{const raw=fs.readFileSync(sourcePath);return (raw[0]===0x1f&&raw[1]===0x8b?require('node:zlib').gunzipSync(raw):raw).toString('utf8');};
const source=readSource(),B=api(execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6}));
if(args.includes('--check-source')){console.log(JSON.stringify({engineHash:HASH(source),sourceArtifact:sourcePath}));process.exit(0);}
assert.equal(HASH(source),NUMERIC_HASH,'Start diagnostic requires the registered frozen v9 numerical source');
const variants=['normal-ai','maximum-request','maximum-warm-oxygen','maximum-acceleration-plus25','maximum-reserve-power-plus25'];
const rows=[];
for(const [length,course,dir] of [[1200,'中山芝外A','右回'],[2400,'東京芝A','左回']])for(let k=0;k<3;k++){
  const seed=(2026100207+(length===2400?3:0)*100003+k*7919)>>>0,job={length,course,dir,n:16,external:true,context:'start-diagnostic',weight:58,seed,raceSeed:(seed^0x9e3779b9)>>>0};
  const starterApi=api(source),field=fieldFor(job,B,starterApi),opts={length,course,dir,surface:'草地',state:'良',wind:0,profile:'平坦'},crowd=starterApi.createRace(field,{...opts,rng:starterApi.mulberry32(job.raceSeed)}),original=crowd.race.horses[0];
  for(const variant of variants){
    const S=api(source),r=S.createRace([JSON.parse(JSON.stringify(field[0]))],{...opts,rng:S.mulberry32(job.raceSeed)}),H=r.race.horses[0];
    Object.assign(H,{t:original.t,targetT:original.t,startDelay:original.startDelay,aiBias:original.aiBias});
    if(variant!=='normal-ai')H.control={targetV:30,targetT:H.t};
    if(variant==='maximum-warm-oxygen')H.aerobicOutput=H.aerobic;
    if(variant==='maximum-acceleration-plus25'){S.RACE_F.maxAccel*=1.25;S.RACE_F.runningAccel*=1.25;}
    if(variant==='maximum-reserve-power-plus25')H.reservePower*=1.25;
    const marks={},states=[];let minA=0,maxA=0;
    while(H.s<200&&r.race.t<60){const oldS=H.s,oldT=r.race.t;r.step(DT);minA=Math.min(minA,H.accel);maxA=Math.max(maxA,H.accel);
      for(const m of [10,50,100,200])if(oldS<m&&H.s>=m)marks[m]=oldT+DT*(m-oldS)/(H.s-oldS);
      if(states.length===0||r.race.t-states.at(-1).time>=1-1e-8)states.push({time:r.race.t,s:H.s,v:H.v,targetV:H.targetV,aerobicFraction:H.aerobicOutput/H.aerobic,reserveFraction:H.stamina/H.staminaMax});}
    if(!Number.isFinite(marks[200]))throw new Error('Start did not reach 200m');
    rows.push({length,course,replicate:k,seed,variant,first200:marks[200],marks,startDelay:H.startDelay,maxAcceleration:maxA,minAcceleration:minA,states,
      workError:Math.abs(H.statsSummary.workUsed-H.statsSummary.aerobicUsed-H.statsSummary.energyUsed),unpaid:H.statsSummary.unpaidWork});
  }
}
const report={engineHash:HASH(source),protocol:{sourceArtifact:path.relative(ROOT,sourcePath),starts:6,variants:variants.length,runs:rows.length,dt:DT,
  caveat:'Single synthetic G1 horse per paired start; first bend after200m. A maximum request, fully established oxygen, and +25% parameters are diagnostic sensitivities, not measured warmup or recommended coefficients. Normal AI may change lanes; fixed requests hold lane.',
  mutations:'Only ephemeral module objects and race horse state; production file unchanged.'},samples:rows,
  summary:variants.map(variant=>({variant,first200:D(rows.filter(r=>r.variant===variant).map(r=>r.first200)),perDistance:[1200,2400].map(length=>({length,first200:D(rows.filter(r=>r.variant===variant&&r.length===length).map(r=>r.first200))}))})),
  integrity:{sourceUnchanged:HASH(readSource())===HASH(source),allFinite:rows.every(r=>Number.isFinite(r.first200)),maxUnpaid:Math.max(...rows.map(r=>r.unpaid)),maxWorkError:Math.max(...rows.map(r=>r.workError))}};
fs.writeFileSync(path.join(ROOT,'docs/start-system-v9.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary:report.summary,integrity:report.integrity},null,2));
if(!report.integrity.sourceUnchanged||!report.integrity.allFinite||report.integrity.maxUnpaid>1e-6)process.exitCode=1;
