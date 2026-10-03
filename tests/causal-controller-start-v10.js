#!/usr/bin/env node
'use strict';
// Mechanism interventions only. Source is compiled with exact, read-only
// instrumentation; all intervention flags and parameter changes are ephemeral.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {api,fieldFor,HASH,BASE,DT,distribution:D,DIST}=require('./system-reality-v9');
const {readArchived}=require('./helpers/frozen-v8');
const ROOT=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x));
const source=fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'),expected='51caabc1395b62a325f3048aa923994516310d8c69665f3fd17b89978615b82a';
assert.equal(HASH(source),expected,'Diagnostic protocol registered for one production source');
const baseline=execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6}),B=api(baseline);
const tempoFile='docs/tempo-system-v9.json',tempoText=fs.readFileSync(path.join(ROOT,tempoFile),'utf8'),tempo=JSON.parse(tempoText);
assert(tempo.integrity.complete&&tempo.samples.length===12&&tempo.integrity.sourceUnchanged);
let diagnosticSource=source;
function insertAfter(anchor,extra){assert.equal(diagnosticSource.split(anchor).length,2,'Unique instrumentation anchor');diagnosticSource=diagnosticSource.replace(anchor,anchor+extra);}
insertAfter('      const maxDemand=attackPlan.required;',`
      if(H._causalTraceEnabled) H._causalDecision={time:race.t,s:H.s,planned,maxV:H.maxV,reserveEstimate,
        allocation,remaining,attackFeasible:attackPlan.feasible,attackRequired:attackPlan.required,
        attackSeconds:attackPlan.seconds,peakPowerShortfall:attackPlan.peakPowerShortfall,
        estimatedSupply:H.aerobic*H.retention,actualSupply:H.aerobicOutput,retention:H.retention,
        reserveRatio:H.stamina/H.staminaMax,wake:!!wake,ahead:!!ahead,obstruction:!!localFront};`);
insertAfter('      const motion=new Map(),motionModel=new Map(),denied=new Set(),marginRecovery=new Set();',`
      for(const H of act) if(Number.isFinite(H._causalFixedLane)) H.targetT=H._causalFixedLane;`);
insertAfter('        let nextV=Math.max(0,H.v+a*dt*startFraction);',`
        if(H._causalTraceEnabled) {
          const speedCap=H.maxV*fatigue,powerCap=speedAtPower(H,maxPower,!!wake);
          const curveCap=curvature>0?Math.sqrt(Math.max(1,(RACE_F.curveLateral+(H.adj['力量']-70)*0.008)/curvature))*bendCoefFor(H.h.special,dir):null;
          H._causalTrace={time:race.t,s:before.s,v:before.v,targetV:H.targetV,desired,cap,speedCap,powerCap,curveCap,
            curvature,grad,reserveRatio:stRatio,reserveFade,fatigue,retention:H.retention,
            aerobic,maximumAerobic:H.aerobic,reservePower,maxPower,steadyPower:powerCost(H,H.v,0,!!wake),
            kineticBudget,maxA,response,requestedA:(desired-H.v)/response,chosenA:a,candidateV:nextV,
            gateOpen:!!startFraction,startFraction,blocked:!!front,drafting:!!wake};
        }`);
insertAfter('        motion.set(H,paidProposal(nextV));H.pot=desired;',`
        if(H._causalTraceEnabled) H._causalTrace.paidV=motion.get(H).v;`);
const variants=['ai-fixed-lane','maximum-request','acceleration-minus10','acceleration-plus10','acceleration-plus25',
  'speed-cap-minus10','speed-cap-plus10','speed-cap-plus25','response-minus25','reserve-release-plus25','oxygen-established','oxygen-tau-minus25'];
