#!/usr/bin/env node
'use strict';
// Constructed local counterexamples after reading the implementation. These
// are not natural-race observations or preregistered reality calibration data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {api,HASH}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'),engineHash=HASH(source);
assert.equal(engineHash,'51caabc1395b62a325f3048aa923994516310d8c69665f3fd17b89978615b82a','Registered production source changed');
const normal=source.replace(/\r\n/g,'\n'),clone=x=>JSON.parse(JSON.stringify(x));
const output=path.join(ROOT,'docs/causal-follow-opportunity-v10.json');
const previousText=fs.existsSync(output)?fs.readFileSync(output,'utf8'):null,previous=previousText?JSON.parse(previousText):null;
const developmentAttempts=previous?.developmentAttempts?clone(previous.developmentAttempts):[];
if(previous){
  assert.equal(previous.engineHash,engineHash);const previousHash=HASH(previousText);
  if(!developmentAttempts.some(x=>x.artifactContentHash===previousHash)){
    const core=clone(previous);delete core.developmentAttempts;delete core.developmentAccounting;
    developmentAttempts.push({kind:'earlier-successful-local-witness-invocation',artifactContentHash:previousHash,
      budgetDraftDistance:previous.protocol.budgetDraftDistance??0,counts:clone(previous.protocol.counts),priorReport:core});
  }
}
const failureLog=path.join(process.env.TEMP||process.env.TMP||ROOT,'saima-causal-follow-opportunity-v10-attempt1-log.txt');
if(fs.existsSync(failureLog)&&!developmentAttempts.some(x=>x.kind==='unexported-body-width-helper-development-error')){
  const log=fs.readFileSync(failureLog,'utf8').replaceAll(ROOT,'<repo>').replaceAll(ROOT.replace(/\\/g,'/'),'<repo>');
  assert(log.includes('TypeError: S.horseWid is not a function'));
  developmentAttempts.push({kind:'unexported-body-width-helper-development-error',engineHash,budgetDraftDistance:0,
    phase:'After both local witnesses and 22 successful forecast/purity checks, before wake geometry and output generation.',
    counts:{compiledProductionModules:1,createdRaceInstances:2,forecastQueries:22,forecastPurityChecks:22,engineStepCalls:0,fullRaceExecutions:0},
    error:{name:'TypeError',message:'S.horseWid is not a function',sanitizedLog:log},
    correction:'Private horseWid is not exported. Reproduce its formula only after matching its complete exact production declaration.'});
}
const clauses={
  bodyWidth:"  function horseWid(H) { return 0.65+0.15*(H.adj['体格']/100); }",
  aiWake:"      const wake=near.find(F=>F.s>H.s+3 && F.s-H.s<12 && Math.abs(F.t-H.t)<2.5);",
  actualWake:"        const wake=act.find(F=>F!==H && old.get(F).s>before.s && old.get(F).s-before.s<=RACE_F.draftRange &&\n          Math.abs(old.get(F).t-before.t)<=(horseWid(H)+horseWid(F))/2+0.8);",
  draftBudget:"      const planned=budgetSpeed(H,reserveEstimate*allocation,wake?Math.min(44,remaining):0);",
  horizon:"          const horizon=Math.min(8,(wake.s-H.s)/Math.max(0.1,planned-observedPace),remaining/Math.max(3,planned));",
  lostDistance:"          const lostDistance=Math.max(0,planned-following)*horizon;",
  catchWindow:"          const catchWindow=Math.min(8,Math.max(0,remaining/Math.max(3,planned)-horizon));",
  catchV:"          const catchV=planned+lostDistance/Math.max(0.1,catchWindow);",
  fullRemainingCheck:"          const canRegain=catchWindow>0.5&&finishPlan(H,catchV,0,{reserve:reserveEstimate}).feasible;",
  forecastFrom:"      const from=clamp(H.s,0,length),draftEnd=Math.min(length,from+Math.max(0,draftDistance));",
  requestClamp:"        let target=Math.max(3,Math.min(requestedV,projectedCap(H,at)));",
  budget:"    function budgetSpeed(H,reserve,draftDistance=0) {\n      let low=3,high=H.maxV;\n      for(let i=0;i<9;i++) {\n        const mid=(low+high)/2;\n        if(finishPlan(H,mid,draftDistance,{reserve}).feasible) low=mid;else high=mid;\n      }\n      return low;\n    }"
};
const evidence=Object.fromEntries(Object.entries(clauses).map(([key,text])=>{
  assert.equal(normal.split(text).length,2,'Unique production clause: '+key);
  return [key,{line:normal.slice(0,normal.indexOf(text)).split('\n').length,hash:HASH(text),text}];
}));
const counts={compiledProductionModules:1,createdRaceInstances:0,forecastQueries:0,forecastPurityChecks:0,engineStepCalls:0,fullRaceExecutions:0};
const S=api(source),F=clone(S.RACE_F),options={length:2400,course:'東京芝A',surface:'草地',state:'良',profile:'平坦',wind:0};
const constructedStates=[{s:2200,reserve:800},{s:2000,reserve:1200}];
function make(state){
  const horse={id:'follow-local-witness70',name:'follow-local-witness70',stats:Object.fromEntries(['速度','爆发力','出闸能力','耐力','力量','毅力','体格','智力'].map(k=>[k,70])),
    physiology:S.neutralPhysiology(),behavior:{forwardness:.5,settle:.5,tractability:.65},surface:'草地',special:'左右皆可',
    jockeyGrade:'优秀',bodyMass:480,carriedWeight:57,'斗志':50,'疲劳':0};
  const r=S.createRace([horse],{...options,rng:S.mulberry32(1)});counts.createdRaceInstances++;
  // No engine step is allowed in this diagnostic.
  r.step=()=>{counts.engineStepCalls++;throw new Error('This local witness must not step the race');};
  const H=r.race.horses[0];Object.assign(H,{s:state.s,t:1.4,targetT:1.4,v:18.6,stamina:state.reserve,aerobicOutput:H.aerobic});
  assert(H.s>=0&&H.s<options.length&&H.v<=H.maxV&&H.stamina<=H.staminaMax&&H.guts===H.gutsMax);
  return {r,H};
}
function forecast(H,requestedV,options={},draftDistance=0){
  const before=HASH(JSON.stringify(H));counts.forecastQueries++;const result=H.finishPlan(requestedV,draftDistance,options);
  assert.equal(HASH(JSON.stringify(H)),before,'Forecast changed constructed horse state');counts.forecastPurityChecks++;
  return result;
}
function budget(H,reserve,draftDistance){let low=3,high=H.maxV;const queries=[];
  for(let n=0;n<9;n++){const requested=(low+high)/2,result=forecast(H,requested,{reserve},draftDistance);queries.push({requested,reserve,draftDistance,...result});if(result.feasible)low=requested;else high=requested;}
  return {planned:low,queries};
}
const witnesses=constructedStates.map(state=>{
  const {r,H}=make(state),preState=clone(H),preStateHash=HASH(JSON.stringify(H)),risk=H.plan.risk,allocation=S.clamp(.96+.025*risk,.96,.985);
  const remaining=options.length-H.s,budgetDraftDistance=Math.min(44,remaining),{planned,queries}=budget(H,state.reserve*allocation,budgetDraftDistance);
  const observedPace=planned-.16,following=Math.min(planned,observedPace+.06),frontGap=8;
  // These expressions mirror the exact asserted source clauses. Speed error
  // and reserve error are set to zero; this is not a call to natural runAI.
  const horizon=Math.min(8,frontGap/Math.max(.1,planned-observedPace),remaining/Math.max(3,planned));
  const lostDistance=Math.max(0,planned-following)*horizon;
  const catchWindow=Math.min(8,Math.max(0,remaining/Math.max(3,planned)-horizon));
  const catchV=planned+lostDistance/Math.max(.1,catchWindow);
  const saving=Math.max(0,H.powerFor(planned,0,false)-H.powerFor(following,0,true))*horizon;
  const regainCost=Math.max(0,H.powerFor(catchV,0,false)-H.powerFor(planned,0,false))*catchWindow+H.kineticCost(following,catchV);
  const catchPlan=forecast(H,catchV,{reserve:state.reserve}),maximumPlan=forecast(H,H.maxV,{reserve:state.reserve});
  assert(catchV>H.maxV&&catchPlan.feasible);assert.deepEqual(catchPlan,maximumPlan);
  const maximumGainEvenWithInstantaneousSpeed=Math.max(0,H.maxV-planned)*catchWindow;
  assert(maximumGainEvenWithInstantaneousSpeed<lostDistance);
  assert.equal(HASH(JSON.stringify(H)),preStateHash);
  return {kind:'constructed-local-counterexample',requestedState:state,preState,preStateHash,allocation,budgetDraftDistance,budgetQueries:queries,
    planned,observedPace,following,frontGap,remaining,horizon,catchWindow,lostDistance,catchV,maxV:H.maxV,saving,regainCost,benefit:saving-regainCost,
    catchPlan,maximumPlan,forecastFeasible:true,plansExactlyEqual:true,maximumGainEvenWithInstantaneousSpeed,
    shortfallAgainstAssumedLostDistance:lostDistance-maximumGainEvenWithInstantaneousSpeed,
    explanation:'Even an instantaneous jump to the absolute maxV cannot regain the model-assumed lost distance inside this catch window. finishPlan instead clips the excessive request and reports full-remainder energy feasibility.',
    naturalAiOutcome:'Not tested. The attack branch precedes follow; these states may choose attack and never evaluate the follow branch.',
    gainScope:'Relative to the assumed planned-speed baseline over the same window. Not a claim about actual executed lost distance, which would require propagating finite response and the preceding follow state.',
    geometry:{s:H.s,lane:H.t,curvature:S.laneCurvatureAt(H.s,H.t,r.race.geo),gradient:S.gradientAt(H.s,r.race.geo,r.race.g)}};
});
const horseWidth=H=>.65+.15*(H.adj['体格']/100);
const body={adj:{'体格':70}},rearWidth=horseWidth(body),frontWidth=horseWidth(body),actualLateralLimit=(rearWidth+frontWidth)/2+.8,aiLateralLimit=2.5;
const geometricCases=[{gap:8,lateral:1.5},{gap:8,lateral:1.56},{gap:8,lateral:1.8},{gap:8,lateral:2.49},
  {gap:8,lateral:2.5},{gap:2.9,lateral:0},{gap:12,lateral:0}].map(c=>({...c,
    aiWake:c.gap>3&&c.gap<12&&Math.abs(c.lateral)<aiLateralLimit,
    actualWake:c.gap>0&&c.gap<=S.RACE_F.draftRange&&Math.abs(c.lateral)<=actualLateralLimit}));
