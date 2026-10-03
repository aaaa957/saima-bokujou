#!/usr/bin/env node
'use strict';
// Measurement-only join. No parameter search and no percentile-based fit gates.
const fs=require('node:fs'),path=require('node:path');
const {q,distribution:D,HASH}=require('./system-reality-v9');
const {readArchived}=require('./helpers/frozen-v8');
const {verify:verifySource}=require('./helpers/v9-numeric-snapshot');
const ROOT=path.resolve(__dirname,'..'),read=f=>JSON.parse(readArchived(path.join(ROOT,'docs',f)).toString('utf8'));
const metrics=['winnerTime','winnerFinal600','marginSeconds','tailSeconds','within1','within2','final600Span','first200','post200Cv','last200Difference','winnerMeanSpeed','fastestLeader200Speed'];
const cv=a=>{const m=a.reduce((s,x)=>s+x,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length)/m;};
function realMetrics(r){
  const h=r.horses.filter(h=>Number.isFinite(h.finishTime)).sort((a,b)=>a.finishPosition-b.finishPosition),w=h[0],s=r.raceSectionals200m,g=h.map(h=>h.finishTime-w.finishTime),f=h.map(h=>h.final600).filter(Number.isFinite);
  return {winnerTime:w.finishTime,winnerFinal600:w.final600,marginSeconds:h[1].finishTime-w.finishTime,tailSeconds:Math.max(...g),within1:g.filter(x=>x<=1+1e-8).length/h.length,within2:g.filter(x=>x<=2+1e-8).length/h.length,final600Span:Math.max(...f)-Math.min(...f),first200:s[0],post200Cv:cv(s.slice(1)),last200Difference:s.at(-1)-s.at(-2),first600:s.slice(0,3).reduce((a,b)=>a+b,0),winnerMeanSpeed:r.length/w.finishTime,fastestLeader200Speed:200/Math.min(...s)};
}
function predicted(runs){return Object.fromEntries([...metrics,'first600'].map(k=>[k,q(runs.map(r=>k==='first600'?r.leaderSectionals.slice(0,3).reduce((a,b)=>a+b,0):k==='winnerMeanSpeed'?r.length/r.winnerTime:k==='fastestLeader200Speed'?200/Math.min(...r.leaderSectionals):r[k]))]));}
function nominalMarginCategory(n,raw=''){
  if(['ハナ','アタマ','クビ'].includes(raw)||Number.isFinite(n)&&n<1)return '<1';
  if(Number.isFinite(n))return n<=3?'1–3':'>3';
  return 'unknown';
}
function join(ref,b,c,context){
  const paired=ref.races.map(r=>{const old=b.samples.filter(x=>x.context===context&&String(x.id)===String(r.id)),now=c.samples.filter(x=>x.context===context&&String(x.id)===String(r.id));
    if(old.length!==3||now.length!==3)throw new Error('Missing paired runs: '+r.id);
    const second=r.horses.find(h=>h.finishPosition===2),baselineLengths=q(old.map(x=>x.marginLengths)),currentLengths=q(now.map(x=>x.marginLengths));
    return {id:r.id,length:r.length,n:r.fieldSize,source:r.source.url,real:realMetrics(r),baseline:predicted(old),current:predicted(now),margin:{
      real:{raw:second.marginFromPreviousRaw,numericLengths:second.numericMarginLengths??null,category:nominalMarginCategory(second.numericMarginLengths,second.marginFromPreviousRaw)},
      baseline:{nominalLengths:baselineLengths,category:nominalMarginCategory(baselineLengths)},current:{nominalLengths:currentLengths,category:nominalMarginCategory(currentLengths)}}};});
  const aggregate=Object.fromEntries(metrics.map(k=>[k,Object.fromEntries(['real','baseline','current'].map(arm=>[arm,D(paired.map(r=>r[arm][k]))]))]));
  const errors=Object.fromEntries(['baseline','current'].map(arm=>[arm,Object.fromEntries(['winnerTime','winnerFinal600','first600'].map(k=>[k,D(paired.map(r=>Math.abs(r[arm][k]/r.real[k]-1)*100))]))]));
  const positions=['逃','先','差','追'].map(style=>{const horses=c.samples.filter(r=>r.context===context).flatMap(r=>r.horses).filter(h=>h.straightStyle===style);return {style,starts:horses.length,wins:horses.filter(h=>h.place===1).length};});
  const marginCategories=['<1','1–3','>3','unknown'].map(category=>({category,...Object.fromEntries(['real','baseline','current'].map(arm=>[arm,paired.filter(r=>r.margin[arm].category===category).length]))}));
  return {cases:paired.length,simulationsPerArm:paired.length*3,paired,aggregate,absoluteRelativeErrorPercent:errors,currentStraightPositions:positions,marginCategories,
    marginProtocol:'Official nose/head/neck remain categorical, with no invented numerical length. Simulated nominal length is progress-coordinate gap at winner crossing divided by 2.4m, median over 3 runs. Official margins and this proxy have different measurement/rounding conventions. Counts are event-weighted; unknown is retained.',
    perDistance:[1200,1600,2000,2400,3000,3200].map(length=>({length,metrics:Object.fromEntries(metrics.map(k=>[k,Object.fromEntries(['real','baseline','current'].map(arm=>[arm,D(paired.filter(r=>r.length===length).map(r=>r[arm][k]))]))]))}))};
}
function engineering(r){return {...r.integrity,withinFiniteBraking:r.integrity.minAcceleration>=-3.5-1e-7,
  passed:r.integrity.complete&&r.integrity.allFinish&&r.integrity.allFinite&&r.integrity.sourceUnchanged&&r.integrity.bodyOverlapRaces===0&&r.integrity.minAcceleration>=-3.5-1e-7&&r.integrity.maxWorkError<1e-6&&r.integrity.maxReserveError<1e-6&&r.integrity.maxUnpaid<1e-6&&r.integrity.infeasibleSteps===0&&r.integrity.minFollowingSlack>=-1e-6&&r.integrity.maxMotionError<1e-6};}
