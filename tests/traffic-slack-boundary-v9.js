#!/usr/bin/env node
'use strict';
// Reproduce one frozen field. This changes no solver, source archive or matrix.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {fieldFor,HASH,DT}=require('./system-reality-v9');
const frozen=require('./helpers/frozen-v8');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2);
const option=(key,fallback)=>{const i=args.indexOf(key);if(i<0)return fallback;assert(args[i+1]&&!args[i+1].startsWith('--'),key+' requires a path');return args[i+1];};
const archivePath=path.resolve(ROOT,option('--source-archive','docs/system-numeric-source-3b837b-v9.js.gz'));
const currentPath=path.resolve(ROOT,option('--current-source','sim.js'));
const referencePath=path.resolve(ROOT,option('--reference-source','docs/system-heading-source-ac9dc7-v9.js.gz'));
const output=path.resolve(ROOT,option('--out','docs/traffic-slack-boundary-v9.json'));
const read=file=>{const b=fs.readFileSync(file);return(b[0]===0x1f&&b[1]===0x8b?zlib.gunzipSync(b):b).toString('utf8');};
const normalize=s=>s.replace(/\r\n/g,'\n');
const raw=read(archivePath),current=read(currentPath),reference=read(referencePath);
const rawEngineHash=HASH(raw),currentEngineHash=HASH(current),referenceEngineHash=HASH(reference);
assert.equal(rawEngineHash,'3b837b46bf03ed86a19fdbe0ff83a03bb4fd2211ff9a4692b2f1a78e12f221ff');
assert.equal(referenceEngineHash,'ac9dc7f3f8d9a6bf001ad6aef979021b3e7d59a9c5d5cdf36dd7884182f99d84');
const oldDiagnostic='if(Math.abs(rm.t-fm.t)<clear.lateral&&old.get(rear).s<old.get(front).s) {';
const oldTelemetry=[
  '          race.traffic.minFollowingSlack=race.traffic.minFollowingSlack==null?slack:Math.min(race.traffic.minFollowingSlack,slack);',
  '          race.traffic.minResponseSlack=race.traffic.minResponseSlack==null?response:Math.min(race.traffic.minResponseSlack,response);',
].join('\n');
const newTelemetry=[
  '          if(axisOverlap(fm.t-rm.t,fm.t-rm.t,clear.lateral)) {',
  '            race.traffic.minFollowingSlack=race.traffic.minFollowingSlack==null?slack:Math.min(race.traffic.minFollowingSlack,slack);',
  '            race.traffic.minResponseSlack=race.traffic.minResponseSlack==null?response:Math.min(race.traffic.minResponseSlack,response);',
  '          }',
].join('\n');
assert.equal(current.split(oldDiagnostic).length,2,'Original outer query condition must remain unchanged');
assert.equal(normalize(current).split(newTelemetry).length,2,'Expected exactly one telemetry assignment gate');
let reversed=normalize(current).replace(newTelemetry,oldTelemetry);
assert.equal(HASH(reversed),'96d84a28b585a61e48a05cc3e6dd52d6796245a82b19d99abeeba9b9e1efafdb','Unexpected edits beyond the telemetry predicate');
const begin=reversed.indexOf('  function raceOptionsForRoster(h, rng, roster, weekNum) {\n');
const end=reversed.indexOf('  /* ---------------- 下注玩法',begin);
assert(begin>=0&&end>begin);
let region=reversed.slice(begin,end);
for(const line of ['    horsePhysiology(h);\n','        physiology: { ...h.physiology },\n']){
  assert.equal(region.split(line).length,2);region=region.replace(line,'');
}
reversed=reversed.slice(0,begin)+region+reversed.slice(end);
assert.equal(reversed,normalize(raw),'Entire source must differ only by the two reviewed lifecycle lines and telemetry assignment gate');
function compile(source,privateGlobal={}){const m={exports:{}};new Function('module','exports','globalThis',source)(m,m.exports,privateGlobal);return m.exports;}
function axisSource(source){const s=normalize(source),a=s.indexOf('    function axisOverlap('),b=s.indexOf('\n    let trafficProgressCache=',a);assert(a>=0&&b>a);return s.slice(a,b).trim();}
assert.equal(axisSource(raw),axisSource(current),'Solver geometry and tolerances changed');
const axisOverlap=new Function('return ('+axisSource(raw)+');')();
const clearance=.855;
const boundaryCases=[[-2e-9,true],[-1e-9,false],[-.5e-9,false],[0,false],[.5e-9,false],[1e-9,false],[2e-9,false]].map(([offset,expected])=>{
  const separation=clearance+offset,rawDiagnostic=separation<clearance,corrected=!!axisOverlap(separation,separation,clearance);
  assert.equal(corrected,expected);return {clearance,offset,separation,rawDiagnostic,solverAndCorrectedDiagnostic:corrected,expected};
});
const capturedSeparation=.8549999999999418;
assert.equal(axisOverlap(capturedSeparation,capturedSeparation,clearance),null);
boundaryCases.push({clearance,separation:capturedSeparation,offset:capturedSeparation-clearance,rawDiagnostic:true,solverAndCorrectedDiagnostic:false,expected:false});
const job={context:'healthy-flat',length:1200,n:16,course:'标准',dir:'左回',seed:3198210664,raceSeed:546810833};
const marker='const slack=followingSlack(rear,front,rm,fm,false),response=followingSlack(rear,front,rm,fm);';
assert.equal(raw.split(marker).length,2);
const negatives=[],firstCaptures=[];let expectedCorrectedFollowing=null,expectedCorrectedResponse=null;
const audit={valid(slack,response){
  expectedCorrectedFollowing=expectedCorrectedFollowing==null?slack:Math.min(expectedCorrectedFollowing,slack);
  expectedCorrectedResponse=expectedCorrectedResponse==null?response:Math.min(expectedCorrectedResponse,response);
},negative(c){
  const compact={frameBeforeStep:c.frameBeforeStep,rearId:c.rear.id,frontId:c.front.id,slack:c.slack,response:c.response,lateralDifference:c.lateralDifference,lateralClearance:c.clear.lateral,endpointAxisOverlap:c.endpointAxisOverlap,stepAxisOverlap:c.stepAxisOverlap};
  negatives.push(compact);if(firstCaptures.length<3)firstCaptures.push(JSON.parse(JSON.stringify(c)));
}};
const instrumented=raw.replace(marker,marker+
  '\n          if(axisOverlap(fm.t-rm.t,fm.t-rm.t,clear.lateral)) globalThis.__audit.valid(slack,response);'+
  '\n          if(slack < -1e-6) globalThis.__audit.negative({frameBeforeStep:Math.round(race.t/(1/60)),raceTime:race.t,dt,slack,response,passes,length,rear:{id:rear.id,old:old.get(rear),motion:rm,targetT:rear.targetT,adj:rear.adj},front:{id:front.id,old:old.get(front),motion:fm,targetT:front.targetT,adj:front.adj},clear,lateralDifference:Math.abs(rm.t-fm.t),endpointAxisOverlap:axisOverlap(fm.t-rm.t,fm.t-rm.t,clear.lateral),stepAxisOverlap:axisOverlap(old.get(front).t-old.get(rear).t,fm.t-rm.t,clear.lateral),rearStoppingEnd:stoppingEnd(rm),frontStoppingEnd:stoppingEnd(fm),moves:act.map(h=>({id:h.id,old:old.get(h),motion:motion.get(h)}))});');