const rows=[],full=[],proof=[],jobs=[],startedAt=new Date().toISOString();
function raceFor(job,index,S){const field=fieldFor(job,B,S),r=S.createRace([clone(field[index])],{length:job.length,course:job.course,dir:job.dir,surface:'草地',state:'良',profile:'平坦',wind:0,rng:S.mulberry32(job.raceSeed)}),H=r.race.horses[0];
  // Recreate exact original 16-horse initial lane and reaction delay; single
  // horse creation consumes a different gate shuffle stream, so restore both.
  const init=tempo.samples.find(x=>x.job.length===job.length&&x.job.replicate===job.replicate)?.crowd.initial[index];
  assert(init,'Missing original cohort initial state');Object.assign(H,{t:init.t,targetT:init.t,startDelay:init.startDelay,gate:init.gate,aiBias:init.aiBias});
  return {r,H,field:field[index],initial:clone(init)};
}
function cv(a){if(!a.length)return null;const mean=a.reduce((s,x)=>s+x,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-mean)**2,0)/a.length)/mean;}
function count(keys){return Object.fromEntries(keys.map(k=>[k,0]));}
const capNames=['request','speed','power','curve','front'];
const accelNames=['response','mechanical','power','braking','gate'];
function capBinds(x,name){if(name==='front')return x.blocked&&x.desired<x.cap-1e-7;
  const v=name==='request'?x.targetV:name==='speed'?x.speedCap:name==='power'?x.powerCap:x.curveCap;
  return Number.isFinite(v)&&Math.abs(v-x.desired)<1e-7;}
function accelBinds(x,name){if(name==='gate')return !x.gateOpen;if(!x.gateOpen)return false;
  const a=name==='response'?x.requestedA:name==='mechanical'?x.maxA:name==='power'?x.kineticBudget:-apiValues.braking;
  return Math.abs(x.chosenA-a)<1e-7;}