function auditedTelemetryEngineering(r,a,source){
  if(a.rawEngineHash!==r.engineHash||a.currentEngineHash!==source.currentEngineHash||!source.diagnosticPredicateOnly||!source.telemetryQueryOrderPreserved||!source.physicsAndSolverSourceExact||!a.sourceUnchanged||!a.allHorseFramesExact||!a.allOutcomesExact||!a.onlyTelemetryChanged||!a.telemetryQueryOrderPreserved||!a.followingSlackQuerySequenceExact||!a.persistentNegativeWitnessWritesExact)throw new Error('Telemetry audit source/equivalence mismatch');
  const keys=['context','length','n','course','dir','seed','raceSeed'];
  const rows=r.samples.filter(x=>keys.every(k=>x[k]===a.job[k]));
  if(rows.length!==1)throw new Error('Telemetry audit must identify exactly one original row');
  const row=rows[0],negative=r.samples.filter(x=>x.traffic.minFollowingSlack < -1e-6);
  if(negative.length!==1||negative[0]!==row||row.frames!==a.frameCount||row.traffic.minFollowingSlack!==a.rawMinimumFollowingSlack||row.traffic.minResponseSlack!==a.rawMinimumResponseSlack||r.integrity.minFollowingSlack!==a.rawMinimumFollowingSlack)throw new Error('Telemetry audit does not cover the raw failed row');
  if(a.results.length!==row.horses.length||row.horses.some(h=>{const x=a.results.find(x=>x.id===h.id);return !x||['place','time','final600'].some(k=>h[k]!==x[k])||h.sectionals.length!==x.sectionals.length||h.sectionals.some((s,i)=>['distance','time','split'].some(k=>s[k]!==x.sectionals[i][k]));}))throw new Error('Telemetry audit outcomes do not match the archived matrix');
  if(!a.diagnosis.allNegativeRecordsHaveNoStepOverlap||a.diagnosis.genuineSolverOverlappingNegativeRecords!==0||a.negativeRecords.length!==a.diagnosis.negativeRecords||a.negativeRecords.some(x=>x.endpointAxisOverlap!==null||x.stepAxisOverlap!==null)||!Number.isFinite(a.correctedMinimumFollowingSlack)||!Number.isFinite(a.correctedMinimumResponseSlack))throw new Error('Telemetry boundary diagnosis is incomplete');
  // The constant axisOverlap predicate is a subset of the old bare < predicate.
  // All other original rows therefore retain conservative positive lower bounds;
  // this is an audited bound, not a relabeled 270-race production execution.
  const remainingMinimum=Math.min(...r.samples.filter(x=>x!==row).map(x=>x.traffic.minFollowingSlack));
  const lowerBound=Math.min(remainingMinimum,a.correctedMinimumFollowingSlack);
  return {...engineering({integrity:{...r.integrity,minFollowingSlack:lowerBound}}),
    rawMinimumFollowingSlack:r.integrity.minFollowingSlack,remainingOriginalRows:r.samples.length-1,
    remainingOriginalMinimum:remainingMinimum,replayedFrames:a.frameCount,replayedJob:a.job,
    correctedCaseMinimum:a.correctedMinimumFollowingSlack,rawEngineHash:r.engineHash,
    currentEngineHash:source.currentEngineHash,audit:'traffic-slack-boundary-v9.json',
    scope:'Original 270-race physical/ledger checks plus a full-state exact replay of the unique failed telemetry case. Other 269 original minima conservatively bound the narrower diagnostic predicate. Raw matrix and failed engineering result are preserved; this is not a 270-race rerun on the production hash.'};
}
function legacyFit(joined,arm='current'){
  const limits={winnerTime:5,winnerFinal600:10,first600:10};
  const cases=joined.paired.map(r=>{const errors=Object.fromEntries(Object.keys(limits).map(k=>[k,Math.abs(r[arm][k]/r.real[k]-1)*100]));
    return {id:r.id,length:r.length,errorsPercent:errors,passed:Object.entries(limits).every(([k,max])=>Number.isFinite(errors[k])&&errors[k]<=max)};});
  return {limitsPercent:limits,caseCount:cases.length,passed:cases.every(r=>r.passed),cases,
    scope:'Existing broad time checks only; passing them would not establish fit of the seven pace/field residuals.'};
}
if(require.main===module){
  const b=read('system-baseline-v2026.10.02.3.json'),c=read('system-current-v2026.10.02.3.json'),b22=read('system-baseline-external2022-v2026.10.02.3.json'),c22=read('system-current-external2022-v2026.10.02.3.json');
  const sourceVerification=verifySource(),sourceHash=sourceVerification.numericEngineHash;
  if(c.engineHash!==sourceHash||c22.engineHash!==sourceHash)throw new Error('Numeric snapshot mismatch');
  const report={version:'v2026.10.02.3',engineHash:sourceHash,sourceVerification,baselineCommit:b.protocol.baselineCommit,
    protocol:'Identical frozen-v8 fields and separate generation/race RNG streams in each paired arm. 3 trials per official reference, median per race then aggregate; synthetic G1 level86, not reconstruction. Entire production model changed in one arm: paired difference is the package effect, not sole traffic causation.',
    engineering:{baseline:b.integrity,current:engineering(c),external2022:engineering(c22)},
    correctedTelemetryEngineering:auditedTelemetryEngineering(c,read('traffic-slack-boundary-v9.json'),sourceVerification),
    alreadyViewed2023to2025:join(read('current-engine-reality-sources-2026-10-02.json'),b,c,'external'),
    newlyFrozen2022:join(read('system-external-reference-2022.json'),b22,c22,'external2022'),
    population:c.summaries.filter(r=>r.context!=='external'),
    boundaries:['No distance/style compensation multipliers were fitted. Physiology axes and geometry remain literature/source constrained proxies.',
      'Seven pace/field metrics are diagnostic residuals, not all solved by consistency repairs. Field composition, rider strategy and horse behavior are not identified from finish time alone.',
      '2022 has 6 real events, not 18 independent real races; Hanshin 3200 outer-to-inner remains a route proxy.',
      'Official 0.1-second quantization retained in leader CV. Other simulation times unrounded; precision sensitivity is not evidence of biological fit.']};
  report.legacyReferenceFit={baseline:legacyFit(report.alreadyViewed2023to2025,'baseline'),current:legacyFit(report.alreadyViewed2023to2025),external2022:legacyFit(report.newlyFrozen2022)};
  report.acceptance={engineeringPassed:report.engineering.current.passed&&report.engineering.external2022.passed,
    correctedTelemetryEngineeringPassed:report.correctedTelemetryEngineering.passed&&report.engineering.external2022.passed,
    legacyPrimaryTimeFitPassed:report.legacyReferenceFit.current.passed,
    external2022TimeFitPassed:report.legacyReferenceFit.external2022.passed,
    sevenResidualsFullyFitted:false};
  report.acceptance.passed=report.acceptance.engineeringPassed&&report.acceptance.legacyPrimaryTimeFitPassed&&report.acceptance.external2022TimeFitPassed;
  fs.writeFileSync(path.join(ROOT,'docs/system-reality-comparison-v2026.10.02.3.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({engineering:report.engineering,acceptance:report.acceptance,seen:report.alreadyViewed2023to2025.aggregate,external2022:report.newlyFrozen2022.aggregate},null,2));
  if(!report.acceptance.passed)process.exitCode=1;
}
module.exports={realMetrics,join,engineering,auditedTelemetryEngineering,legacyFit,nominalMarginCategory};