function queryTrace(){return {queries:[],witnesses:[],queryCount:0,witnessCount:0,
  query(value){this.queries.push(value);this.queryCount++;},
  witness(value){this.witnesses.push(value);this.witnessCount++;}};}
const beforeTrace=queryTrace(),afterTrace=queryTrace();
function instrumentQueries(source){
  const entry='      function followingSlack(H,F,move,frontMove,withResponse=true) {';
  const write='if(gap<closest)witnesses.set(F,time);';
  assert.equal(source.split(entry).length,2);assert.equal(source.split(write).length,2);
  return source.replace(entry,entry+'\n        globalThis.__trace.query([H.id,F.id,move.s,move.t,move.v,frontMove.s,frontMove.t,frontMove.v,withResponse]);')
    .replace(write,'if(gap<closest){globalThis.__trace.witness([H.id,F.id,time]);witnesses.set(F,time);}');
}
const A=compile(instrumentQueries(instrumented),{__audit:audit,__trace:beforeTrace});
const B=compile(instrumentQueries(current),{__trace:afterTrace});
const fieldA=fieldFor(job,frozen.S,A),fieldB=fieldFor(job,frozen.S,B);
assert.deepEqual(fieldA,fieldB);
const options=S=>({length:job.length,course:job.course,dir:job.dir,surface:'草地',state:'良',profile:'平坦',wind:0,rng:S.mulberry32(job.raceSeed)});
const ra=A.createRace(fieldA,options(A)),rb=B.createRace(fieldB,options(B));
// Preserve every enumerable data field and function source. References to
// another horse retain identity as IDs, avoiding blocker/passTarget cycles.
const functionSources=new WeakMap();
function snapshot(race){
  const horseObjects=new Set(race.horses);
  function encode(value){
    if(typeof value==='number'){assert(Number.isFinite(value),'Nonfinite state in equivalence audit');return value;}
    if(value===undefined)return {auditUndefined:true};
    if(typeof value==='function'){if(!functionSources.has(value))functionSources.set(value,value.toString());return {auditFunctionSource:functionSources.get(value)};}
    if(value===null||typeof value!=='object')return value;
    if(horseObjects.has(value))return {auditHorseReference:value.id};
    if(Array.isArray(value))return value.map(encode);
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,encode(value[k])]));
  }
  const result=Object.fromEntries(Object.keys(race).filter(k=>k!=='horses').sort().map(k=>[k,encode(race[k])]));
  if(result.traffic){delete result.traffic.minFollowingSlack;delete result.traffic.minResponseSlack;}
  result.horses=race.horses.map(h=>Object.fromEntries(Object.keys(h).sort().map(k=>[k,encode(h[k])])));
  return JSON.stringify(result);
}
assert.equal(snapshot(ra.race),snapshot(rb.race),'Initial full race state differs');
let frameCount=0;
while(!ra.race.finished&&ra.race.t<610){
  beforeTrace.queries=[];afterTrace.queries=[];beforeTrace.witnesses=[];afterTrace.witnesses=[];
  ra.step(DT);rb.step(DT);frameCount++;
  assert.deepEqual(beforeTrace.queries,afterTrace.queries,'Following-slack query order or arguments differ at frame '+frameCount);
  assert.deepEqual(beforeTrace.witnesses,afterTrace.witnesses,'Persistent negative-witness cache writes differ at frame '+frameCount);
  assert.equal(snapshot(ra.race),snapshot(rb.race),'Full state/commands/motion/accounting differs at frame '+frameCount);
}
assert(ra.race.finished&&rb.race.finished);assert.equal(frameCount,4410);
assert.equal(negatives.length,211);
assert(negatives.every(c=>c.endpointAxisOverlap===null&&c.stepAxisOverlap===null),'A negative record concerns a solver-overlapping pair');
assert.equal(ra.race.traffic.minFollowingSlack,-1.9541759798124962);
assert.equal(rb.race.traffic.minFollowingSlack,expectedCorrectedFollowing);
assert.equal(rb.race.traffic.minResponseSlack,expectedCorrectedResponse);
assert(rb.race.traffic.minFollowingSlack>=-1e-6,'Original engineering threshold still fails');
// Independently evaluate captured motions with the repaired-heading original
// full-domain kernel. Disable all certificates, cached returns and witness
// exits. A high-horizon two-horse closure needs only one initialization tick;
// it is not another complete race or part of the numerical matrix.
let fullSource=reference;
const start=fullSource.indexOf('      function followingSlack('),from=fullSource.indexOf('        const ownScale=',start),to=fullSource.indexOf('        const own=brakingTrajectory(move)',from);
assert(start>=0&&from>start&&to>from);
fullSource=fullSource.slice(0,from)+'        const ownScale=laneProgressCoef(move.s,move.t,geo);\n        const response=(1/60)*move.v*ownScale;\n        const paired=new WeakMap();\n'+fullSource.slice(to);
fullSource=fullSource.replaceAll('if(withResponse&&closest-response<-1e-7)','if(false&&closest-response<-1e-7)');
const closureMarker='      // 横移提案同步审核；两匹相向并道不得分别对照旧位置获得许可。';
assert.equal(fullSource.split(closureMarker).length,2);
fullSource=fullSource.replace(closureMarker,'      globalThis.__probe={followingSlack,bodyClearance,brakingTrajectory,axisOverlap};\n'+closureMarker);
const privateReference={},R=compile(fullSource,privateReference);
const rr=R.createRace(R.makeField(R.mulberry32(1),{n:2,level:70}),options(R)),[rear,front]=rr.race.horses;
for(const [i,h] of [rear,front].entries()){h.s=i?500:-1000;h.v=30;h.aerobic=100000;h.aerobicOutput=100000;h.startDelay=0;h.control={targetV:30,targetT:h.t};}
rr.step(DT);const probe=privateReference.__probe;assert(probe);
const referenceChecks=firstCaptures.map(c=>{
  rear.adj={...c.rear.adj};front.adj={...c.front.adj};const a={...c.rear.motion},b={...c.front.motion};
  const fullMinimum=probe.followingSlack(rear,front,a,b,false),fullResponse=probe.followingSlack(rear,front,a,b,true);
  const own=probe.brakingTrajectory(a),lead=probe.brakingTrajectory(b),horizon=Math.max(a.v,b.v)/R.RACE_F.braking;
  let gridMinimum=Infinity,timeAtGridMinimum=null;
  for(let at=0;at<=horizon+.005;at+=.005){const t=Math.min(at,horizon),x=own.pointAt(t),y=lead.pointAt(t),gap=y.s-x.s-probe.bodyClearance(rear,front,x.s,y.s,a.t,b.t).longitudinal;if(gap<gridMinimum){gridMinimum=gap;timeAtGridMinimum=t;}}
  assert.equal(fullMinimum,c.slack);assert.equal(fullResponse,c.response);assert(Math.abs(gridMinimum-fullMinimum)<1e-9);
  return {frameBeforeStep:c.frameBeforeStep,raceTime:c.raceTime,rearId:c.rear.id,frontId:c.front.id,lateralDifference:c.lateralDifference,lateralClearance:c.clear.lateral,lateralShortfall:c.clear.lateral-c.lateralDifference,physicalBodyWidthClearance:c.clear.lateral-.1,physicalLateralSeparationMargin:c.lateralDifference-(c.clear.lateral-.1),endpointAxisOverlap:c.endpointAxisOverlap,stepAxisOverlap:c.stepAxisOverlap,nearFinish:a.s>=job.length||b.s>=job.length,optimizedFictitiousSameLaneMinimum:c.slack,unoptimizedFullDomainFictitiousSameLaneMinimum:fullMinimum,unoptimizedResponseMinimum:fullResponse,gridMinimum,timeAtGridMinimum,difference:c.slack-fullMinimum};
});
const sourceUnchanged=rawEngineHash===HASH(read(archivePath))&&currentEngineHash===HASH(read(currentPath))&&referenceEngineHash===HASH(read(referencePath));assert(sourceUnchanged);
const report={rawEngineHash,currentEngineHash,referenceEngineHash,baselineCommit:frozen.COMMIT,job,
  rawMinimumFollowingSlack:ra.race.traffic.minFollowingSlack,correctedMinimumFollowingSlack:rb.race.traffic.minFollowingSlack,
  rawMinimumResponseSlack:ra.race.traffic.minResponseSlack,correctedMinimumResponseSlack:rb.race.traffic.minResponseSlack,
  allHorseFramesExact:true,allOutcomesExact:true,onlyTelemetryChanged:true,frameCount,sourceUnchanged,
  telemetryQueryOrderPreserved:true,followingSlackQuerySequenceExact:true,persistentNegativeWitnessWritesExact:true,
  followingSlackQueryCalls:beforeTrace.queryCount,persistentNegativeWitnessWrites:beforeTrace.witnessCount,
  protocol:{sourceArchive:path.relative(ROOT,archivePath),currentSource:path.relative(ROOT,currentPath),referenceSource:path.relative(ROOT,referencePath),dt:DT,sourceComparison:'Exact inverse of the telemetry assignment gate and the two reviewed legacy entry lines restores the entire frozen source; no region excluded. Original outer overlap condition and both followingSlack queries remain unchanged and occur before the new inner assignment gate.',frameComparison:'Every enumerable horse and race state field, control/strategy/history, trajectory, work/reserve/physiology, function source and horse reference identity after each tick. Only race.traffic.minFollowingSlack and race.traffic.minResponseSlack omitted.',queryComparison:'Every followingSlack call in original execution order with horse IDs, both candidate s/t/v states and withResponse flag; every persistent negative-witness time write, compared after each tick. The assignment gate does not skip queries or alter cache mutations.',scope:'One paired 1200m field, two full executions. Existing 270/18 raw matrices retain their archive engine hash and original telemetry; neither overwritten nor relabeled.',engineeringThreshold:'Existing minFollowingSlack >= -1e-6 remains unchanged.',reference:'Repaired-heading ac9 full-domain kernel with every safety fast path and witness early exit disabled. Three captured proposal queries plus independent 5ms grid, one high-horizon initialization tick.'},
  diagnosis:{cause:'Final telemetry used bare lateral < clearance, while the solver axisOverlap constant branch subtracts 1e-9m. A roundoff difference of 5.8176e-14m classified already separated lanes as a fictitious same-lane stopping domain.',negativeRecords:negatives.length,genuineSolverOverlappingNegativeRecords:negatives.filter(c=>c.endpointAxisOverlap!==null).length,allNegativeRecordsHaveNoStepOverlap:negatives.every(c=>c.stepAxisOverlap===null),rawTraffic:ra.race.traffic,correctedTraffic:rb.race.traffic},
  boundaryCases,firstCaptures,negativeRecords:negatives,referenceChecks,
  results:rb.race.order.map(h=>({id:h.id,place:h.place,time:h.time,final600:h.final3f,sectionals:h.sectionals}))};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,rawEngineHash,currentEngineHash,frameCount,rawMinimumFollowingSlack:report.rawMinimumFollowingSlack,correctedMinimumFollowingSlack:report.correctedMinimumFollowingSlack,rawMinimumResponseSlack:report.rawMinimumResponseSlack,correctedMinimumResponseSlack:report.correctedMinimumResponseSlack,allHorseFramesExact:true,allOutcomesExact:true,onlyTelemetryChanged:true,telemetryQueryOrderPreserved:true,followingSlackQuerySequenceExact:true,persistentNegativeWitnessWritesExact:true,followingSlackQueryCalls:beforeTrace.queryCount,persistentNegativeWitnessWrites:beforeTrace.witnessCount,sourceUnchanged,negativeRecords:negatives.length},null,2));