const apiValues=api(source).RACE_F;
function run(job,index,variant,stop=600,constant=null,instrumented=true){
  const S=api(instrumented?diagnosticSource:source),{r,H,field,initial}=raceFor(job,index,S),lane=H.t;
  H._causalTraceEnabled=instrumented;H._causalFixedLane=lane;
  if(variant!=='ai-fixed-lane'&&variant!=='ai-natural-lane')H.control={targetV:constant??30,targetT:lane};
  if(variant==='ai-natural-lane')delete H._causalFixedLane;
  if(variant==='acceleration-minus10'){S.RACE_F.maxAccel*=.9;S.RACE_F.runningAccel*=.9;}
  if(variant==='acceleration-plus10'){S.RACE_F.maxAccel*=1.1;S.RACE_F.runningAccel*=1.1;}
  if(variant==='acceleration-plus25'){S.RACE_F.maxAccel*=1.25;S.RACE_F.runningAccel*=1.25;}
  if(variant==='speed-cap-plus10')H.maxV*=1.1;
  if(variant==='speed-cap-plus25')H.maxV*=1.25;
  if(variant==='speed-cap-minus10')H.maxV*=.9;
  if(variant==='response-minus25')S.RACE_F.responseTime*=.75;
  if(variant==='reserve-release-plus25')H.reservePower*=1.25;
  if(variant==='oxygen-established')H.aerobicOutput=H.aerobic;
  if(variant==='oxygen-tau-minus25')H.aerobicTau*=.75;
  const marks={},samples=[],decisions=[],capFrames=count(capNames),accelFrames=count(accelNames),earlyAccelFrames=count(accelNames),capAfter200=count(capNames);
  let frame=0,postCount=0,targetSum=0,targetSquare=0,actualSum=0,actualSquare=0,powerPaidFrames=0,unusedPowerSum=0,speedWithExcessPowerFrames=0,maxLaneDeviation=0,lastDecision=-1,capEarly=0;
  while(H.s<stop&&!H.place&&r.race.t<610){const oldS=H.s,oldT=r.race.t;r.step(DT);frame++;
    for(const m of [10,50,100,200,400,600])if(oldS<m&&H.s>=m)marks[m]=H.sectionals.find(x=>x.distance===m)?.time??oldT+DT*(m-oldS)/(H.s-oldS);
    maxLaneDeviation=Math.max(maxLaneDeviation,Math.abs(H.t-lane));
    if(instrumented){const x=H._causalTrace;
      for(const k of capNames)if(capBinds(x,k)){capFrames[k]++;if(x.s>=200)capAfter200[k]++;}
      for(const k of accelNames)if(accelBinds(x,k)){accelFrames[k]++;if(x.s<200)earlyAccelFrames[k]++;}
      if(x.paidV<x.candidateV-1e-8)powerPaidFrames++;
      if(x.s<200)capEarly++;
      unusedPowerSum+=Math.max(0,x.maxPower-H.power);
      if(x.s>=200&&capBinds(x,'speed')&&x.maxPower-H.power>1)speedWithExcessPowerFrames++;
      if(frame%60===1||H.s>=stop||H.place)samples.push({...x,actualTime:r.race.t,actualS:H.s,actualV:H.v,actualPower:H.power,
        unusedPower:x.maxPower-H.power,mode:H.strategy?.mode??'fixed',reserveAfter:H.stamina/H.staminaMax,
        speedBindings:capNames.filter(k=>capBinds(x,k)),accelerationBindings:accelNames.filter(k=>accelBinds(x,k))});
      if(H._causalDecision?.time!==lastDecision&&H._causalDecision){lastDecision=H._causalDecision.time;decisions.push({...H._causalDecision,mode:H.strategy?.mode,targetV:H.targetV});}
    }
    if(H.s>=200){postCount++;targetSum+=H.targetV;targetSquare+=H.targetV**2;actualSum+=H.v;actualSquare+=H.v**2;}
  }
  const sectionals=H.sectionals.map(x=>({distance:x.distance,time:x.time,split:x.split}));
  assert(H.s>=stop||H.place,'Incomplete diagnostic');if(variant!=='ai-natural-lane')assert(maxLaneDeviation<1e-12,'Lane drift');
  const result={job:clone(job),index,id:H.id,variant,stop,constant,initial,stats:clone(H.adj),physiology:clone(H.physiology),
    parameterValues:{maxAccel:S.RACE_F.maxAccel,runningAccel:S.RACE_F.runningAccel,maxV:H.maxV,reservePower:H.reservePower,aerobic:H.aerobic,tau:H.aerobicTau,response:S.RACE_F.responseTime},
    marks,sectionals,finishTime:H.time,final600:H.final3f,last200Difference:stop===job.length?sectionals.at(-1).split-sectionals.at(-2).split:null,
    post200SectionalCv:cv(sectionals.slice(1).map(x=>Math.round(x.split*10)/10)),
    post200TargetMean:targetSum/postCount,post200TargetCv:Math.sqrt(Math.max(0,targetSquare/postCount-(targetSum/postCount)**2))/(targetSum/postCount),
    post200ActualMean:actualSum/postCount,post200ActualCv:Math.sqrt(Math.max(0,actualSquare/postCount-(actualSum/postCount)**2))/(actualSum/postCount),
    reserveFraction:H.stamina/H.staminaMax,retention:H.retention,meanUnusedPower:unusedPowerSum/frame,
    speedWithExcessPowerFraction:postCount?speedWithExcessPowerFrames/postCount:0,
    capFrames,capAfter200,accelFrames,earlyAccelFrames,powerPaidFrames,frames:frame,earlyFrames:capEarly,post200Frames:postCount,
    maxLaneDeviation,workError:Math.abs(H.statsSummary.workUsed-H.statsSummary.aerobicUsed-H.statsSummary.energyUsed),unpaid:H.statsSummary.unpaidWork,
    samples,decisions,physicalEnd:{s:H.s,t:H.t,v:H.v,stamina:H.stamina,guts:H.guts,retention:H.retention,cumulativeWork:H.cumulativeWork,aerobicOutput:H.aerobicOutput,sectionals,statsSummary:clone(H.statsSummary)}};
  assert(Number.isFinite(result.marks[200]));return result;
}
function enrich(report){
  report.summary.activeSet=variants.map(variant=>{
    const group=report.samples.filter(x=>x.variant===variant),early=group.reduce((s,x)=>s+x.earlyFrames,0),all=group.reduce((s,x)=>s+x.frames,0);
    return {variant,earlyFrames:early,frames:all,
      earlyAccelerationFractions:Object.fromEntries(accelNames.map(k=>[k,group.reduce((s,x)=>s+x.earlyAccelFrames[k],0)/early])),
      speedCapFractionsTo600:Object.fromEntries(capNames.map(k=>[k,group.reduce((s,x)=>s+x.capFrames[k],0)/all])),
      paidProposalFraction:group.reduce((s,x)=>s+x.powerPaidFrames,0)/all};
  });
  report.summary.wholeRace.physicalSpeedCv=D(report.fullRaces.filter(x=>x.variant==='ai-fixed-lane').map(x=>x.post200ActualCv));
  report.summary.wholeRace.perDistance.forEach(d=>{
    const group=report.fullRaces.filter(x=>x.variant==='ai-fixed-lane'&&x.job.length===d.length);
    d.physicalSpeedCv=D(group.map(x=>x.post200ActualCv));
    d.speedCapFractionsAfter200=Object.fromEntries(capNames.map(k=>[k,group.reduce((s,x)=>s+x.capAfter200[k],0)/group.reduce((s,x)=>s+x.post200Frames,0)]));
  });
  return report;
}
if(process.argv.includes('--summarize-only')){
  const file=path.join(ROOT,'docs/causal-controller-start-v10.json'),saved=JSON.parse(readArchived(file));
  assert.equal(saved.engineHash,HASH(source));assert.equal(saved.inputHashes[tempoFile],HASH(tempoText));
  assert(saved.integrity.complete&&saved.samples.length===144&&saved.fullRaces.length===24);
  fs.writeFileSync(file,JSON.stringify(enrich(saved))+'\n');console.log('Summaries regenerated from complete raw diagnostic samples; no new engine run.');process.exit(0);
}
// Read-only instrumentation equality check with no AI steering intervention.
for(const length of [1200,2400]){const job=clone(tempo.samples.find(x=>x.job.length===length&&x.job.replicate===0).job),a=run(job,0,'maximum-request',600,null,true),b=run(job,0,'maximum-request',600,null,false);
  assert.deepEqual(a.physicalEnd,b.physicalEnd);proof.push({length,index:0,frames:a.frames,exactPhysicalEnd:true,exactSectionals:true});}