assert(geometricCases.find(c=>c.lateral===1.8).aiWake&&!geometricCases.find(c=>c.lateral===1.8).actualWake);
assert(!geometricCases.find(c=>c.gap===2.9).aiWake&&geometricCases.find(c=>c.gap===2.9).actualWake);
const report={engineHash,startedAt:new Date().toISOString(),protocol:{
  identification:'Exploratory constructed local counterexamples after source review; not preregistered real-data calibration, not naturally observed AI decisions.',
  noProductionOrParameterMutation:true,counts,budgetDraftDistance:44,sourceArtifact:'sim.js',seed:1,raceOptions:options,constructedStates,
  state:'One neutral70 horse per instance, full guts, established aerobic output, prescribed s/v/lane/reserve. Construction is intentional and not sampled from a natural race.',
  forecastScope:'Actual production H.finishPlan queried. Nine-step budget reproduction is guarded by its exact production text. Full horse JSON is hashed before and after every forecast query.',
  limit:'Natural occurrence frequency, the sign/size of population effects and an actual over-strict rejection counterfactual remain unidentified. No adaptive policy or pack execution is performed.'},
  developmentAttempts,
  developmentAccounting:{scope:'Recorded prior invocations plus current artifact invocation, counted separately from actual stepped race experiments.',
    total:Object.fromEntries(Object.keys(counts).map(k=>[k,counts[k]+developmentAttempts.reduce((s,x)=>s+(x.counts?.[k]||0),0)]))},
  evidence,witnesses,wakeGeometry:{rearWidth,frontWidth,actualLateralLimit,aiLateralLimit,actualLongitudinalRange:[0,S.RACE_F.draftRange],
    actualLongitudinalInclusivity:{minimum:false,maximum:true},aiLongitudinalRange:[3,12],aiLongitudinalInclusivity:{minimum:false,maximum:false},
    aiOnlyLateralBand:{minimum:actualLateralLimit,minimumInclusive:false,maximum:aiLateralLimit,maximumInclusive:false},geometricCases,
    caveat:'Geometric eligibility only. No assertion that all such initial two-horse configurations pass the complete traffic safety domain.',
    forecastDraftDistance:44,forecastDraftDistanceScope:'Nominal own progress; not the physical 12m following-gap range. The current forecast does not propagate gap or lateral alignment.'},
  structuralRisk:{checkRequest:'catchV',checkDuration:'All remaining route from current state',intendedActionDurations:'follow horizon <=8s, catch window <=8s',
    missingPropagation:['Following changes speed, reserve, guts and aerobic output before catch begins.','Catch must recover actual executed lost distance inside its feasible action window.','Both opponent gap and lateral alignment determine actual shielding over time.'],
    overlyStrictRejection:'Plausible from code structure; not claimed as demonstrated by an exact executed counterfactual here.'},
  integrity:{sourceUnchanged:HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'))===engineHash,parametersUnchanged:JSON.stringify(S.RACE_F)===JSON.stringify(F),
    exactClausesMatched:Object.keys(evidence).length===12,witnessCount:witnesses.length,allWitnessesPassed:witnesses.every(x=>x.catchV>x.maxV&&x.forecastFeasible&&x.plansExactlyEqual&&x.shortfallAgainstAssumedLostDistance>0),
    allForecastsPure:counts.forecastQueries===counts.forecastPurityChecks,allFinite:witnesses.every(x=>[x.planned,x.horizon,x.catchWindow,x.catchV,x.catchPlan.seconds,x.benefit].every(Number.isFinite)),
    noEngineStepOrFullRace:counts.engineStepCalls===0&&counts.fullRaceExecutions===0}};
assert(report.integrity.sourceUnchanged&&report.integrity.parametersUnchanged&&report.integrity.exactClausesMatched&&report.integrity.allWitnessesPassed&&report.integrity.allForecastsPure&&report.integrity.allFinite&&report.integrity.noEngineStepOrFullRace);
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({counts,witnesses:witnesses.map(x=>({s:x.preState.s,planned:x.planned,catchWindow:x.catchWindow,catchV:x.catchV,maxV:x.maxV,forecastFeasible:x.forecastFeasible,lostDistance:x.lostDistance,maximumGain:x.maximumGainEvenWithInstantaneousSpeed,benefit:x.benefit})),wakeGeometry:report.wakeGeometry,integrity:report.integrity},null,2));
