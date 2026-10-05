#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {api,HASH,DT}=require('./system-reality-v9'),{applyFollowingWitnessCpuPatch}=require('./fixtures/following-witness-cpu-v11');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'sim.js'),'utf8').replace(/\r\n/g,'\n'),candidate=applyFollowingWitnessCpuPatch(source),Plain=api(source),Candidate=api(candidate);
const report={sourceHash:HASH(source),candidateHash:HASH(candidate),checks:[],benchmarks:[],failures:[],scope:'Exact-state/ledger trajectory equivalence for a candidate early negative witness; this test never modifies production.'};
const specs=[
 [{s:200,t:10,v:16,targetV:18},{s:208,t:10,v:16,targetV:16}],
 [{s:200,t:10,v:16,targetV:18},{s:208,t:10,v:16,targetV:16},{s:224,t:10,v:15,targetV:15}],
 [{s:200,t:10,v:16,targetV:16,targetT:11.5},{s:224,t:12,v:16,targetV:16,targetT:11}],
 [{s:200,t:10,v:16,targetV:18,targetT:7.5},{s:208,t:10,v:16,targetV:16}],
 [{s:400,t:6,v:18,targetV:20},{s:407,t:6,v:17,targetV:17}],
 [{s:1000,t:15,v:16,targetV:18},{s:1007,t:15,v:16,targetV:16}],
 [{s:200,t:10,v:20,targetV:20},{s:203,t:10,v:8,targetV:8}]
];
function make(A,spec,course='标准'){const f=spec.map((x,i)=>{const h=A.makeHorse(()=>.5,{id:'h'+i,level:70,physiology:A.neutralPhysiology(),behavior:{forwardness:.5,settle:.5,tractability:.65},bodyMass:480,carriedWeight:57,jockeyGrade:'优秀'});for(const k of Object.keys(h.stats))h.stats[k]=70;return h;});const r=A.createRace(f,{length:2400,course,surface:'草地',state:'良',profile:'平坦',wind:0,rng:()=>.5});r.race.t=30;for(const[i,h]of r.race.horses.entries()){const x=spec[i];Object.assign(h,{s:x.s,t:x.t,v:x.v,startDelay:0,lastObserve:10,startSettled:true,retention:1});h.stamina=h.staminaMax;h.guts=h.gutsMax;h.aerobicOutput=h.aerobic;h.control={targetV:x.targetV,targetT:x.targetT??x.t};}return r;}
function forecast(A,spec,dt){const r=make(A,spec),[h,...f]=r.race.horses;return h.projectActions([{duration:10.8,...h.control}],{maxDt:dt,trace:true,opponents:f.map(x=>({id:x.id,s:x.s,t:x.t,v:x.v,accel:0,bodyLength:2.635,bodyWidth:.755}))});}
function check(name,fn){try{report.checks.push({name,pass:true,...fn()});}catch(e){report.checks.push({name,pass:false,error:String(e.stack||e)});report.failures.push(name);}}
for(let i=0;i<specs.length;i++)for(const dt of [DT,.12])check('Forecast exact equivalence '+i+' dt '+dt,()=>{const a=forecast(Plain,specs[i],dt),b=forecast(Candidate,specs[i],dt);assert.deepEqual(b,a);return {steps:a.steps,complete:a.complete,trafficFeasible:a.trafficFeasible,trajectoryHash:HASH(JSON.stringify(a))};});
for(let i=0;i<specs.length;i++)for(const course of ['标准','东京'])check('Actual exact equivalence '+i+' '+course,()=>{
 const a=make(Plain,specs[i],course),b=make(Candidate,specs[i],course);
 const state=r=>({t:r.race.t,traffic:r.race.traffic,h:r.race.horses.map(x=>({s:x.s,t:x.t,v:x.v,stamina:x.stamina,guts:x.guts,retention:x.retention,aerobicOutput:x.aerobicOutput,stats:x.statsSummary,trafficStep:x.trafficStep,place:x.place,dnf:x.dnf}))});
 const advance=r=>{try{r.step(DT);return null;}catch(e){return e.message;}};
 let ticks=0,expectedConstructedFailure=null;
 for(;ticks<180&&!a.race.finished;ticks++){
   const errorA=advance(a),errorB=advance(b);assert.equal(errorB,errorA,'Same finite-traffic failure');
   assert.deepEqual(state(b),state(a),'Tick '+ticks);
   if(errorA){assert([4,6].includes(i),'An initially valid control must not fail');expectedConstructedFailure=errorA;break;}
 }
 if([4,6].includes(i))assert(expectedConstructedFailure,'The constructed impossible state must be rejected by both engines');
 return {ticks,expectedConstructedFailure};
});
for(const i of [0,1,4]){const times={};for(const [name,A]of [['plain',Plain],['candidate',Candidate]]){forecast(A,specs[i],DT);const ts=[];for(let k=0;k<5;k++){const t=performance.now();forecast(A,specs[i],DT);ts.push(performance.now()-t);}ts.sort((a,b)=>a-b);times[name]={medianMs:ts[2],p90Ms:ts[4],runs:5};}report.benchmarks.push({case:i,...times,speedup:times.plain.medianMs/times.candidate.medianMs});}
report.pass=report.failures.length===0;report.productionUnchanged=HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===report.sourceHash;
report.recommendation='Do not apply: extra exact interval samples preserve these trajectories but slow the binding-headway benchmark. Native actual traffic still rejects the intentionally impossible starting states.';
const out=path.join(root,'docs/following-witness-cpu-v11.json');if(fs.existsSync(out)){const old=fs.readFileSync(out),dir=path.join(root,'docs/following-witness-cpu-v11-history');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,HASH(old.toString())+'.json'),old);}fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');fs.writeFileSync(out+'.source.js.gz',zlib.gzipSync(source));fs.writeFileSync(out+'.candidate.js.gz',zlib.gzipSync(candidate));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