for(const length of [1200,2400])for(const replicate of [0,1])for(const index of [0,7,15]){
  const job=clone(tempo.samples.find(x=>x.job.length===length&&x.job.replicate===replicate).job);jobs.push({job,index});
  for(const variant of variants){rows.push(run(job,index,variant));}
  console.log(JSON.stringify({completedStarts:jobs.length,totalRows:rows.length,length,replicate,index}));
}
// AI strategy and matched constant request share fixed lateral path. The mean
// request is post hoc for diagnosis, not an admissible real rider policy.
for(const length of DIST)for(const replicate of [0,1]){const job=clone(tempo.samples.find(x=>x.job.length===length&&x.job.replicate===replicate).job);
  const ai=run(job,0,'ai-fixed-lane',length);full.push(ai,run(job,0,'constant-mean-request',length,ai.post200TargetMean));
  console.log(JSON.stringify({completedFull:full.length,length,replicate}));}
function paired(variant,ref,metric,group=rows,length=null){const data=group.filter(x=>x.variant===variant&&(length===null||x.job.length===length));
  return D(data.map(x=>{const b=group.find(y=>y.variant===ref&&y.job.length===x.job.length&&y.job.replicate===x.job.replicate&&y.index===x.index);assert(b,'Missing paired arm');return metric(x)-metric(b);}));}
const byDistance=DIST.map(length=>{const group=tempo.samples.filter(x=>x.job.length===length),horses=group.flatMap(x=>x.crowd.horses),modes=horses.reduce((o,h)=>{for(const [k,v]of Object.entries(h.modeSeconds))o[k]=(o[k]||0)+v;return o;},{}),sum=Object.values(modes).reduce((s,x)=>s+x,0);
  const individualCv=h=>cv(h.sectionals.slice(1).map(x=>Math.round(x.split*10)/10));
  return {length,horses:horses.length,targetCv:D(horses.map(x=>x.targetVAfter200.cv)),targetRange:D(horses.map(x=>x.targetVAfter200.max-x.targetVAfter200.min)),
    individualCv:D(horses.map(individualCv)),soloIndividualCv:D(group.flatMap(x=>x.solo.horses).map(individualCv)),
    winnerCv:D(group.map(x=>individualCv(x.crowd.horses.find(h=>h.place===1)))),
    reserveAtFinish:D(horses.map(x=>x.reserveFraction)),actualMinusTarget:D(horses.map(x=>x.targetVsActualAfter200.meanActual-x.targetVsActualAfter200.meanTarget)),
    modeFractions:Object.fromEntries(Object.entries(modes).map(([k,v])=>[k,v/sum])),crowdCv:D(group.map(x=>x.crowd.metrics.post200Cv)),soloCv:D(group.map(x=>x.solo.metrics.post200Cv))};});
