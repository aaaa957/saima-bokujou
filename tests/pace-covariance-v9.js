#!/usr/bin/env node
'use strict';
// Read-only analysis of existing per-horse times. No races are rerun.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const zlib=require('node:zlib');
const {distribution:D,q,HASH}=require('./system-reality-v9');
const {readArchived,engineHash:baselineHash}=require('./helpers/frozen-v8');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),partial=args.includes('--allow-partial');
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const output=path.resolve(ROOT,option('--out',partial?path.join(os.tmpdir(),'saima-pace-covariance-partial-v9.json'):'docs/pace-covariance-v9.json'));
const sourcePath=path.resolve(ROOT,option('--source-archive','sim.js'));
const readSource=()=>{const b=fs.readFileSync(sourcePath);return(b[0]===0x1f&&b[1]===0x8b?zlib.gunzipSync(b):b).toString('utf8');};
const METRICS=['rhoPrefixFinal600','rhoFinishFinal600','rhoPrefixFinish','varPrefix','varFinal600','varFinish',
  'covPrefixFinal600','cancelIndex','remainingVarianceRatio','prefixRange','final600Range','finishRange','varianceIdentityError'];
const precisionArms=['native','quantized01'];
function stats(horses,timeKey='time',quantized=false){
  const finiteFinish=horses.filter(h=>Number.isFinite(h[timeKey]));
  const paired=finiteFinish.filter(h=>Number.isFinite(h.final600));
  const round=x=>quantized?Math.round(x*10)/10:x;
  const T=paired.map(h=>round(h[timeKey])),B=paired.map(h=>round(h.final600)),A=T.map((t,i)=>t-B[i]),n=T.length;
  const mean=a=>a.length?a.reduce((sum,x)=>sum+x,0)/a.length:null;
  const variance=a=>a.length?a.reduce((sum,x)=>sum+(x-mean(a))**2,0)/a.length:null;
  const covariance=(a,b)=>a.length?a.reduce((sum,x,i)=>sum+(x-mean(a))*(b[i]-mean(b)),0)/a.length:null;
  const varA=variance(A),varB=variance(B),varT=variance(T),covAB=covariance(A,B);
  const corr=(a,b)=>{const va=variance(a),vb=variance(b);return n>=3&&va>0&&vb>0?covariance(a,b)/Math.sqrt(va*vb):null;};
  const sum=varA+varB,range=a=>a.length?Math.max(...a)-Math.min(...a):null;
  return {nRecords:horses.length,nFiniteFinish:finiteFinish.length,nPaired:n,missingFinal600:finiteFinish.length-n,
    rhoPrefixFinal600:corr(A,B),rhoFinishFinal600:corr(T,B),rhoPrefixFinish:corr(A,T),
    varPrefix:varA,varFinal600:varB,varFinish:varT,covPrefixFinal600:covAB,
    cancelIndex:n>=3&&sum>0?-2*covAB/sum:null,remainingVarianceRatio:n>=3&&sum>0?varT/sum:null,
    prefixRange:range(A),final600Range:range(B),finishRange:range(T),
    allFinisherRange:range(finiteFinish.map(h=>round(h[timeKey]))),
    varianceIdentityError:n?Math.abs(varT-(varA+varB+2*covAB)):null,
    pairedIds:paired.map((h,i)=>h.id??h.horseNumber??i)};
}
const measurements=(horses,timeKey='time')=>Object.fromEntries(precisionArms.map(p=>[p,stats(horses,timeKey,p==='quantized01')]));
const precisionDifference=m=>Object.fromEntries(METRICS.map(k=>[k,
  Number.isFinite(m.native[k])&&Number.isFinite(m.quantized01[k])?m.native[k]-m.quantized01[k]:null]));
