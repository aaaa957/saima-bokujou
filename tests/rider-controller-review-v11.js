#!/usr/bin/env node
'use strict';
// Read-only controller review. Internal diagnostic closures are exposed only in
// a private module snapshot; no production file or historical report is changed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{gzipSync}=require('node:zlib');
const {api,HASH}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..'),filename=path.join(root,'sim.js');
const source=fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n'),cases=[],findings=[];
const history=path.join(root,'docs/rider-controller-review-v11-history'),sourceArchive=path.join(history,HASH(source)+'.source.js.gz');
fs.mkdirSync(history,{recursive:true});if(!fs.existsSync(sourceArchive))fs.writeFileSync(sourceArchive,gzipSync(source));
const hook='      H.projectActions=(actions,options={})=>projectActions(H,actions,options);';
assert.equal(source.split(hook).length-1,1);
const privateSource=source.replace(hook,hook+`
      H.__runAI=()=>runAI(H);
      H.__observedPosition=(F,seconds,pace=null)=>observedPosition(F,seconds,pace);
      H.__applyRiderSequence=()=>applyRiderSequence(H);`),S=api(privateSource);
const clone=x=>structuredClone(x);
function horse(id,position=.5){
 const h=S.makeHorse(()=>.5,{id,name:id,level:70,surface:'草地',special:'左右皆可',jockeyGrade:'优秀',
   '斗志':50,'疲劳':0,bodyMass:480,carriedWeight:57,physiology:S.neutralPhysiology(),
   behavior:{forwardness:position,settle:.6,tractability:.8},racePlan:{position,risk:.5,patience:.6}});
 for(const k of Object.keys(h.stats))h.stats[k]=70;return h;
}
function race(n=1,length=2400){
 const r=S.createRace(Array.from({length:n},(_,i)=>horse('review-'+i)),
   {length,course:'标准',profile:'平坦',surface:'草地',state:'良',rng:()=>.5});
 r.race.t=30;for(let i=0;i<n;i++){
   const H=r.race.horses[i];Object.assign(H,{s:500,t:4+i*2,targetT:4+i*2,v:17,prevV:17,
     accel:0,startDelay:0,startSettled:true,lastObserve:0,laneIntentT:0});H.aerobicOutput=H.aerobic;
 }return r;
}
function test(name,fn){const start=performance.now();try{const result=fn();cases.push({name,passed:true,milliseconds:performance.now()-start,result});console.log('PASS '+name);}
 catch(error){cases.push({name,passed:false,milliseconds:performance.now()-start,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}}

test('cohort seconds reuse launch delay already integrated by finishPlan',()=>{
 const input=horse('once-delay'),entry=clone(input),opts={length:1200,course:'标准',surface:'草地',state:'良',dir:'左回',profile:'平坦'};
 S.horsePhysiology(entry);entry.behavior=S.horseBehavior(entry);
 const f=S.raceEntryForecast(input,opts),r=S.createRace([entry],{...opts,rng:()=>.5}),H=r.race.horses[0];
 H.t=r.race.geo.referenceLane;H.targetT=H.t;const shared=H.finishPlan(f.requestedV,0);
 assert(H.startDelay>0);assert.equal(f.seconds,shared.seconds);
 const delay=H.startDelay;H.startDelay=0;const immediate=H.finishPlan(f.requestedV,0);
 assert(shared.seconds>immediate.seconds);
 return {startDelay:delay,cohortSeconds:f.seconds,sharedSeconds:shared.seconds,immediateSeconds:immediate.seconds,
   oldDoubleCountError:delay};
});

test('near and distant rivals expose only visible motion and body size to rider',()=>{
 const r=race(3),[H,near,far]=r.race.horses;
 Object.assign(near,{s:H.s+8,t:H.t,v:17});Object.assign(far,{s:H.s+65,t:9,v:17,accel:.1});
 const hidden=['h','stamina','staminaMax','guts','gutsMax','retention','maxV','aerobic','aerobicOutput',
   'aerobicTau','reservePower','physiology','behavior','plan','targetV','targetT','power','sustainableV'];
 let attemptedHiddenReads=0;
 for(const F of [near,far])for(const key of hidden)Object.defineProperty(F,key,{configurable:true,get(){attemptedHiddenReads++;throw new Error('Hidden rival read: '+key);}});
 H.__runAI();assert.equal(attemptedHiddenReads,0);
 return {attemptedHiddenReads,protectedKeys:hidden,mode:H.strategy.mode,request:H.targetV,planning:clone(H.planning)};
});

test('a distant moving front horse remains ahead in predicted rank',()=>{
 const r=race(2),[H,F]=r.race.horses;H.t=H.targetT=F.t=F.targetT=r.race.geo.referenceLane;
 F.s=H.s+65;F.v=18;F.accel=0;
 H.__runAI();const p=H.planning,time=p.evaluationHorizon??p.horizon;
 const publicFront=F.s+F.v*time*S.laneProgressCoef(F.s,F.t,r.race.geo);
 assert(publicFront>p.baseline.s+4);assert(p.baseline.rank>.99,'Moving distant rival must not be frozen at its old location');
 return {distance:65,horizon:time,frontPublicS:publicFront,baselineS:p.baseline.s,predictedRank:p.baseline.rank};
});

test('visible braking prediction never integrates negative velocity after stopping',()=>{
 const r=race(),H=r.race.horses[0],seen={s:H.s,t:H.t,v:1,accel:-S.RACE_F.braking};
 const predictions=[.01,.1,.3,.6,1,4].map(seconds=>({seconds,...H.__observedPosition(seen,seconds)}));
 const response=S.RACE_F.responseTime,stop=-response*Math.log1p(seen.v/(seen.accel*response));
 const physicalDistance=seen.v*stop+seen.accel*response*(stop-response*(1-Math.exp(-stop/response)));
 findings.push({type:'observed-braking-boundary',stopSeconds:stop,expectedStopDistance:physicalDistance,predictions});
 assert(physicalDistance>0);
 for(let i=1;i<predictions.length;i++)assert(predictions[i].s>=predictions[i-1].s-1e-9,
   'Longer lookahead must not send a braking horse back toward its old position');
 assert(Math.abs(predictions.at(-1).s-seen.s-physicalDistance*S.laneProgressCoef(seen.s,seen.t,r.race.geo))<1e-9);
 assert.equal(predictions.at(-1).v,0);
 return {stopSeconds:stop,expectedStopDistance:physicalDistance,predictions};
});

test('sequence stage boundaries persist requests until the promised stage ends',()=>{
 const r=race(),H=r.race.horses[0],start=r.race.t;
 H.riderSequence={at:start,stage:-1,mode:'follow',actions:[{duration:1.5,targetV:16.9,targetT:4},
   {duration:2.5,targetV:17.1,targetT:3}],goal:{s:568,tolerance:.12}};
 const snapshots=[];
 for(const elapsed of [0,1.499,1.5,3.999,4]){
   r.race.t=start+elapsed;H.__applyRiderSequence();snapshots.push({elapsed,targetV:H.targetV,targetT:H.targetT,
     stage:H.riderSequence?.stage??null,active:!!H.riderSequence});
 }
 assert.deepEqual(snapshots.map(x=>x.stage),[0,0,1,1,null]);
 assert.equal(snapshots[0].targetV,16.9);assert.equal(snapshots[2].targetV,17.1);assert.equal(H.lastObserve,0);
 return snapshots;
});

test('sequence revalidation pays only future motion from measured state and keeps absolute goal',()=>{
 const r=race(),H=r.race.horses[0],at=r.race.t;
 const original=[{duration:2,targetV:17,targetT:H.t},{duration:2,targetV:17,targetT:H.t}],
   full=H.projectActions(original,{maxDt:.12,trace:true}),goal={s:full.endpoint.s,tolerance:.12},
   prefix=H.projectActions([{duration:1,targetV:17,targetT:H.t}],{maxDt:.12,trace:true});
 H.riderSequence={at,stage:0,mode:'follow',actions:original,goal:clone(goal)};
 Object.assign(H,prefix.endpoint);r.race.t=at+1;const before={s:H.s,reserve:H.stamina,v:H.v,t:H.t};
 const calls=[],project=H.projectActions;H.projectActions=(actions,opts)=>{const f=project(actions,opts);calls.push({actions:clone(actions),initial:f.model.initialState,ledger:clone(f.ledger),segments:clone(f.segments),endpoint:clone(f.endpoint)});return f;};
 H.__runAI();assert.equal(H.planning.continuation,true);assert.equal(H.riderSequence.at,at);
 assert.deepEqual(H.riderSequence.goal,goal);assert.equal(H.planning.remainingActions,2);
 const continuation=calls[0];assert.equal(continuation.actions[0].duration,1);assert.equal(continuation.actions[1].duration,2);
 assert.equal(continuation.initial.s,before.s);assert.equal(continuation.initial.reserve,before.reserve);
 assert.equal(continuation.actions[1].goal.s,goal.s);assert(continuation.ledger.energyUsed<full.ledger.energyUsed+50,
   'A ledger from the measured state must not replay the spent prefix');
 return {originalGoal:goal,prefixEnergy:prefix.ledger.energyUsed,measuredState:before,revalidation:continuation,
   continuation:true,originalSequenceEpoch:H.riderSequence.at};
});

test('committed multi-action motion executes with paid energy and the projected endpoint',()=>{
 const r=race(),H=r.race.horses[0],actions=[{duration:2,targetV:16.8,targetT:H.t},
   {duration:2,targetV:17.2,targetT:H.t}],forecast=H.projectActions(actions,{maxDt:1/60});
 const start=r.race.t;
 H.riderSequence={at:start,mode:'follow',stage:-1,actions:clone(actions),goal:{s:forecast.endpoint.s,tolerance:.12}};
 H.lastObserve=99;
 for(let i=0;i<240;i++)r.step(1/60);
 assert(Math.abs(H.s-forecast.endpoint.s)<.12);
 assert(Math.abs(H.v-forecast.endpoint.v)<.002);
 assert(Math.abs(H.statsSummary.workUsed-H.statsSummary.aerobicUsed-H.statsSummary.energyUsed)<1e-6);
 assert(H.statsSummary.unpaidWork<1e-6);assert.equal(r.race.traffic.infeasibleSteps,0);
 return {duration:r.race.t-start,projected:forecast.endpoint,actual:{s:H.s,t:H.t,v:H.v,stamina:H.stamina},
   distanceError:H.s-forecast.endpoint.s,speedError:H.v-forecast.endpoint.v,
   energyError:H.statsSummary.energyUsed-forecast.ledger.energyUsed,
   workLedgerError:H.statsSummary.workUsed-H.statsSummary.aerobicUsed-H.statsSummary.energyUsed};
});

test('segmented visible-leader forecast keeps one observation epoch and cannot reset draft credit',()=>{
 const r=race(),H=r.race.horses[0],leader={id:'visible-front',s:H.s+12,t:H.t,v:17,accel:.2,observedAt:r.race.t};
 const whole=H.projectActions([{duration:4,targetV:17,targetT:H.t,leader}],{maxDt:.1,trace:true}),
   split=H.projectActions([{duration:2,targetV:17,targetT:H.t,leader},{duration:2,targetV:17,targetT:H.t,leader}],{maxDt:.1,trace:true});
 for(const key of ['s','v','stamina'])assert(Math.abs(whole.endpoint[key]-split.endpoint[key])<1e-9);
 assert(Math.abs(whole.ledger.energyUsed-split.ledger.energyUsed)<1e-9);
 assert.equal(split.observedLeaderEndpoints.length,1);
 return {wholeEndpoint:whole.endpoint,splitEndpoint:split.endpoint,energyDifference:split.ledger.energyUsed-whole.ledger.energyUsed,
   distinctObservationEpochs:split.observedLeaderEndpoints.length};
});

test('paid remaining-route candidates use time utility; crossed candidates discard unused reserve',()=>{
 const runs=[];let crossed=0;for(const distance of [20,60,100]){
   const r=race(1,1200),H=r.race.horses[0];H.s=1200-distance;H.t=H.targetT=r.race.geo.referenceLane;
   H.v=H.prevV=18.74;
   const forecasts=[],project=H.projectActions;H.projectActions=(actions,opts)=>{const f=project(actions,opts);forecasts.push(f);return f;};
   H.__runAI();const c=H.planning.candidates,attack=c.find(x=>x.mode==='attack'),baseline=c[0];
   assert(attack&&attack.energyFeasible&&!attack.pathConflict);assert(attack.score>=baseline.score);
   if(attack.score>=.15)assert.equal(H.planning.selected,'attack');
   else assert(['attack','settle'].includes(H.planning.selected),'Sub-0.15m equivalent gains retain cadence hysteresis');
   for(let i=0;i<c.length;i++)if(forecasts[i].finished){crossed++;
     if(forecasts[0].finished)assert(Math.abs(c[i].score-(forecasts[0].seconds-forecasts[i].seconds)*baseline.targetV)<1e-8);
   }
   runs.push({remaining:distance,selected:H.planning.selected,selectedRequest:H.targetV,maxV:H.maxV,candidates:c,
     forecasts:forecasts.map(f=>({finished:f.finished,seconds:f.seconds,energy:f.ledger.energyUsed,reserve:f.endpoint.stamina}))});
 }assert(crossed>0,'At least one candidate actually crosses in the projection');return {crossed,runs};
});

test('finite following does not invent saving when holding pace already shares the wake',()=>{
 const trials=[];
 for(const gap of [6,9,12])for(const pace of [15.8,16,16.1,16.2,16.3]){
   const r=race(2),[H,F]=r.race.horses;H.t=H.targetT=F.t=F.targetT=.8;F.s=H.s+gap;F.v=pace;
   H.plan.position=.1;H.plan.patience=.8;F.control={targetV:pace,targetT:.8};
   H.__runAI();const snapshot={gap,pace,selected:H.planning.selected,opportunity:clone(H.followOpportunity)};trials.push(snapshot);
   const f=H.followOpportunity;
   if(f?.accepted)assert(f.goalReached&&f.saving>0&&!f.pathConflict);
   if(f&&(f.saving<=0||!f.goalReached||f.pathConflict))assert.equal(f.accepted,false);
 }return {trials,note:'A slower-then-faster same-lane plan has no inherent energy benefit if baseline already drafts. Nonzero follow labels are not an acceptance requirement.'};
});

const report={generatedAt:new Date().toISOString(),sourceHash:HASH(source),testHash:HASH(fs.readFileSync(__filename,'utf8')),
 sourceArchive:path.relative(root,sourceArchive).replace(/\\/g,'/'),privateInstrumentationHash:HASH(privateSource),
 productionSourceUnchanged:HASH(fs.readFileSync(filename,'utf8'))===HASH(source),
 scope:'Single immutable current-source snapshot; direct controller calls and shared paid projections. No parameter fitting or realism victory claim.',
 cases,passed:cases.filter(x=>x.passed).length,failed:cases.filter(x=>!x.passed).length,findings};
fs.writeFileSync(path.join(root,'docs/rider-controller-review-v11.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(history,report.sourceHash+'-'+report.testHash+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,sourceHash:report.sourceHash,productionSourceUnchanged:report.productionSourceUnchanged}));
if(report.failed)process.exitCode=1;
