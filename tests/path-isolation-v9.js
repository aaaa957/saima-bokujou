#!/usr/bin/env node
'use strict';
// Controlled execution counterfactual: original solo speed commands, one
// common reference lane, no traffic/drafting and no rider replanning.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const zlib=require('node:zlib');
const {api,fieldFor,distribution,HASH}=require('./system-reality-v9');
const {replaySolo,aggregate}=require('./tempo-system-v9');
const {S:B,engineHash:baselineHash}=require('./helpers/frozen-v8');
const {NUMERIC_HASH}=require('./helpers/v9-numeric-snapshot');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),allowPartial=args.includes('--allow-partial');
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const input=path.resolve(ROOT,option('--in','docs/tempo-system-v9.json'));
const output=path.resolve(ROOT,option('--out',allowPartial?path.join(os.tmpdir(),'saima-path-isolation-partial-v9.json'):'docs/path-isolation-v9.json'));
const sourcePath=path.resolve(ROOT,option('--source-archive','sim.js'));
const readSource=()=>{const b=fs.readFileSync(sourcePath);return(b[0]===0x1f&&b[1]===0x8b?zlib.gunzipSync(b):b).toString('utf8');};
const source=readSource(),sourceArtifact={path:sourcePath,kind:args.includes('--source-archive')?'explicit-artifact':'workspace',contentHash:HASH(source)};
if(args.includes('--check-source')){console.log(JSON.stringify({sourceArtifact,engineHash:HASH(source)}));process.exit(0);}
if(allowPartial){
  const relative=path.relative(path.resolve(os.tmpdir()),output);
  assert(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),
    'Partial development output must stay inside TEMP');
}
const raw=fs.readFileSync(input,'utf8'),tempo=JSON.parse(raw);
const engineHash=HASH(source),S=api(source),clone=value=>JSON.parse(JSON.stringify(value));
assert.equal(engineHash,NUMERIC_HASH,'Path diagnostic requires the registered frozen v9 numerical source');
assert.equal(tempo.engineHash,engineHash,'Tempo and execution engine must match');
assert.equal(tempo.baselineHash,baselineHash(),'Reconstructed fields must use tempo generation source');
assert(tempo.samples?.length>0,'Tempo has no completed rows');
if(!allowPartial){
  assert(tempo.integrity?.complete&&tempo.samples.length===12,'Wait for all 12 tempo rows before formal path isolation');
  assert(tempo.integrity.sourceUnchanged&&tempo.integrity.referenceUnchanged&&tempo.integrity.allFinite,'Tempo integrity must pass');
  assert.equal(tempo.errors?.length,0,'Tempo has failed jobs');
}
const keys=['winnerTime','tailSeconds','within1','within2','final600Span','first200','post200Cv','last200Difference'];
const startedAt=new Date().toISOString(),start=Date.now(),rows=[];
let maxWorkError=0,maxReserveError=0,maxUnpaid=0;
for(const row of tempo.samples.slice().sort((a,b)=>a.job.length-b.job.length||a.job.replicate-b.job.replicate)){
  const {job}=row;
  assert.equal(job.n,16);assert.equal(row.crowd.horses.length,job.n);assert.equal(row.solo.horses.length,job.n);
  const crowd={field:fieldFor(job,B,S),initial:clone(row.crowd.initial),horses:clone(row.crowd.horses)};
  const repeated=replaySolo(job,crowd,0,S),original=row.solo.horses[0];
  // One complete reproduction per job detects a field/profile or start-state
  // reconstruction mismatch before deriving any execution counterfactual.
  for(const key of ['time','final600','sectionals','physiology','physiologicalParameters','reserveFraction','retention','frames','extendedSeconds'])
    assert.deepEqual(repeated[key],original[key],'Original solo reconstruction differs: '+job.length+' / '+job.replicate+' / '+key);
  const geometry=S.trackGeometry(job.length,job.course,'草地'),referenceLane=geometry.referenceLane;
  const innerCrowd={field:crowd.field,initial:crowd.initial.map(h=>({...h,t:referenceLane,targetT:referenceLane})),
    horses:crowd.horses.map(h=>({...h,commands:h.commands.map(command=>[command[0],command[1],referenceLane,command[3]])}))};
  const sameInnerLine=innerCrowd.horses.map((_,i)=>replaySolo(job,innerCrowd,i,S));
  const innerMetrics=aggregate(sameInnerLine),originalMetrics=aggregate(row.solo.horses),differences={};
  for(const key of keys){assert.equal(originalMetrics[key],row.solo.metrics[key],'Stored solo metric reconstruction differs');
    differences[key]=originalMetrics[key]-innerMetrics[key];}
  const horses=sameInnerLine.map((h,i)=>{
    const before=row.solo.horses[i];
    assert.deepEqual(h.physiology,before.physiology,'Physiology changed');
    assert.deepEqual(h.physiologicalParameters,before.physiologicalParameters,'Physiological parameters changed');
    assert.equal(h.gate,before.gate,'Gate identity changed');
    assert(h.blockedSeconds===0&&h.draftSeconds===0,'Solo replay unexpectedly contains traffic or drafting');
    for(const key of ['time','final600','reserveFraction','retention','peakSpeed'])assert(Number.isFinite(h[key]),'Nonfinite replay result');
    maxWorkError=Math.max(maxWorkError,h.workBalanceError);maxReserveError=Math.max(maxReserveError,h.reserveBalanceError);maxUnpaid=Math.max(maxUnpaid,h.unpaidWork);
    return {id:h.id,gate:h.gate,initialLane:row.crowd.initial[i].t,referenceLane,startDelay:row.crowd.initial[i].startDelay,
      originalSolo:before,sameInnerLine:h,originalMinusInnerTime:before.time-h.time,
      originalMinusInnerFinal600:before.final600-h.final600,
      originalMinusInnerFirst200:before.first200-h.first200};
  });
  rows.push({job,referenceLane,reproduction:{id:repeated.id,allExact:true},
    originalSolo:{metrics:originalMetrics},sameInnerLine:{metrics:innerMetrics},differences,horses});
  console.log(JSON.stringify({measured:rows.length,total:tempo.samples.length,length:job.length,replicate:job.replicate,
    differences,elapsedSeconds:(Date.now()-start)/1000}));
}
const summary={raceCount:rows.length,arms:{},paired:{}};
for(const arm of ['originalSolo','sameInnerLine']){
  summary.arms[arm]={};for(const key of keys)summary.arms[arm][key]=distribution(rows.map(r=>r[arm].metrics[key]));
}
for(const key of keys)summary.paired[key]=distribution(rows.map(r=>r.differences[key]));
summary.individualTimeDifference=distribution(rows.flatMap(r=>r.horses).map(h=>h.originalMinusInnerTime));
summary.individualFinal600Difference=distribution(rows.flatMap(r=>r.horses).map(h=>h.originalMinusInnerFinal600));
summary.individualFirst200Difference=distribution(rows.flatMap(r=>r.horses).map(h=>h.originalMinusInnerFirst200));
const sourceUnchanged=HASH(readSource())===engineHash;
const inputUnchanged=HASH(fs.readFileSync(input,'utf8'))===HASH(raw);
const integrity={complete:!allowPartial&&rows.length===12&&tempo.integrity.complete,
  counts:{raceGroups:rows.length,innerSoloHorses:rows.reduce((sum,r)=>sum+r.horses.length,0),originalReproductions:rows.length},
  sourceUnchanged,inputUnchanged,allReproductionsExact:rows.every(r=>r.reproduction.allExact),allFinite:true,
  maxWorkError,maxReserveError,maxUnpaid};