const precisionSummary=(rows,pick)=>Object.fromEntries(METRICS.map(k=>[k,D(rows.map(r=>pick(r)[k]))]));
function summaries(rows,pick){return Object.fromEntries(precisionArms.map(p=>[p,Object.fromEntries(METRICS.map(k=>[k,D(rows.map(r=>pick(r)[p][k]))]))]));}
function pairedSummary(rows,before,after){return Object.fromEntries(precisionArms.map(p=>[p,Object.fromEntries(METRICS.map(k=>[k,D(rows.map(r=>{
  const a=before(r)[p][k],b=after(r)[p][k];return Number.isFinite(a)&&Number.isFinite(b)?a-b:null;
}))]))]));}
function analyze(){
  const source=readSource(),engineHash=HASH(source),sourceArtifact={path:sourcePath,kind:args.includes('--source-archive')?'explicit-artifact':'workspace',contentHash:engineHash};
  if(args.includes('--check-source')){console.log(JSON.stringify({sourceArtifact,engineHash}));return;}
  if(partial){
    const relative=path.relative(path.resolve(os.tmpdir()),output);
    assert(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),
      'Partial development output must stay inside TEMP');
  }
  const inputs={},availability={},docs=path.join(ROOT,'docs');
  function load(key,name){
    try{const raw=readArchived(path.join(docs,name)).toString('utf8'),value=JSON.parse(raw);
      inputs[key]={name,hash:HASH(raw)};availability[key]={present:true,complete:value.integrity?.complete??null,
        engineHash:value.engineHash??null};return value;
    }catch(error){if(!partial)throw error;availability[key]={present:false,error:error.message};return null;}
  }
  const realSeen=load('realSeen','current-engine-reality-sources-2026-10-02.json');
  const real2022=load('real2022','system-external-reference-2022.json');
  const baseline=load('baseline','system-baseline-v2026.10.02.3.json');
  const baseline2022=load('baseline2022','system-baseline-external2022-v2026.10.02.3.json');
  const current=load('current','system-current-v2026.10.02.3.json');
  const current2022=load('current2022','system-current-external2022-v2026.10.02.3.json');
  const tempo=load('tempo','tempo-system-v9.json');
  const pathReport=load('path','path-isolation-v9.json');
  assert(realSeen&&real2022,'Official reference files are required even for a partial probe');
  for(const r of [current,current2022,tempo,pathReport].filter(Boolean))assert.equal(r.engineHash,engineHash,'Current-engine data source mismatch');
  for(const r of [baseline,baseline2022].filter(Boolean))assert.equal(r.engineHash,baselineHash(),'Published-baseline source mismatch');
  if(!partial){
    for(const r of [baseline,baseline2022,current,current2022])assert(r.integrity.complete&&r.integrity.sourceUnchanged&&r.integrity.allFinite&&r.integrity.allFinish,'Simulation report incomplete or invalid');
    assert(tempo.integrity.complete&&tempo.integrity.sourceUnchanged&&tempo.integrity.referenceUnchanged&&tempo.integrity.allFinite,'Tempo report incomplete or invalid');
    assert(pathReport.integrity.complete&&pathReport.integrity.sourceUnchanged&&pathReport.integrity.inputUnchanged&&pathReport.integrity.allReproductionsExact,'Path report incomplete or invalid');
    assert.equal(pathReport.tempoInputHash,inputs.tempo.hash,'Path report must use this completed tempo report');
  }
  const cases=[...realSeen.races.map(r=>({...r,context:'external',referenceSet:'2023–2025'})),
    ...real2022.races.map(r=>({...r,context:'external2022',referenceSet:'2022'}))];
  assert.equal(cases.length,24);assert.equal(new Set(cases.map(r=>String(r.id))).size,24);
  const realRows=cases.map(r=>{const m=measurements(r.horses,'finishTime');return {id:r.id,length:r.length,referenceSet:r.referenceSet,nStarted:r.fieldSize,
    source:r.source?.url,measurements:m,precisionSensitivity:precisionDifference(m)};});
  function simulated(arm){
    const documents=arm==='baseline'?[baseline,baseline2022]:[current,current2022];
    const samples=documents.filter(Boolean).flatMap(r=>r.samples||[]);
    const rows=cases.map(r=>{
      const runs=samples.filter(s=>s.context===r.context&&String(s.id)===String(r.id));
      if(!partial)assert.equal(runs.length,3,'Expected exactly 3 simulations for '+arm+' '+r.id);
      assert.equal(new Set(runs.map(s=>s.seed+'|'+s.raceSeed)).size,runs.length,'Duplicate simulation seed within one official case');
      const runRows=runs.map(s=>{const m=measurements(s.horses);return {seed:s.seed,raceSeed:s.raceSeed,nStarted:s.n,
        measurements:m,precisionSensitivity:precisionDifference(m)};});
      const medians=Object.fromEntries(precisionArms.map(p=>[p,Object.fromEntries(METRICS.map(k=>[k,q(runRows.map(s=>s.measurements[p][k]))]))]));
      const precisionSensitivityMedian=Object.fromEntries(METRICS.map(k=>[k,q(runRows.map(s=>s.precisionSensitivity[k]))]));
      const validRuns=Object.fromEntries(precisionArms.map(p=>[p,Object.fromEntries(METRICS.map(k=>[k,runRows.filter(s=>Number.isFinite(s.measurements[p][k])).length]))]));
      return {id:r.id,length:r.length,referenceSet:r.referenceSet,simulationCount:runs.length,complete:runs.length===3,
        runRows,medians,validRuns,precisionSensitivityMedian};
    }).filter(r=>r.simulationCount);
    return {caseCount:rows.length,completeCaseCount:rows.filter(r=>r.complete).length,
      simulationCount:rows.reduce((sum,r)=>sum+r.simulationCount,0),rows,
      aggregateAcrossEventMedians:summaries(rows,r=>r.medians),
      precisionSensitivityAcrossEventMedians:precisionSummary(rows,r=>r.precisionSensitivityMedian),
      byReferenceSet:['2023–2025','2022'].map(referenceSet=>{const group=rows.filter(r=>r.referenceSet===referenceSet);return {
        referenceSet,caseCount:group.length,aggregateAcrossEventMedians:summaries(group,r=>r.medians)};})};
  }
  const simulation={baseline:simulated('baseline'),current:simulated('current')};
  const matched=realRows.map(real=>({id:real.id,length:real.length,real,
    baseline:simulation.baseline.rows.find(r=>String(r.id)===String(real.id)),
    current:simulation.current.rows.find(r=>String(r.id)===String(real.id))})).filter(r=>r.baseline?.complete&&r.current?.complete);
  const matchedComparison={caseCount:matched.length,ids:matched.map(r=>r.id),
    arms:{real:summaries(matched,r=>r.real.measurements),baseline:summaries(matched,r=>r.baseline.medians),current:summaries(matched,r=>r.current.medians)},
    byDistance:[1200,1600,2000,2400,3000,3200].map(length=>{const group=matched.filter(r=>r.length===length);return {length,eventCount:group.length,
      arms:{real:summaries(group,r=>r.real.measurements),baseline:summaries(group,r=>r.baseline.medians),current:summaries(group,r=>r.current.medians)}};}),
    baselineMinusCurrent:pairedSummary(matched,r=>r.baseline.medians,r=>r.current.medians)};
  const tempoRows=(tempo?.samples||[]).map(r=>({job:r.job,arms:Object.fromEntries(['crowd','solo','neutral'].map(arm=>[arm,measurements(r[arm].horses)]))}));
  const jobKey=r=>r.job.length+'|'+r.job.seed+'|'+r.job.replicate;
  assert.equal(new Set(tempoRows.map(jobKey)).size,tempoRows.length,'Duplicate tempo job');
  if(!partial){assert.equal(tempoRows.length,12);for(const r of tempoRows)for(const arm of ['crowd','solo','neutral'])assert.equal(r.arms[arm].native.nPaired,16);}
  const tempoAnalysis={raceGroupCount:tempoRows.length,rows:tempoRows,
    arms:Object.fromEntries(['crowd','solo','neutral'].map(arm=>[arm,summaries(tempoRows,r=>r.arms[arm])])),
    precisionSensitivityByArm:Object.fromEntries(['crowd','solo','neutral'].map(arm=>[arm,precisionSummary(tempoRows,r=>precisionDifference(r.arms[arm]))])),
    crowdMinusSolo:pairedSummary(tempoRows,r=>r.arms.crowd,r=>r.arms.solo),
    crowdMinusNeutral:pairedSummary(tempoRows,r=>r.arms.crowd,r=>r.arms.neutral)};
  const pathRows=(pathReport?.rows||[]).map(r=>({job:r.job,arms:Object.fromEntries(['originalSolo','sameInnerLine'].map(arm=>[arm,measurements(r.horses.map(h=>h[arm]))]))}));
  assert.equal(new Set(pathRows.map(jobKey)).size,pathRows.length,'Duplicate path job');
  if(!partial){assert.equal(pathRows.length,12);for(const r of pathRows)for(const arm of ['originalSolo','sameInnerLine'])assert.equal(r.arms[arm].native.nPaired,16);}
  const pathAnalysis={raceGroupCount:pathRows.length,rows:pathRows,
    arms:Object.fromEntries(['originalSolo','sameInnerLine'].map(arm=>[arm,summaries(pathRows,r=>r.arms[arm])])),
    precisionSensitivityByArm:Object.fromEntries(['originalSolo','sameInnerLine'].map(arm=>[arm,precisionSummary(pathRows,r=>precisionDifference(r.arms[arm]))])),
    originalMinusInner:pairedSummary(pathRows,r=>r.arms.originalSolo,r=>r.arms.sameInnerLine)};
  const all=[...realRows.map(r=>r.measurements),...Object.values(simulation).flatMap(a=>a.rows.flatMap(r=>r.runRows.map(s=>s.measurements))),
    ...tempoRows.flatMap(r=>Object.values(r.arms)),...pathRows.flatMap(r=>Object.values(r.arms))];
  const maxVarianceIdentityError=Math.max(0,...all.flatMap(a=>precisionArms.map(p=>a[p].varianceIdentityError)).filter(Number.isFinite));
  const sourceUnchanged=HASH(readSource())===engineHash;
  const inputsUnchanged=Object.entries(inputs).every(([key,v])=>{
    const raw=readArchived(path.join(docs,v.name)).toString('utf8');return HASH(raw)===v.hash;
  });
  assert(sourceUnchanged,'Source changed during read-only analysis');assert(maxVarianceIdentityError<1e-8,'Variance decomposition failed');
  if(!partial)assert(inputsUnchanged&&matched.length===24,'Formal inputs changed or some paired official cases are missing');
  const report={engineHash,sourceArtifact,baselineHash:baselineHash(),mode:partial?'development-partial':'formal',inputs,availability,
    protocol:{sourceArtifact,analysis:'T=finish time; B=individual final600; A=T−B. Population variances and covariance within the same paired finishers, denominator n.',
      correlation:'Pearson rho only for n>=3 and both variances positive; undefined values remain null and each summary reports its finite count.',
      cancellation:'cancelIndex=−2Cov(A,B)/(Var(A)+Var(B)); positive indicates empirical covariance cancellation, negative indicates amplification. remainingVarianceRatio=Var(T)/(Var(A)+Var(B))=1−cancelIndex. This is an arithmetic description, not causal strategy attribution.',
      precision:'native preserves stored simulation precision and official rounded times. quantized01 independently rounds both T and B to 0.1s, then derives A=T−B; A is not separately rounded.',
      aggregation:'Each simulated official case has 3 within-race measurements, median per metric per event, then equally weighted event summaries. No pooling of horses across races as independent samples.',
      partial:'Unmatched available-case summaries cannot be compared directly. matchedComparison requires 3 simulations in both arms and restricts all three arms to identical real-event ids.',
      range:'finishRange uses paired T/B finishers; allFinisherRange additionally preserves all finite-T finishers. Var/rho may exclude finishers missing B. Winner is included.',
      causality:'A includes starting reaction, early route, effort, traffic and drafting. A=T−B also shares timing/rounding error with B. Negative covariance does not by itself prove deliberate tactical waiting or fatigue. The variance identity verifies arithmetic, not physics. Solo/inner interventions retain original wall-clock commands and allow route-dependent execution feedback; neutral AI replans. The same three generation/race seeds are reused across years at each distance, not a newly independent simulated population per reference event.'},
    integrity:{complete:!partial,sourceUnchanged,inputsUnchanged,maxVarianceIdentityError,
      realEventCount:realRows.length,realStarts:realRows.reduce((sum,r)=>sum+r.nStarted,0),
      realFiniteFinishers:realRows.reduce((sum,r)=>sum+r.measurements.native.nFiniteFinish,0),
      realPairedHorses:realRows.reduce((sum,r)=>sum+r.measurements.native.nPaired,0),matchedOfficialCases:matched.length},
    real:{eventCount:realRows.length,rows:realRows,aggregateAcrossEvents:summaries(realRows,r=>r.measurements),
      precisionSensitivity:precisionSummary(realRows,r=>r.precisionSensitivity),
      byReferenceSet:['2023–2025','2022'].map(referenceSet=>{const group=realRows.filter(r=>r.referenceSet===referenceSet);return {
        referenceSet,eventCount:group.length,aggregateAcrossEvents:summaries(group,r=>r.measurements)};})},
    simulation,matchedComparison,tempo:tempoAnalysis,path:pathAnalysis};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,integrity:report.integrity,real:report.real.aggregateAcrossEvents,
    matchedOfficialCases:matched.length,tempoGroups:tempoRows.length,pathGroups:pathRows.length},null,2));
  return report;
}
if(require.main===module)analyze();
module.exports={stats,measurements,summaries,pairedSummary,analyze};