const summary={starts:variants.map(variant=>({variant,first200:D(rows.filter(x=>x.variant===variant).map(x=>x.marks[200])),first400:D(rows.filter(x=>x.variant===variant).map(x=>x.marks[400])),first600:D(rows.filter(x=>x.variant===variant).map(x=>x.marks[600])),
  pairedAgainstMaximum:{first200:paired(variant,'maximum-request',x=>x.marks[200]),first400:paired(variant,'maximum-request',x=>x.marks[400]),first600:paired(variant,'maximum-request',x=>x.marks[600])},
  perDistance:[1200,2400].map(length=>({length,first200:D(rows.filter(x=>x.variant===variant&&x.job.length===length).map(x=>x.marks[200])),pairedFirst200:paired(variant,'maximum-request',x=>x.marks[200],rows,length)}))})),
  wholeRace:{aiCv:D(full.filter(x=>x.variant==='ai-fixed-lane').map(x=>x.post200SectionalCv)),constantCv:D(full.filter(x=>x.variant==='constant-mean-request').map(x=>x.post200SectionalCv)),
    pairedTime:paired('constant-mean-request','ai-fixed-lane',x=>x.finishTime,full),pairedLast200Difference:paired('constant-mean-request','ai-fixed-lane',x=>x.last200Difference,full),
    perDistance:DIST.map(length=>({length,aiCv:D(full.filter(x=>x.variant==='ai-fixed-lane'&&x.job.length===length).map(x=>x.post200SectionalCv)),
      constantCv:D(full.filter(x=>x.variant==='constant-mean-request'&&x.job.length===length).map(x=>x.post200SectionalCv)),
      aiTargetCv:D(full.filter(x=>x.variant==='ai-fixed-lane'&&x.job.length===length).map(x=>x.post200TargetCv)),
      speedWithExcessPowerFraction:D(full.filter(x=>x.variant==='ai-fixed-lane'&&x.job.length===length).map(x=>x.speedWithExcessPowerFraction)),
      reserveAtFinish:D(full.filter(x=>x.variant==='ai-fixed-lane'&&x.job.length===length).map(x=>x.reserveFraction)),pairedTime:paired('constant-mean-request','ai-fixed-lane',x=>x.finishTime,full,length)}))},
  existingTempo:byDistance};
const report={engineHash:HASH(source),instrumentedHash:HASH(diagnosticSource),baselineHash:HASH(baseline),startedAt,completedAt:new Date().toISOString(),
  inputHashes:{[tempoFile]:HASH(tempoText)},protocol:{dt:DT,pairedStarts:12,startRows:144,wholeRaces:24,instrumentationProofs:2,
    reference:'Synthetic level86 v8-generated 16-horse cohort; indices 0/7/15, two seeds, two courses; preserve original gate, delay and lateral start. Does not reconstruct individual JRA horses.',
    fixedLane:'AI and fixed-control arms hold the same original lane throughout. AI still observes only a solo race; opponent strategy is not tested.',
    interventions:variants,units:'Mechanical equivalent W/kg/J/kg in current model; not a direct equine metabolic measurement.',
    activeSet:'Speed limiting constraints tested against desired v, allowing ties. Acceleration constraints tested against clipped proposal, allowing ties. Paid-proposal reductions separately counted; fractions are frame-weighted, not distance-weighted.',
    noCoefficientFitting:true,mutations:'In-memory module parameters and individual ephemeral horse state only. No production writes.',
    constantRequest:'Whole-race control uses the same AI horse post200 time-weighted mean target, identified after the AI run; explanatory diagnostic, not a real-time rider rule.',
    evidenceBoundary:'Current source differs from old tempo source; old measurements are labelled existingTempo and retain their own input engineHash. Current new interventions are measured on engineHash.'},
  existingTempoEngineHash:tempo.engineHash,instrumentationProofs:proof,samples:rows,fullRaces:full,summary,
  integrity:{complete:rows.length===144&&full.length===24&&proof.length===2,sourceUnchanged:HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'))===HASH(source),
    inputUnchanged:HASH(fs.readFileSync(path.join(ROOT,tempoFile),'utf8'))===HASH(tempoText),allFinite:[...rows,...full].every(x=>Number.isFinite(x.marks[200])&&Number.isFinite(x.reserveFraction)),
    maxWorkError:Math.max(...[...rows,...full].map(x=>x.workError)),maxUnpaid:Math.max(...[...rows,...full].map(x=>x.unpaid))}};
enrich(report);
fs.writeFileSync(path.join(ROOT,'docs/causal-controller-start-v10.json'),JSON.stringify(report)+'\n');
console.log(JSON.stringify({summary,integrity:report.integrity},null,2));
assert(report.integrity.complete&&report.integrity.sourceUnchanged&&report.integrity.inputUnchanged&&report.integrity.allFinite&&report.integrity.maxWorkError<1e-6&&report.integrity.maxUnpaid<1e-6);