const report={engineHash,sourceArtifact,baselineHash:baselineHash(),tempoInputHash:HASH(raw),startedAt,elapsedSeconds:(Date.now()-start)/1000,
  protocol:{mode:allowPartial?'development-partial':'formal',dt:1/60,
    sourceArtifact,
    expected:{raceGroups:12,innerSoloHorses:192,originalReproductions:12},
    generatedField:'Published v8 fieldFor with the identical stored job; one full original solo reproduction per row verifies every sectional and physiology before the intervention.',
    intervention:'Initial lateral position and target plus every commanded lateral target are fixed to geo.referenceLane. Original per-wall-frame targetV, gate, reaction delay, aiBias, physiology, course, surface and load remain unchanged.',
    interpretation:'Removal of different lateral paths and steering from independent original-command solo executions. Includes route-dependent curvature/slope timing and fatigue feedback. It is not a replanning solo, a simultaneous common-line race, or a horse-for-horse reconstruction of reality.',
    extension:'Holds final original speed command beyond that horse\'s original finish frame when needed; extendedSeconds is recorded.',
    metrics:'Earliest individual marker crossings define synthetic leader splits; the leading individual may change. Differences mean originalSolo minus sameInnerLine. These intervention groups are not independent real races.'},
  integrity,summary,byDistance:[...new Set(rows.map(r=>r.job.length))].map(length=>({length,
    raceCount:rows.filter(r=>r.job.length===length).length,
    paired:Object.fromEntries(keys.map(key=>[key,distribution(rows.filter(r=>r.job.length===length).map(r=>r.differences[key]))]))})),rows};
assert(sourceUnchanged,'Source changed during replay');assert(maxWorkError<1e-6&&maxReserveError<1e-6&&maxUnpaid<1e-6,'Work ledger failed');
if(!allowPartial)assert(inputUnchanged&&integrity.complete,'Formal tempo input changed or was incomplete');
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,engineHash,integrity,summary},null,2));
