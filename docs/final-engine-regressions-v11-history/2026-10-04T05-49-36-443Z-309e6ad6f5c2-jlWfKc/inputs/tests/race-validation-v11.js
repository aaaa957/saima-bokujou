#!/usr/bin/env node
'use strict';
// Frozen-source evaluation. Engineering failures and infeasible forecasts are
// retained. A source snapshot, not a live module, is passed to every worker.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module');
const {execFileSync}=require('node:child_process'),{Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {measure,fieldFor,HASH,q,distribution,BASE,DT,DIST}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),BASELINE='5e522e4bde90c7b637627a0ca73aae47198292d2',BASELINE_HASH='51caabc1395b62a325f3048aa923994516310d8c69665f3fd17b89978615b82a';
const clone=x=>JSON.parse(JSON.stringify(x)),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const COURSES=[['中山芝外A','右回'],['東京芝A','左回'],['東京芝A','左回'],['東京芝A','左回'],['京都芝外A','右回'],['京都芝外A','右回']];
function compileSource(source){
  // A parent module would retain every compiled candidate in parent.children.
  // Isolated modules use the identical virtual filename and resolution paths,
  // while permitting completed per-job engine closures to be collected.
  const filename=path.join(ROOT,'sim.snapshot.js'),loaded=new Module(filename);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(source,filename);return loaded.exports;
}
const METRICS=['winnerTime','winnerFinal600','first200','first400','first600','remainingSpeed','tailSeconds','within1','within2','final600Span','post200Cv','last200Difference'];
const TOLERANCE={ledger:1e-6,motion:1e-6,overlap:0,followingSlack:-1e-6,unpaid:1e-6,forecastSeconds:0.75};
function cv(a){if(!a.length)return null;const m=a.reduce((s,x)=>s+x,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length)/m;}
function references(){
  const files=['docs/current-engine-reality-sources-2026-10-02.json','docs/system-external-reference-2022.json','tests/fixtures/race-validation-reference-2020-v11.json'];
  const hashes=files.map(file=>({file,sha256:sha(fs.readFileSync(path.join(ROOT,file)))}));
  const races=files.flatMap(file=>JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8')).races).map(r=>{
    const i=DIST.indexOf(r.length),course=r.course||COURSES[i][0],direction=r.direction||COURSES[i][1];
    const finishers=r.horses.filter(h=>Number.isFinite(h.finishTime)),times=finishers.map(h=>h.finishTime),endings=finishers.map(h=>h.final600),splits=r.raceSectionals200m;
    assert(i>=0&&splits.length===r.length/200&&finishers.length>1,'Invalid numerical reference '+r.id);
    const winner=finishers.find(h=>h.finishPosition===1),year=Number(r.date.slice(0,4));
    return {...r,course,direction,partition:[2023,2024].includes(year)?'calibration':year===2020?'reserved2020':'internal',
      metrics:{winnerTime:winner.finishTime,winnerFinal600:winner.final600,first200:splits[0],first400:splits[0]+splits[1],first600:splits.slice(0,3).reduce((a,b)=>a+b,0),
        remainingSpeed:(r.length-200)/(winner.finishTime-splits[0]),tailSeconds:Math.max(...times)-winner.finishTime,
        within1:times.filter(t=>t-winner.finishTime<=1+1e-9).length/times.length,within2:times.filter(t=>t-winner.finishTime<=2+1e-9).length/times.length,
        final600Span:Math.max(...endings)-Math.min(...endings),post200Cv:cv(splits.slice(1)),last200Difference:splits.at(-1)-splits.at(-2)}};
  });
  assert.equal(races.length,30);assert.equal(new Set(races.map(r=>r.id)).size,30);
  return {races,hashes};
}
function jobKey(job){return sha(JSON.stringify(job));}
function makeJobs(scope,refs,reps,cohort){
  const jobs=[];
  const selected=scope==='smoke'?refs.filter(r=>r.date.startsWith('2023')):refs.filter(r=>scope==='calibration'?r.partition==='calibration':scope==='internal'?r.partition==='internal':scope==='reserved2020'?r.partition==='reserved2020':scope==='external'?r.partition!=='reserved2020':scope==='final');
  for(const r of selected)for(let k=0;k<(scope==='smoke'?1:reps);k++){
    const year=Number(r.date.slice(0,4)),epoch=year===2022?2022100207:year===2020?2020100207:2026100207;
    const seed=(epoch+DIST.indexOf(r.length)*100003+k*7919)>>>0;
    jobs.push({kind:'race',context:cohort==='fixed-v8'?'external-fixed-v8':'external-selected',external:true,cohort,id:r.id,partition:r.partition,n:r.fieldSize,length:r.length,course:r.course,dir:r.direction,state:r.state,
      weight:r.winner?.carriedWeightKg??r.horses.find(h=>h.finishPosition===1)?.carriedWeightKg??58,seed,raceSeed:(seed^0x9e3779b9)>>>0,replicate:k});
  }
  if(['smoke','controls','final'].includes(scope))for(const length of scope==='smoke'?[1200,2400]:[1200,2400,3200])for(const n of scope==='smoke'?[1,8]:[1,8,16])for(const level of scope==='smoke'?[86]:[70,86])for(const intent of scope==='smoke'?[0.5]:[0.1,0.5,0.9])for(const command of scope==='smoke'?['maximum']:['maximum','natural']){
    const seed=(2026101103+DIST.indexOf(length)*100003)>>>0;
    jobs.push({kind:'start',context:'controlled-start',cohort:'controlled-fixed',n,length,course:'标准',dir:'左回',state:'良',level,intent,command,stop:600,seed,raceSeed:(seed^0x9e3779b9)>>>0});
  }
  if(['smoke','forecasts','final'].includes(scope))for(const length of scope==='smoke'?[2400]:[1200,2400,3200])for(const from of scope==='smoke'?[0,600]:[0,600])for(const request of scope==='smoke'?[16.5]:[14.5,16.5,30]){
    const seed=(2026101103+DIST.indexOf(length)*100003)>>>0;
    jobs.push({kind:'forecast',context:'controlled-forecast',n:1,length,course:'标准',dir:'左回',state:'良',level:70,intent:0.5,command:'constant',request,from,seed,raceSeed:(seed^0x9e3779b9)>>>0});
  }
  assert(jobs.length>0,'No declared jobs for scope '+scope);
  const keys=jobs.map(jobKey);assert.equal(new Set(keys).size,keys.length,'Duplicate declared jobs');return jobs;
}
function estimateJobCost(job){
  // Relative scheduling estimates only. Natural multi-horse AI has substantially
  // more planning work than maximum-command controls; no physical value changes.
  const distance=job.kind==='start'?job.stop:job.length,n=job.n||1;
  const courseWeight=job.kind==='race'&&job.course.includes('京都')?3:1;
  const stateWeight=job.kind==='race'&&job.state==='稍重'?1.6:1;
  return distance*n*n*(job.kind==='start'&&job.command==='maximum'?0.1:1)*courseWeight*stateWeight;
}
function allocateJobs(jobs,count){
  assert(Number.isInteger(count)&&count>0);
  const groups=Array.from({length:count},()=>[]),estimatedCosts=Array(count).fill(0);
  const ranked=jobs.map((job,index)=>({job,index,cost:estimateJobCost(job)})).sort((a,b)=>b.cost-a.cost||a.index-b.index);
  for(const item of ranked){let worker=0;for(let i=1;i<count;i++)if(estimatedCosts[i]<estimatedCosts[worker])worker=i;groups[worker].push(item.job);estimatedCosts[worker]+=item.cost;}
  return {groups,estimatedCosts};
}
function currentGenerator(job,S,B,capture){
  if(job.cohort!=='selected')return B;
  assert.equal(typeof S.selectRaceCohort,'function','Selected-cohort arm requires explicit new API');
  return {mulberry32:S.mulberry32,makeField:(rng,opts)=>{
    const field=S.makeField(rng,{...opts,length:job.length,race:{length:job.length,surface:'草地',state:job.state,course:job.course,dir:job.dir,profile:'平坦'},playerIndex:-1,
      entryOverrides:{surface:'草地',special:'左右皆可','疲劳':0,'斗志':50,jockeyGrade:'优秀',bodyMass:480,carriedWeight:job.weight}});
    assert(Array.isArray(field)&&field.cohort,'Missing cohort selection diagnostics');capture.value=clone(field.cohort);return field;
  }};
}
function bodyWidth(h,S){return typeof S.horseWid==='function'?S.horseWid(h):0.65+0.15*h.adj['体格']/100;}
function bodyLength(h,S){return typeof S.horseLen==='function'?S.horseLen(h):2.25+0.55*h.adj['体格']/100;}
function engineering(row,kind){
  const checks={completed:row.completed??row.finished,finite:row.finite,workLedger:row.maxWorkError<=TOLERANCE.ledger,reserveLedger:row.maxReserveError<=TOLERANCE.ledger,
    paidWork:row.maxUnpaid<=TOLERANCE.unpaid,arcMotion:row.maxMotionError<=TOLERANCE.motion,bodyIntersection:row.bodyOverlapFrames===0,
    finiteBraking:row.minAcceleration>=-row.brakingLimit-1e-6,
    trafficFeasible:(row.traffic?.infeasibleSteps??0)===0,followingSlack:!Number.isFinite(row.traffic?.minFollowingSlack)||row.traffic.minFollowingSlack>=TOLERANCE.followingSlack};
  // Infeasible requests are preserved, rather than called prediction failures.
  if(kind==='forecast')checks.feasibleForecastAccuracy=!row.prediction.feasible||Math.abs(row.prediction.timeError)<=TOLERANCE.forecastSeconds;
  return {checks,passed:Object.values(checks).every(Boolean),failedChecks:Object.keys(checks).filter(k=>!checks[k])};
}
function stateDigest(h){return HASH(JSON.stringify({s:h.s,t:h.t,v:h.v,stamina:h.stamina,guts:h.guts,aerobicOutput:h.aerobicOutput,retention:h.retention,time:h.time,summary:h.statsSummary,sectionals:h.sectionals}));}
function observe(S,r){
  const horses=r.race.horses;let frames=0,internalTicks=0,finite=true,maxWorkError=0,maxReserveError=0,maxUnpaid=0,maxMotionError=0,bodyOverlapFrames=0,maxOverlap=0,minAcceleration=0,maxAcceleration=0;
  const internalTickCallback=r.step.length>=2;
  const traces=[],parameters=horses.map(h=>({id:h.id,gate:h.gate,lane:h.t,startDelay:h.startDelay,base:h.base,maxV:h.maxV,aerobic:h.aerobic,reservePower:h.reservePower,capacity:h.staminaMax,tau:h.aerobicTau,stats:clone(h.adj),behavior:clone(h.behavior),plan:clone(h.plan)}));
  const sums=new Map(horses.map(h=>[h.id,{frames:0,time:0,power:0,oxygen:0,reserveSupply:0,peakPower:0,peakV:0,target:0,v:0,post200Time:0,post200V:0,post200Target:0}]));
  function consume(before,tickDt){
    internalTicks++;
    for(let i=0;i<horses.length;i++){
      const h=horses[i],old=before[i],st=h.statsSummary;
      assert.equal(old.id,h.id,'Internal callback horse ordering changed');
      maxWorkError=Math.max(maxWorkError,Math.abs(st.workUsed-st.aerobicUsed-st.energyUsed));
      maxReserveError=Math.max(maxReserveError,Math.abs(h.stamina-(h.staminaMax-st.energyUsed+st.recovered)));maxUnpaid=Math.max(maxUnpaid,st.unpaidWork);
      finite=finite&&[h.s,h.t,h.v,h.stamina,h.guts,h.retention,h.power].every(Number.isFinite);
      if(old.place||old.dnf)continue;
      minAcceleration=Math.min(minAcceleration,h.accel);maxAcceleration=Math.max(maxAcceleration,h.accel);
      const movedS=old.s+(h.trafficStep?.deltaS??h.s-old.s),movedT=old.t+(h.trafficStep?.deltaT??h.t-old.t),lane=(old.t+movedT)/2;
      const arc=S.laneArcDistance(old.s,movedS,lane,r.race.geo),motionDt=Math.max(0,Math.min(tickDt,r.race.t-h.startDelay));
      maxMotionError=Math.max(maxMotionError,Math.abs(Math.hypot(arc,movedT-old.t)-(old.v+h.v)*motionDt/2));
      const x=sums.get(h.id),release=h.reservePower*Math.max(0,Math.min(1,h.stamina/h.staminaMax/S.RACE_F.reserveFade));
      x.frames++;x.time+=tickDt;x.power+=h.power*tickDt;x.oxygen+=h.aerobicOutput*tickDt;x.reserveSupply+=release*tickDt;x.peakPower=Math.max(x.peakPower,h.power);x.peakV=Math.max(x.peakV,h.v);x.target+=h.targetV*tickDt;x.v+=h.v*tickDt;
      if(old.s>=200){x.post200Time+=tickDt;x.post200V+=h.v*tickDt;x.post200Target+=h.targetV*tickDt;}
    }
    const active=horses.filter(h=>!h.place&&!h.dnf);let overlap=false;
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j],lat=(bodyWidth(a,S)+bodyWidth(b,S))/2-Math.abs(a.t-b.t),long=(bodyLength(a,S)+bodyLength(b,S))/2-Math.abs(a.s-b.s);
      if(lat>1e-6&&long>1e-6){overlap=true;maxOverlap=Math.max(maxOverlap,Math.min(lat,long));}
    }
    if(overlap)bodyOverlapFrames++;
  }
  function step(){
    if(internalTickCallback)r.step(DT,consume);
    else{const before=horses.map(h=>({id:h.id,s:h.s,t:h.t,v:h.v,place:h.place,dnf:h.dnf}));r.step(DT);consume(before,DT);}
    frames++;
    if(frames%120===1)traces.push({time:r.race.t,horses:horses.filter(h=>!h.place).map(h=>({id:h.id,s:h.s,lane:h.t,v:h.v,targetV:h.targetV,power:h.power,oxygen:h.aerobicOutput,reserve:h.stamina/h.staminaMax,retention:h.retention,mode:h.strategy?.mode??null}))});
  }
  function result(){return {frames,internalTicks,internalTickCallback,finite,maxWorkError,maxReserveError,maxUnpaid,maxMotionError,bodyOverlapFrames,maxOverlap,minAcceleration,maxAcceleration,brakingLimit:S.RACE_F.braking,parameters,
    powerProfiles:horses.map(h=>{const x=sums.get(h.id);return {id:h.id,activeSeconds:x.time,meanActualPower:x.power/x.time,meanOxygenOutput:x.oxygen/x.time,meanReserveReleaseCeiling:x.reserveSupply/x.time,peakPower:x.peakPower,peakV:x.peakV,meanRequest:x.target/x.time,meanPhysicalV:x.v/x.time,
      post200MeanPhysicalV:x.post200Time?x.post200V/x.post200Time:null,post200MeanRequest:x.post200Time?x.post200Target/x.post200Time:null,work:clone(h.statsSummary)};}),trace:traces,
    traffic:clone(r.race.traffic??null)};}
  return {step,result};
}
function costBenchmark(S,B,job){
  const h=controlledField(S,B,{...job,n:1})[0],r=S.createRace([h],{length:job.length,course:'标准',profile:'平坦',state:'良',surface:'草地',wind:0,rng:S.mulberry32(1)}),H=r.race.horses[0],at=job.length-5;
  return [12,16,18,20].map(v=>{const exposed=H.powerFor(v,0,false,at),sheltered=H.powerFor(v,0,true,at),kinetic=H.powerFor(v,1,false,at)-exposed;
    const air=Number.isFinite(S.RACE_F.airK)?S.RACE_F.airK*v**3*H.massRatio:null;
    return {v,at,exposedPower:exposed,shelteredPower:sheltered,shelterSaving:exposed-sheltered,shelterSavingFraction:(exposed-sheltered)/exposed,airPowerIfCubicModel:air,
      airFractionIfCubicModel:air/exposed,accelerationIncrementAtOneMps2:kinetic,aerobic:H.aerobic,reservePower:H.reservePower,sustainableV:H.sustainableV(at,false),maxV:H.maxV};});
}
function controlledField(S,B,job){
  // Shared identities and intrinsic state across engines and field sizes. The
  // first n horses come from one frozen 16-horse pool, then the named overrides.
  const field=B.makeField(B.mulberry32(job.seed),{n:16,level:job.level??86}).slice(0,job.n);
  for(const h of field){for(const key of Object.keys(h.stats))h.stats[key]=job.level??86;
    Object.assign(h,{surface:'草地',special:'左右皆可','疲劳':0,'斗志':50,jockeyGrade:'优秀',bodyMass:480,carriedWeight:57,behavior:{forwardness:0.5,settle:0.5,tractability:0.65},racePlan:{position:job.intent,risk:0.35,patience:0.5},physiology:S.neutralPhysiology()});}
  return field;
}
function runControlled(job,S,B){
  const field=controlledField(S,B,job),inputHash=HASH(JSON.stringify(field)),r=S.createRace(field,{length:job.length,course:job.course,dir:job.dir,profile:'平坦',surface:'草地',state:job.state,wind:0,rng:S.mulberry32(job.raceSeed)});
  const pitch=Math.min(1.6,((r.race.geo.width||20)-2)/job.n);
  for(let i=0;i<r.race.horses.length;i++){const h=r.race.horses[i];Object.assign(h,{gate:i+1,t:1+pitch*(i+0.5),targetT:1+pitch*(i+0.5),startDelay:0.20,aiBias:0});
    if(job.command!=='natural')h.control={targetV:job.request??30,targetT:h.t};}
  const obs=observe(S,r),H=r.race.horses[0];let prediction=null,forecastQueries=0;
  if(job.kind==='forecast'){
    while(H.s<job.from&&!H.place&&r.race.t<610)obs.step();
    const preHash=stateDigest(H),plan=H.finishPlan(job.request,0,{trace:false});forecastQueries++;
    prediction={requestedV:job.request,fromS:H.s,fromTime:r.race.t,preStateHash:preHash,postStateHash:stateDigest(H),pure:preHash===stateDigest(H),...plan,workBefore:clone(H.statsSummary)};
  }
  const done=()=>job.kind==='start'?r.race.horses.every(h=>h.s>=job.stop||h.place):r.race.finished;
  while(!done()&&r.race.t<610)obs.step();
  const result={...job,...obs.result(),inputHash,completed:done(),finished:r.race.finished,fullRace:job.kind==='forecast',forecastQueries,
    horses:r.race.horses.map(h=>({id:h.id,gate:h.gate,lane:h.t,place:h.place,time:h.time,first200:h.sectionals[0]?.time,first400:h.sectionals[1]?.time,first600:h.sectionals[2]?.time,sectionals:clone(h.sectionals),reserve:h.stamina/h.staminaMax,retention:h.retention,v:h.v,targetV:h.targetV})),
    costBenchmark:costBenchmark(S,B,job)};
  if(prediction){prediction.actualSeconds=H.time-prediction.fromTime;prediction.timeError=prediction.seconds-prediction.actualSeconds;
    prediction.actualReserveDraw=H.statsSummary.energyUsed-prediction.workBefore.energyUsed;prediction.reserveError=prediction.required-prediction.actualReserveDraw;
    result.prediction=prediction;result.finite=result.finite&&prediction.pure&&Number.isFinite(prediction.timeError);}
  result.engineering=engineering(result,job.kind);return result;
}
function runRace(job,S,B){
  let observed=null,inputHash=null;const diagnostics={value:null};
  const proxy={...S,createRace:(field,opts)=>{inputHash=HASH(JSON.stringify(field));const r=S.createRace(field,opts);observed=observe(S,r);return {...r,step:()=>observed.step()};}};
  const row=measure(job,proxy,currentGenerator(job,S,B,diagnostics),false),extra=observed.result();
  const first400=row.leaderSectionals.slice(0,2).reduce((a,b)=>a+b,0),first600=row.leaderSectionals.slice(0,3).reduce((a,b)=>a+b,0);
  const result={...row,...extra,inputHash,fieldGenerationDiagnostics:diagnostics.value,first400,first600,remainingSpeed:(job.length-200)/(row.winnerTime-row.first200),fullRace:true,forecastQueries:0,completed:row.finished};
  result.engineering=engineering(result,'race');return result;
}
function runJob(job,source,generatorSource,parameters){
  const S=compileSource(source),B=compileSource(generatorSource);
  assert(typeof S.horseWid==='function'||/return 0\.65\+0\.15\*\(H\.adj\['体格'\]\/100\)/.test(source),'Body-width proxy changed; export exact horseWid before comparison');
  assert(typeof S.horseLen==='function'||/return 2\.25\+0\.55\*\(H\.adj\['体格'\]\/100\)/.test(source),'Body-length proxy changed; export exact horseLen before comparison');
  for(const [key,value] of Object.entries(parameters||{})){assert(key in S.RACE_F,'Unknown RACE_F parameter '+key);if(typeof value==='number')assert(Number.isFinite(value));S.RACE_F[key]=clone(value);}
  const started=process.hrtime.bigint(),cpuBefore=process.threadCpuUsage?.();const row=job.kind==='race'?runRace(job,S,B):runControlled(job,S,B);
  const cpu=cpuBefore?process.threadCpuUsage(cpuBefore):null;
  return {...row,jobKey:jobKey(job),effectiveRaceParameters:clone(S.RACE_F),wallSeconds:Number(process.hrtime.bigint()-started)/1e9,threadCpuSeconds:cpu?(cpu.user+cpu.system)/1e6:null};
}
function compare(samples,refs){
  return refs.filter(r=>samples.some(s=>s.kind==='race'&&s.id===r.id)).map(r=>{
    const rows=samples.filter(s=>s.kind==='race'&&s.id===r.id),metrics={};
    for(const k of METRICS){const values=rows.map(s=>s[k]);metrics[k]={real:r.metrics[k],sim:q(values),error:q(values.map(x=>x-r.metrics[k])),relativeError:r.metrics[k]===0?null:q(values.map(x=>x/r.metrics[k]-1))};}
    // Construct decomposition within each simulated run, before any averaging.
    const decomposition=rows.map(s=>({total:s.winnerTime-r.metrics.winnerTime,start:s.first200-r.metrics.first200,remaining:(s.winnerTime-s.first200)-(r.metrics.winnerTime-r.metrics.first200)}));
    const gates={winnerWithin5pct:Math.abs(metrics.winnerTime.relativeError)<=0.05,winner600Within10pct:Math.abs(metrics.winnerFinal600.relativeError)<=0.10,
      leading600Within10pct:Math.abs(metrics.first600.relativeError)<=0.10,leading200Within10pct:Math.abs(metrics.first200.relativeError)<=0.10};
    return {id:r.id,partition:r.partition,length:r.length,course:r.course,state:r.state,replicates:rows.length,finiteRealFinishers:r.horses.filter(h=>Number.isFinite(h.finishTime)).length,metrics,decomposition,gates};
  });
}
function writeReport(report,out,refs){
  report.comparisons=compare(report.samples,refs);
  report.realismByPartition=[...new Set(report.comparisons.map(r=>r.partition))].map(partition=>{const rows=report.comparisons.filter(r=>r.partition===partition);
    return {partition,events:rows.length,metrics:Object.fromEntries(METRICS.map(k=>[k,{error:distribution(rows.map(r=>r.metrics[k].error)),absoluteRelativeError:distribution(rows.map(r=>Math.abs(r.metrics[k].relativeError)))}])),
      gateFailures:rows.flatMap(r=>Object.entries(r.gates).filter(([,pass])=>!pass).map(([gate])=>({id:r.id,gate})))};});
  const covered=new Set([...report.samples.map(s=>s.jobKey),...report.errors.filter(e=>e.jobKey).map(e=>e.jobKey)]);
  report.integrity={complete:covered.size===report.protocol.jobs.length&&report.execution.closed,missingJobKeys:report.protocol.jobs.map(jobKey).filter(k=>!covered.has(k)),sourceSnapshotImmutable:true,
    fullRaceExecutions:report.samples.filter(s=>s.fullRace).length,startTo600Executions:report.samples.filter(s=>s.kind==='start').length,forecastQueries:report.samples.reduce((n,s)=>n+s.forecastQueries,0),
    passedEngineering:report.samples.every(s=>s.engineering.passed)&&report.errors.length===0,
    failures:report.samples.filter(s=>!s.engineering.passed).map(s=>({jobKey:s.jobKey,kind:s.kind,id:s.id,length:s.length,n:s.n,checks:s.engineering.failedChecks})),
    maxWorkError:Math.max(0,...report.samples.map(s=>s.maxWorkError)),maxReserveError:Math.max(0,...report.samples.map(s=>s.maxReserveError)),maxMotionError:Math.max(0,...report.samples.map(s=>s.maxMotionError)),maxUnpaid:Math.max(0,...report.samples.map(s=>s.maxUnpaid)),
    overlapExecutions:report.samples.filter(s=>s.bodyOverlapFrames>0).length,infeasibleTrafficSteps:report.samples.reduce((n,s)=>n+(s.traffic?.infeasibleSteps??0),0)};
  const temporary=out+'.tmp';fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(temporary,JSON.stringify(report)+'\n');fs.renameSync(temporary,out);
}
function pairedComparison(current,old){
  assert.deepEqual(current.protocol.referenceHashes,old.protocol.referenceHashes,'Comparison reference mismatch');assert.equal(current.protocol.dt,old.protocol.dt,'Comparison integration-step mismatch');
  const identity=r=>JSON.stringify(['kind','id','length','n','course','dir','state','seed','raceSeed','replicate','level','intent','command','request','from','stop'].map(k=>[k,r[k]??null]));
  const byKey=new Map(old.samples.map(r=>[identity(r),r]));
  return {referenceEngine:old.protocol.engineNormalizedSha256,referenceParameters:old.protocol.parameters,rows:current.samples.map(row=>{
    const base=byKey.get(identity(row));if(!base)return {jobKey:row.jobKey,matchedJob:false};
    const metrics=row.kind==='race'?METRICS:['first200','first400','first600'];
    const horsePairs=row.horses.map(h=>{const b=base.horses.find(x=>x.id===h.id);return {id:h.id,matched:!!b,...(b?Object.fromEntries(['time','first200','first400','first600'].filter(k=>Number.isFinite(h[k])&&Number.isFinite(b[k])).map(k=>[k,h[k]-b[k]])):{})};});
    return {jobKey:row.jobKey,matchedJob:true,sameInputField:row.inputHash===base.inputHash,cohort:row.cohort??null,referenceCohort:base.cohort??null,
      interpretation:row.inputHash===base.inputHash?'paired mechanism change on identical serialized entrant input':'joint engine/cohort contrast; not an isolated engine effect',
      differences:Object.fromEntries(metrics.filter(k=>Number.isFinite(row[k])&&Number.isFinite(base[k])).map(k=>[k,row[k]-base[k]])),horsePairs};
  })};
}
if(require.main===module&&!isMainThread){
  for(const job of workerData.jobs){try{parentPort.postMessage({row:runJob(job,workerData.source,workerData.generatorSource,workerData.parameters)});}
    catch(e){parentPort.postMessage({error:String(e.stack),job,jobKey:jobKey(job)});}}
}else if(require.main===module){
  const args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);if(i<0)return value;assert(i+1<args.length,'Missing '+key);return args[i+1];};
  const resuming=args.includes('--resume')||args.includes('--check-resume');
  const scope=arg('--scope','smoke'),mode=arg('--mode','baseline'),cohort=arg('--cohort','fixed-v8'),workers=Number(arg('--workers','2')),reps=Number(arg('--replicates','3')),workerMemoryMb=Number(arg('--worker-memory-mb','192'));
  assert(['smoke','calibration','internal','external','controls','forecasts','reserved2020','final'].includes(scope));assert(['baseline','candidate'].includes(mode));assert(['fixed-v8','selected'].includes(cohort));
  assert(Number.isInteger(workers)&&workers>0&&Number.isInteger(reps)&&reps>0);
  assert(Number.isInteger(workerMemoryMb)&&workerMemoryMb>=128&&workerMemoryMb<=2048,'Invalid worker old-generation heap limit');
  if(['reserved2020','final'].includes(scope))assert(args.includes('--candidate-frozen'),'Reserved-year evaluation requires --candidate-frozen after parameter selection; do not fit against its output.');
  const baseline=execFileSync('git',['show',BASELINE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6});assert.equal(HASH(baseline),BASELINE_HASH,'Frozen baseline changed');
  const generatorSource=execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6});
  const sourcePath=path.resolve(ROOT,arg('--source','sim.js')),readSource=()=>{const b=fs.readFileSync(sourcePath);return (b[0]===0x1f&&b[1]===0x8b?require('node:zlib').gunzipSync(b):b).toString('utf8');};
  const source=mode==='baseline'?baseline:readSource(),parameters=JSON.parse(args.includes('--parameters')?fs.readFileSync(path.resolve(ROOT,arg('--parameters')),'utf8'):'{}');
  const ref=references();let jobs=makeJobs(scope,ref.races,reps,cohort);
  if(args.includes('--lengths')){assert(!['final','reserved2020'].includes(scope),'Do not selectively filter reserved-year validation');const lengths=arg('--lengths').split(',').map(Number);assert(lengths.every(x=>DIST.includes(x)));jobs=jobs.filter(j=>lengths.includes(j.length));assert(jobs.length>0);}
  const output=path.resolve(ROOT,arg('--out','docs/race-validation-v11-'+mode+'-'+scope+'.json'));
  const driverText=fs.readFileSync(__filename,'utf8'),driverHash=HASH(driverText),snapshotFile=output+'.source.js.gz',driverFile=output+'.driver.js.gz';
  const protocol={version:1,baselineCommit:BASELINE,baselineNormalizedSha256:BASELINE_HASH,engineNormalizedSha256:HASH(source),sourceArtifact:mode==='baseline'?'git:'+BASELINE+':sim.js':path.relative(ROOT,sourcePath),
    generatorCommit:BASE,generatorNormalizedSha256:HASH(generatorSource),scope,cohort,dt:DT,replicates:reps,parameters,referenceHashes:ref.hashes,jobs,
    split:'2023/2024 calibration; previously viewed 2022/2025 internal cross-validation; 2020 reserved year not used for this round of fitting. Validation agent has read 2020 reference pages. No claim of double-blind or population representativeness.',
    grouping:'Median across simulated seeds within each real event, then summarize events. Same distance seeds reused across main years are correlated, not independent real observations.',
    engineeringTolerance:TOLERANCE,realismGates:'Same legacy 5% winner-time, 10% individual winning600, 10% leading600, plus 10% leading200; pack and tempo residuals remain jointly reported and cannot be hidden by these broad speed gates.',
    observation:'Every executed internal tick via step(dt,onTick) callback when available; legacy source with one 60Hz tick uses outer fallback. Display frames and internal ticks are separate. Power means are weighted by executed slice time, not slice counts.',
    controlled:'Frozen v8 16-horse identity pool sliced to n; all stats70/86, neutral physiology, constant behavior, intent0.1/0.5/0.9, 0.20s reaction, deterministically ordered legal gates. Flat standard oval, no wind; fixed maximum request30 or natural AI. These are mechanism controls, not reconstructed JRA horses.',
    powerScope:'Actual committed W/kg, aerobic output and endpoint reserve release ceiling reported separately. Endpoint ceilings are not an exact active-set decomposition. Cubic air-power query assumes current airK*v^3 law, straight flat wind0; total actual shelter saving always queried from powerFor.',
    forecastScope:'Solo constant-control remaining-time prediction at rest or reached600m; no traffic/lane changes; all feasible and infeasible requests retained. One cost-query-only race initialization per controlled execution, not a stepped race.'};
  const protocolHash=HASH(JSON.stringify(protocol));let report={protocol,protocolHash,startedAt:new Date().toISOString(),samples:[],errors:[],execution:{workers,workerOldGenerationLimitMb:workerMemoryMb,closed:false,wallSeconds:0,developmentAttempts:[],driverNormalizedSha256:driverHash,sourceSnapshotArtifact:path.relative(ROOT,snapshotFile),driverSnapshotArtifact:path.relative(ROOT,driverFile)}};
  const declared=new Map(jobs.map(j=>[jobKey(j),j])),completed=new Set();let previousWall=0;
  if(resuming){
    const raw=fs.readFileSync(output,'utf8'),saved=JSON.parse(raw);assert.equal(saved.protocolHash,protocolHash,'Resume protocol/source/reference mismatch');
    assert.equal(HASH(JSON.stringify(saved.protocol)),protocolHash,'Saved protocol integrity failure');
    assert.equal(saved.execution.driverNormalizedSha256,driverHash,'Resume validation driver changed; keep the old report and use a new output path');
    assert.equal(HASH(require('node:zlib').gunzipSync(fs.readFileSync(snapshotFile)).toString('utf8')),HASH(source),'Archived source differs from resumed source');
    assert.equal(HASH(require('node:zlib').gunzipSync(fs.readFileSync(driverFile)).toString('utf8')),driverHash,'Archived validation driver differs from resumed driver');
    assert(Array.isArray(saved.samples)&&Array.isArray(saved.errors),'Malformed saved checkpoint');
    for(const row of saved.samples){assert(declared.has(row.jobKey)&&!completed.has(row.jobKey),'Foreign/duplicate saved row');
      const job=declared.get(row.jobKey);for(const [key,value] of Object.entries(job))assert.deepEqual(row[key],value,'Saved job identity mismatch');
      assert(row.inputHash&&Number.isInteger(row.frames)&&row.frames>0&&Array.isArray(row.horses)&&row.horses.length===job.n,'Incomplete saved row');
      assert.deepEqual(row.engineering,engineering(row,row.kind),'Saved engineering results inconsistent');completed.add(row.jobKey);}
    for(const error of saved.errors)if(error.jobKey){assert(declared.has(error.jobKey)&&!completed.has(error.jobKey),'Foreign/duplicate saved failure');completed.add(error.jobKey);}
    assert(Number.isFinite(saved.execution.wallSeconds)&&saved.execution.wallSeconds>=0);previousWall=saved.execution.wallSeconds;
    report={...saved,execution:{...saved.execution,workers,workerOldGenerationLimitMb:workerMemoryMb,closed:false,developmentAttempts:[...(saved.execution.developmentAttempts||[]),{resumedAt:new Date().toISOString(),checkpointSha256:sha(raw),completed:completed.size,previousWallSeconds:previousWall}]}};
  }
  if(args.includes('--check-source')||args.includes('--check-resume')){console.log(JSON.stringify({engineHash:HASH(source),protocolHash,totalJobs:jobs.length,completedJobs:completed.size,pendingJobs:jobs.length-completed.size}));process.exit(0);}
  if(!resuming){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(snapshotFile,require('node:zlib').gzipSync(source));fs.writeFileSync(driverFile,require('node:zlib').gzipSync(driverText));}
  const pending=jobs.filter(j=>!completed.has(jobKey(j))),start=Date.now();let ended=0;
  const count=Math.min(workers,pending.length);
  const allocation=count?allocateJobs(pending,count):{groups:[],estimatedCosts:[]};
  report.execution.scheduling={method:'Deterministic descending-estimated-cost greedy worker assignment; ties use declared job order and lowest worker index.',costModel:'Distance*n^2; maximum starts*0.1; official Kyoto races*3; official slightly-heavy races*1.6. Route/state factors are scheduling heuristics from source630 training costs, not isolated causal weather effects.',scope:'Relative scheduling estimates only; no task, source, seeded entrant input, physics, dt or tolerance is changed. Each job independently compiles its frozen source.',estimatedCosts:allocation.estimatedCosts,groups:allocation.groups.map((group,worker)=>({worker,jobKeys:group.map(jobKey)}))};
  if(!count){report.execution.closed=true;writeReport(report,output,ref.races);console.log(JSON.stringify({output,integrity:report.integrity}));process.exitCode=report.integrity.passedEngineering?0:1;}
  for(let i=0;i<count;i++){
    const worker=new Worker(__filename,{resourceLimits:{maxOldGenerationSizeMb:workerMemoryMb},workerData:{source,generatorSource,parameters,jobs:allocation.groups[i]}});
    worker.on('message',m=>{
      const key=m.row?.jobKey??m.jobKey;
      if(!key||!declared.has(key)||completed.has(key)){report.errors.push({error:'Foreign/duplicate worker result',received:m});}
      else{completed.add(key);if(m.error)report.errors.push(m);else report.samples.push(m.row);}
      report.execution.wallSeconds=previousWall+(Date.now()-start)/1000;writeReport(report,output,ref.races);
      console.log(JSON.stringify({done:completed.size,total:jobs.length,kind:m.row?.kind??m.job?.kind,id:m.row?.id,length:m.row?.length??m.job?.length,wallSeconds:report.execution.wallSeconds,engineering:m.row?.engineering,error:m.error??null}));
    });
    worker.on('error',e=>report.errors.push({error:String(e.stack),worker:i}));
    worker.on('exit',code=>{
      if(code)report.errors.push({error:'Worker exit '+code,worker:i});
      if(++ended===count){report.samples.sort((a,b)=>a.jobKey.localeCompare(b.jobKey));report.execution.closed=true;report.execution.wallSeconds=previousWall+(Date.now()-start)/1000;
        report.execution.sourceFileStillSameAtEnd=mode==='baseline'||HASH(readSource())===HASH(source);report.execution.validationDriverUnchanged=HASH(fs.readFileSync(__filename,'utf8'))===driverHash;
        if(args.includes('--compare'))report.pairedComparison=pairedComparison(report,JSON.parse(fs.readFileSync(path.resolve(ROOT,arg('--compare')),'utf8')));
        writeReport(report,output,ref.races);
        console.log(JSON.stringify({output,engineHash:HASH(source),protocolHash,integrity:report.integrity,wallSeconds:report.execution.wallSeconds}));
        if(!report.integrity.complete||!report.integrity.passedEngineering)process.exitCode=1;
      }
    });
  }
}
module.exports={references,makeJobs,runJob,compare,engineering,observe,controlledField,pairedComparison,compileSource,estimateJobCost,allocateJobs,BASELINE,BASELINE_HASH,METRICS,TOLERANCE};
