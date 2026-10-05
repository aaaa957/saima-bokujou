#!/usr/bin/env node
'use strict';
// Read-only reduction of archived measurements. No engine is compiled or
// advanced here, and no raw report is rewritten. Missing/failed jobs remain.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {auditRegressions}=require('./helpers/regression-audit-v11');
const ROOT=path.resolve(__dirname,'..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),normalized=x=>sha(x.replace(/\r\n/g,'\n'));
const METRICS=[
 ['winnerTime','冠军完赛时间','s'],['winnerFinal600','冠军个人末600m','s'],['first200','领先者首200m','s'],
 ['first400','领先者首400m','s'],['first600','领先者首600m','s'],['remainingSpeed','200m后速度代理','m/s'],
 ['tailSeconds','首末完赛差','s'],['within1','冠军后1s内比例','%'],['within2','冠军后2s内比例','%'],
 ['final600Span','全场个人末600m极差','s'],['post200Cv','首200m后领先者分段CV','ratio'],['last200Difference','最后200m减倒数第二段','s']
];
const PARTITIONS=[['calibration','2023/2024 调参组'],['internal','2022/2025 已见内部交叉检验'],['reserved2020','2020 本轮未用于调参的年份检验']];
const clone=x=>JSON.parse(JSON.stringify(x)),finite=x=>typeof x==='number'&&Number.isFinite(x);
function quantile(a,p=.5){a=a.filter(finite).sort((x,y)=>x-y);if(!a.length)return null;const k=(a.length-1)*p,i=Math.floor(k);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(k-i);}
function distribution(a){return {n:a.filter(finite).length,missing:a.length-a.filter(finite).length,median:quantile(a),p10:quantile(a,.1),p90:quantile(a,.9),min:quantile(a,0),max:quantile(a,1)};}
function cv(a){const mean=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-mean)**2,0)/a.length)/mean;}
function rel(file){return path.relative(ROOT,path.resolve(ROOT,file)).replace(/\\/g,'/');}
function readBytes(file){const bytes=fs.readFileSync(path.resolve(ROOT,file));return bytes[0]===0x1f&&bytes[1]===0x8b?zlib.gunzipSync(bytes):bytes;}
function readJson(file){return JSON.parse(readBytes(file).toString('utf8'));}
function literalRaceParameters(source){
 const match=source.match(/\bconst RACE_F\s*=\s*(\{[\s\S]*?\n  \});/);assert(match,'No recognized literal RACE_F block');
 // Parse only numeric/object constants as JSON. Never execute production code.
 const json=match[1].replace(/\/\/[^\n]*/g,'').replace(/([,{]\s*)([A-Za-z_$][\w$]*)\s*:/g,'$1"$2":').replace(/,\s*([}\]])/g,'$1');
 return JSON.parse(json);
}
function compactRow(r){return {
 ...Object.fromEntries(['kind','jobKey','id','partition','length','n','course','dir','state','seed','raceSeed','replicate','cohort','context','completed','finished','fullRace','forecastQueries','inputHash','frames','internalTicks','wallSeconds','threadCpuSeconds',
  'maxWorkError','maxReserveError','maxMotionError','maxUnpaid','bodyOverlapFrames','minAcceleration','maxAcceleration','marginLengths','marginSeconds',...METRICS.map(m=>m[0])].map(k=>[k,r[k]??null])),
 engineering:clone(r.engineering||{}),traffic:clone(r.traffic||{}),prediction:r.prediction?{
  feasible:r.prediction.feasible,pure:r.prediction.pure,timeError:r.prediction.timeError,requestedV:r.prediction.requestedV,fromS:r.prediction.fromS}:null,
 effectiveParametersHash:r.effectiveRaceParameters?sha(JSON.stringify(r.effectiveRaceParameters)):null,effectiveRaceParameters:r.effectiveRaceParameters?clone(r.effectiveRaceParameters):null,
 cohortDiagnostic:r.fieldGenerationDiagnostics?{candidates:r.fieldGenerationDiagnostics.candidates,eligible:r.fieldGenerationDiagnostics.eligible,fallback:r.fieldGenerationDiagnostics.fallback,
  shortage:r.fieldGenerationDiagnostics.shortage,requested:r.fieldGenerationDiagnostics.requested,selected:r.fieldGenerationDiagnostics.selected}:null,
 horses:(r.horses||[]).map(h=>({...Object.fromEntries(['id','place','time','final600','observedStyle','straightStyle','straightRank','peakSpeed','reserve','retention','gapLengths'].map(k=>[k,h[k]??null]))})),
 powerProfiles:(r.powerProfiles||[]).map(h=>({id:h.id,meanPhysicalV:h.meanPhysicalV,post200MeanPhysicalV:h.post200MeanPhysicalV,peakV:h.peakV}))
};}
function loadValidation(file){
 const raw=readBytes(file),r=JSON.parse(raw.toString('utf8'));
 assert(r.protocol&&Array.isArray(r.samples)&&Array.isArray(r.errors),'Expected a declared validation report: '+file);
 assert.equal(normalized(JSON.stringify(r.protocol)),r.protocolHash,'Protocol hash mismatch: '+file);
 const declared=r.protocol.jobs||[],declaredMap=new Map(declared.map(j=>[sha(JSON.stringify(j)),j]));assert.equal(declaredMap.size,declared.length,'Duplicate declared jobs: '+file);
 const seen=new Set();for(const row of [...r.samples,...r.errors.filter(e=>e.jobKey)]){
  assert(declaredMap.has(row.jobKey)&&!seen.has(row.jobKey),'Foreign/duplicate measured or failed job: '+file);seen.add(row.jobKey);
  if(r.samples.includes(row))for(const [k,v]of Object.entries(declaredMap.get(row.jobKey)))assert.deepEqual(row[k],v,'Job identity changed: '+file+' '+k);
 }
 const sourceHash=r.protocol.engineNormalizedSha256||r.protocol.sourceNormalizedSha256,sourceFile=r.execution?.sourceSnapshotArtifact,
  driverFile=r.execution?.driverSnapshotArtifact,driverHash=r.execution?.driverNormalizedSha256||r.protocol.driverNormalizedSha256;
 const sourceProof=sourceFile?{file:rel(sourceFile),expected:sourceHash,actual:normalized(readBytes(sourceFile).toString('utf8'))}:null;
 const driverProof=driverFile?{file:rel(driverFile),expected:driverHash,actual:normalized(readBytes(driverFile).toString('utf8'))}:null;
 if(sourceProof)assert.equal(sourceProof.actual,sourceProof.expected,'Archived source mismatch: '+file);
 if(driverProof)assert.equal(driverProof.actual,driverProof.expected,'Archived driver mismatch: '+file);
 const rows=r.samples.map(compactRow),missingJobKeys=[...declaredMap.keys()].filter(k=>!seen.has(k)),closed=r.execution?.closed===true;
 return {file:rel(file),rawBytes:raw.length,rawByteSha256:sha(raw),protocolHash:r.protocolHash,sourceHash,parameters:clone(r.protocol.parameters||{}),cohort:r.protocol.cohort,
  scope:r.protocol.scope,dt:r.protocol.dt,referenceHashes:clone(r.protocol.referenceHashes||[]),sourceProof,driverProof,closed,complete:closed&&missingJobKeys.length===0,
  integrity:clone(r.integrity||{}),missingJobKeys,errors:clone(r.errors),rows,declaredJobs:clone(declared),
  counts:{declared:declared.length,measured:rows.length,retainedErrors:r.errors.length,fullCourseAttempts:rows.filter(s=>s.fullRace).length,
   completedFullCourses:rows.filter(s=>s.fullRace&&s.completed).length,officialRaceAttempts:rows.filter(s=>s.kind==='race').length,
   completedOfficialRaces:rows.filter(s=>s.kind==='race'&&s.completed).length,soloForecastFullCourseAttempts:rows.filter(s=>s.kind==='forecast').length,
   completedSoloForecastFullCourses:rows.filter(s=>s.kind==='forecast'&&s.completed).length,startTo600Attempts:rows.filter(s=>s.kind==='start').length,
   completedStartTo600:rows.filter(s=>s.kind==='start'&&s.completed).length,forecastQueries:rows.reduce((a,s)=>a+(s.forecastQueries||0),0)},wallSeconds:r.execution?.wallSeconds??null};
}
function loadReferences(files){
 const races=[],proofs=[];
 for(const file of files){const bytes=readBytes(file),data=JSON.parse(bytes.toString('utf8'));proofs.push({file:rel(file),sha256:sha(bytes)});
  for(const r of data.races){const horses=r.horses.filter(h=>finite(h.finishTime)),winner=horses.find(h=>h.finishPosition===1),times=horses.map(h=>h.finishTime),endings=horses.map(h=>h.final600),splits=r.raceSectionals200m;
   assert(winner&&horses.length>1&&splits?.length===r.length/200&&endings.every(finite),'Malformed real event '+r.id);
   const year=Number(r.date.slice(0,4)),partition=[2023,2024].includes(year)?'calibration':year===2020?'reserved2020':'internal';
   races.push({id:r.id,date:r.date,length:r.length,partition,fieldSize:r.fieldSize,finiteFinishers:horses.length,urls:r.urls||r.sourceUrls||r.source||r.url||null,
    metrics:{winnerTime:winner.finishTime,winnerFinal600:winner.final600,first200:splits[0],first400:splits[0]+splits[1],first600:splits.slice(0,3).reduce((a,b)=>a+b,0),
     remainingSpeed:(r.length-200)/(winner.finishTime-splits[0]),tailSeconds:Math.max(...times)-winner.finishTime,
     within1:times.filter(t=>t-winner.finishTime<=1+1e-9).length/times.length,within2:times.filter(t=>t-winner.finishTime<=2+1e-9).length/times.length,
     final600Span:Math.max(...endings)-Math.min(...endings),post200Cv:cv(splits.slice(1)),last200Difference:splits.at(-1)-splits.at(-2)},
    supplemental:{championAverageSpeed:r.length/winner.finishTime}});
  }
 }
 assert.equal(new Set(races.map(r=>r.id)).size,races.length,'Duplicated real events');return {races,proofs};
}
function validateReferences(reports,proofs){const expected=new Map(proofs.map(p=>[p.file,p.sha256]));for(const r of reports)for(const p of r.referenceHashes)
 assert.equal(expected.get(rel(p.file)),p.sha256,'Official references changed after measurement: '+r.file+' '+p.file);}
function combine(reports){const keys=new Set(),rows=[];for(const r of reports)for(const row of r.rows){assert(!keys.has(row.jobKey),'Overlapping final validation input: '+r.file+' '+row.jobKey);keys.add(row.jobKey);rows.push(row);}return rows;}
function groupEvents(rows,refs){return refs.map(real=>{const samples=rows.filter(r=>r.kind==='race'&&r.id===real.id),valid=samples.filter(r=>r.completed&&r.finished),metrics={};
 for(const [key]of METRICS){const v=valid.map(r=>r[key]);metrics[key]={value:quantile(v),error:quantile(v.map(x=>finite(x)?x-real.metrics[key]:null)),
  relativeError:real.metrics[key]===0?null:quantile(v.map(x=>finite(x)?x/real.metrics[key]-1:null)),validSeedMetrics:v.filter(finite).length,missingSeedMetrics:v.length-v.filter(finite).length};}
 return {id:real.id,date:real.date,length:real.length,partition:real.partition,measuredSeeds:samples.length,completedSeeds:valid.length,seedRecords:samples.map(r=>({seed:r.seed,replicate:r.replicate,completed:r.completed,engineeringPassed:r.engineering.passed,inputHash:r.inputHash})),metrics,
  decomposition:valid.map(r=>({seed:r.seed,totalError:r.winnerTime-real.metrics.winnerTime,startError:r.first200-real.metrics.first200,
   remainingError:(r.winnerTime-r.first200)-(real.metrics.winnerTime-real.metrics.first200)})),
  supplemental:{championAverageSpeed:quantile(valid.map(r=>r.length/r.winnerTime)),championMarginLengths:quantile(valid.map(r=>r.marginLengths)),championMarginSeconds:quantile(valid.map(r=>r.marginSeconds)),
   maximumHorsePeakSpeed:quantile(valid.map(r=>quantile(r.horses.map(h=>h.peakSpeed),1))),winnerAveragePhysicalSpeed:quantile(valid.map(r=>{const w=r.horses.find(h=>h.place===1);return r.powerProfiles.find(p=>p.id===w?.id)?.meanPhysicalV;}))}};
 });}
function engineeringSummary(reports){const rows=reports.flatMap(r=>r.rows),forecasts=rows.filter(r=>r.prediction),feasible=forecasts.filter(r=>r.prediction.feasible);return {
 passed:reports.length>0&&rows.length>0&&reports.every(r=>r.complete&&r.errors.length===0)&&rows.every(r=>r.engineering.passed===true),
 failures:reports.flatMap(r=>r.rows.filter(row=>!row.engineering.passed).map(row=>({file:r.file,jobKey:row.jobKey,kind:row.kind,id:row.id,length:row.length,checks:row.engineering.failedChecks||[],completed:row.completed}))),
 errors:reports.flatMap(r=>r.errors.map(e=>({file:r.file,...e}))),missingJobs:reports.flatMap(r=>r.missingJobKeys.map(jobKey=>({file:r.file,jobKey}))),
 maxWorkError:Math.max(0,...rows.map(r=>r.maxWorkError||0)),maxReserveError:Math.max(0,...rows.map(r=>r.maxReserveError||0)),maxMotionError:Math.max(0,...rows.map(r=>r.maxMotionError||0)),maxUnpaid:Math.max(0,...rows.map(r=>r.maxUnpaid||0)),
 overlapExecutions:rows.filter(r=>r.bodyOverlapFrames>0).length,infeasibleTrafficSteps:rows.reduce((n,r)=>n+(r.traffic?.infeasibleSteps||0),0),
 forecast:{queries:forecasts.length,feasible:feasible.length,infeasible:forecasts.length-feasible.length,purityFailures:forecasts.filter(r=>r.prediction.pure!==true).length,
  feasibleAbsoluteTimeError:distribution(feasible.map(r=>Math.abs(r.prediction.timeError))),infeasibleAbsoluteTimeError:distribution(forecasts.filter(r=>!r.prediction.feasible).map(r=>Math.abs(r.prediction.timeError)))}};}
function styles(rows){return [...new Set(rows.filter(r=>r.kind==='race').map(r=>r.length))].sort((a,b)=>a-b).map(length=>{
 const races=rows.filter(r=>r.kind==='race'&&r.length===length&&r.completed&&r.finished),horses=races.flatMap(r=>r.horses);return {length,races:races.length,totalStarts:horses.length,
  categories:['逃','先','差','追'].map(style=>{const members=horses.filter(h=>h.observedStyle===style),wins=members.filter(h=>h.place===1).length;return {style,starts:members.length,wins,winPerStart:members.length?wins/members.length:null,winnerShare:races.length?wins/races.length:null};}),
  unknownStyles:horses.filter(h=>!['逃','先','差','追'].includes(h.observedStyle)).length};
 });}
function comparison(refs,oldEvents,newEvents){return PARTITIONS.map(([partition,label])=>{
 const real=refs.filter(r=>r.partition===partition),common=real.filter(r=>oldEvents.find(e=>e.id===r.id)?.completedSeeds&&newEvents.find(e=>e.id===r.id)?.completedSeeds),
  newCovered=real.filter(r=>newEvents.find(e=>e.id===r.id)?.completedSeeds);
 const table=(subset)=>Object.fromEntries(METRICS.map(([k])=>[k,{real:distribution(subset.map(r=>r.metrics[k])),
  old:distribution(subset.map(r=>oldEvents.find(e=>e.id===r.id)?.metrics[k]?.value)),new:distribution(subset.map(r=>newEvents.find(e=>e.id===r.id)?.metrics[k]?.value)),
  oldError:distribution(subset.map(r=>oldEvents.find(e=>e.id===r.id)?.metrics[k]?.error)),newError:distribution(subset.map(r=>newEvents.find(e=>e.id===r.id)?.metrics[k]?.error)),
  oldAbsoluteRelativeError:distribution(subset.map(r=>{const v=oldEvents.find(e=>e.id===r.id)?.metrics[k]?.relativeError;return finite(v)?Math.abs(v):null;})),
  newAbsoluteRelativeError:distribution(subset.map(r=>{const v=newEvents.find(e=>e.id===r.id)?.metrics[k]?.relativeError;return finite(v)?Math.abs(v):null;}))}]));
 return {partition,label,declaredRealEvents:real.length,newCoveredEvents:newCovered.length,commonOldNewEvents:common.length,
  newCoveredTable:table(newCovered),commonOldNewTable:table(common)};
 });}
function gateFailures(events){const defs=[['winnerTime',.05,'冠军时间5%'],['winnerFinal600',.10,'冠军个人末600m10%'],['first600',.10,'领先首600m10%'],['first200',.10,'领先首200m10%']];
 return events.filter(e=>e.completedSeeds).flatMap(e=>defs.filter(([k,t])=>!finite(e.metrics[k].relativeError)||Math.abs(e.metrics[k].relativeError)>t).map(([metric,threshold,gate])=>({id:e.id,partition:e.partition,length:e.length,metric,threshold,gate,error:e.metrics[metric].error,relativeError:e.metrics[metric].relativeError})));}
function counts(reports){const keys=['declared','measured','retainedErrors','fullCourseAttempts','completedFullCourses','officialRaceAttempts','completedOfficialRaces','soloForecastFullCourseAttempts','completedSoloForecastFullCourses','startTo600Attempts','completedStartTo600','forecastQueries'];return Object.fromEntries(keys.map(k=>[k,reports.reduce((n,r)=>n+r.counts[k],0)]));}
function matchOldOfficialRows(oldRows,declared){const identity=r=>JSON.stringify(['id','length','n','course','dir','state','seed','raceSeed','replicate'].map(k=>r[k]??null)),
 ids=new Set(declared.filter(j=>j.kind==='race').map(identity));return oldRows.filter(row=>row.kind==='race'&&ids.has(identity(row)));}
function development(files){return files.map(file=>{const bytes=readBytes(file),r=JSON.parse(bytes.toString('utf8'));return {file:rel(file),rawByteSha256:sha(bytes),bytes:bytes.length,
  declared:r.protocol?.jobs?.length??r.jobs?.length??(r.before?.completeRows!==undefined?r.before.completeRows+r.before.unfinishedDeclaredJobs:null),
  measured:r.samples?.length??r.before?.completeRows??null,reportedCompleted:r.integrity?.fullRaceExecutions??r.completedExecutions??r.before?.completeRows??null,
  sourceHash:r.protocol?.engineNormalizedSha256||r.protocol?.sourceNormalizedSha256||r.sourceNormalizedSha256||r.engineHash||r.sourceHash||null,
  errors:clone(r.errors||r.failures||r.execution?.developmentAttempts||r.attempts||[]),administrativeStop:r.reason?{reason:r.reason,
   unfinishedDeclaredJobs:r.before?.unfinishedDeclaredJobs??null,knownProgress:clone(r.knownProgress||null),archiveMappings:clone(r.archiveMappings||[])}:null,
  // Keep small stop/resume records in full, including unknown uncompleted
  // execution and timing fields that are not numerical completed-race rows.
  payload:Array.isArray(r.samples)?null:clone(r),
  note:'Exploration/development artifact; counts never merge into final official-event evidence. Declared jobs do not establish executed or completed races.'};});}
function selectionEvidence(files){return files.map(file=>{const bytes=readBytes(file),payload=JSON.parse(bytes.toString('utf8'));
 assert(payload&&typeof payload==='object'&&!Array.isArray(payload)&&!Array.isArray(payload.samples),'--selection accepts small paired/selection records; supply numerical race reports through their own input options');
 return {file:rel(file),rawByteSha256:sha(bytes),bytes:bytes.length,payload,
  interpretation:'Exploratory declaration/paired decision evidence only; never added to final official/full/partial counts. Same event/seed may have different selected entrants, so check inputHash before isolating a parameter effect.'};});}
function calibrations(files,refs){return files.map(file=>{
 const bytes=readBytes(file),r=JSON.parse(bytes.toString('utf8'));assert(r.protocol&&Array.isArray(r.samples)&&Array.isArray(r.arms),'Supply a raw declared calibration grid: '+file);
 assert.equal(normalized(JSON.stringify(r.protocol)),r.protocolHash,'Calibration protocol hash mismatch');
 const base=rel(file).replace(/\.gz$/,''),sourceHash=r.protocol.sourceNormalizedSha256||r.protocol.engineNormalizedSha256,
  snapshotProofs=[['source',sourceHash],['driver',r.protocol.driverNormalizedSha256],['orchestrator',r.protocol.orchestratorNormalizedSha256]].map(([kind,expected])=>{
   assert(expected,'Calibration missing '+kind+' hash');const file=base+'.'+kind+'.js.gz',actual=normalized(readBytes(file).toString('utf8'));
   assert.equal(actual,expected,'Calibration archived '+kind+' mismatch');return {kind,file,expected,actual,verified:true};});
 validateReferences([{file:rel(file),referenceHashes:r.protocol.referenceHashes}],refs.proofs);
 const declared=new Map(r.protocol.jobs.map(j=>[sha(JSON.stringify(j)),j])),seen=new Set();assert.equal(declared.size,r.protocol.jobs.length,'Duplicate calibration declarations');
 for(const row of [...r.samples,...r.errors.filter(e=>e.jobKey)]){assert(declared.has(row.jobKey)&&!seen.has(row.jobKey),'Foreign/duplicate calibration job');seen.add(row.jobKey);
  if(r.samples.includes(row))for(const [key,value]of Object.entries(declared.get(row.jobKey)))assert.deepEqual(row[key],value,'Calibration job identity changed '+key);}
 const missingJobKeys=[...declared.keys()].filter(key=>!seen.has(key)),administrativeStop=clone(r.administrativeStop||null),closed=r.closed===true;
 return {file:rel(file),rawByteSha256:sha(bytes),sourceHash,cohort:r.protocol.cohort,closed,complete:closed&&missingJobKeys.length===0&&r.integrity?.complete===true,
  snapshotProofs,sourceProof:snapshotProofs[0],scopeNote:r.protocol.scopeNote||null,axisProvenance:clone(r.protocol.parameterAxisProvenance||null),
  administrativeStop,missingJobKeys,declared:r.protocol.jobs.length,measured:r.samples.length,errors:clone(r.errors),
  pairedMechanismRows:r.samples.filter(row=>row.kind==='race'&&row.completed&&row.finished).map(row=>{const winner=row.horses.find(h=>h.place===1);return {
   id:row.id,gridVariant:row.gridVariant,length:row.length,seed:row.seed,raceSeed:row.raceSeed,replicate:row.replicate,inputHash:row.inputHash,
   winnerId:winner?.id,winnerReserve:winner?.reserve,winnerTime:row.winnerTime,first200:row.first200,winnerFinal600:row.winnerFinal600};}),
  arms:r.protocol.variants.map(name=>{const rows=r.samples.filter(s=>s.gridVariant===name).map(compactRow),events=groupEvents(rows,refs.races).filter(e=>e.measuredSeeds);return {
   name,parameters:r.protocol.parameters[name],declared:r.protocol.jobs.filter(j=>j.gridVariant===name).length,measured:rows.length,
   completed:rows.filter(row=>row.completed&&row.finished).length,engineeringFailures:rows.filter(row=>!row.engineering.passed).map(row=>({id:row.id,checks:row.engineering.failedChecks})),
   metrics:Object.fromEntries(METRICS.map(([k])=>[k,{error:distribution(events.map(e=>e.metrics[k].error)),absoluteError:distribution(events.map(e=>finite(e.metrics[k].error)?Math.abs(e.metrics[k].error):null))}])),
   cost:{wallSeconds:distribution(rows.map(row=>row.wallSeconds)),threadCpuSeconds:distribution(rows.map(row=>row.threadCpuSeconds))},
   gateFailures:gateFailures(events)};})};
 });}
function calibrationAttribution(grids){const groups=new Map();for(const g of grids){const key=JSON.stringify([g.sourceHash,g.cohort]);
 if(!groups.has(key))groups.set(key,{sourceHash:g.sourceHash,cohort:g.cohort,files:[],arms:0,measured:0});const group=groups.get(key);group.files.push(g.file);group.arms+=g.arms.length;group.measured+=g.measured;}
 return {sourceGroups:[...groups.values()],crossControllerComparison: new Set(grids.map(g=>g.sourceHash)).size>1,
  interpretation:'Different source hashes include controller changes; differences across source groups cannot be attributed solely to parameter overrides. Even one source with selected cohorts may change entrants under parameter-dependent selection. Only identical entrant input hashes support isolation of mechanics.'};}
function durationPowerWitnesses(grids){const order=['fast80-nopeak','air2-fast80-nopeak-cost105','air2-fast80-nopeak-cost110'],witnesses=[];
 for(const grid of grids){const rows=grid.pairedMechanismRows||[];for(const base of rows.filter(r=>r.gridVariant===order[0]&&r.length===1200)){
  const trio=order.map(name=>rows.find(r=>r.gridVariant===name&&r.id===base.id&&r.seed===base.seed&&r.raceSeed===base.raceSeed&&r.replicate===base.replicate));
  if(trio.some(r=>!r||!finite(r.winnerReserve)||!finite(r.winnerTime))||!base.inputHash||trio.some(r=>r.inputHash!==base.inputHash||r.winnerId!==base.winnerId))continue;
  witnesses.push({file:grid.file,sourceHash:grid.sourceHash,cohort:grid.cohort,id:base.id,seed:base.seed,replicate:base.replicate,inputHash:base.inputHash,winnerId:base.winnerId,
   variants:trio.map(r=>({name:r.gridVariant,time:r.winnerTime,reserve:r.winnerReserve,first200:r.first200,final600:r.winnerFinal600})),
   timeDeltaLastMinusFirst:trio[2].winnerTime-trio[0].winnerTime,
   interpretation:'Same source and identical entrant input. Joint air/total-cost candidates, not a unique physiological identification; a small time response despite reduced reserve motivates a duration-power/fatigue hypothesis, not real GPS/metabolic proof.'});
 }}return witnesses;}
function fmt(x,unit,error=false){if(!finite(x))return '—';const v=unit==='%'?x*100:x,d=unit==='ratio'?4:unit==='%'?2:3;return (error&&v>0?'+':'')+v.toFixed(d)+(unit==='%'?(error?' pp':'%'):'');}
function summaryStatus(draft,engineeringPassed,regressionsPassed){return draft?'draft':engineeringPassed&&regressionsPassed?'complete_engineering_and_function_passed':'complete_with_retained_failures';}
function markdown(s){const out=[];out.push('# 比赛系统重构与联合校准 v11', '',s.draft?'**草稿：最终源码、参数与全部验证尚未完成；以下不是通过声明。**':'**最终测量汇总：'+(s.engineering.passed?'工程约束通过':'保留工程失败')+'；'+(s.regressionsPassed?'功能回归通过':'功能回归未通过，失败明细保留')+'。现实拟合残差另列。**','',
  '这轮将预测、实际动作、位置竞争和条件阵容连在同一个运动与供能模型上。参数校准同时查看起步、途中速度、储备支出和末段，报告不会用冠军总时掩盖队列或节奏偏差。','',
  '## 改动与机制','',
  '- 预测与执行共享逐步氧供、疲劳、储备恢复、加速/制动和路线运动；有限动作按同一时间网格切分。可见前车的响应/停止距离及跟驰限速也复用实际求解器。不可支付、无法追上或不安全的动作保留失败标记；预测不承诺未知对手未来动作。',
  '- 骑手在自身可支付范围内比较抢位、跟跑再追、等待通道、内线和冲刺；使用观测到的位置/速度/加速度。到达目标后真实执行承诺的动作阶段，重新观测时再评估，不能提前兑现未发生的节省。跑法是过程中位置的观察分类，没有跑法速度或耗能倍率。',
  '- 距离与赛级先作用于稳定候选的路线成本及供能预测，再无放回报名。较强马不受最快参考端排除；年龄、胜场和休息由上游资格决定。修复未胜利零胜上限、玩家重复身份、条件赛胜场与报名不足被隐藏的问题。已有能力、生理和性格不重抽。',
  '- 起步响应、短时功率与持续阻力/耗能采用联合筛选。空气与其它阻力的等成本锚点仅是识别实验；有效机械参数尚不能唯一解释真实生理。最终参数见下表和源码归档。','',
  '## 冻结来源与实验数量','',
  '|实验臂|源码 SHA-256|参数覆写|声明任务|完整全程完成|其中官方条件模拟|其中单马预测全程|至600m完成|保留异常|',
  '|---|---|---|---:|---:|---:|---:|---:|---:|');
 for(const [label,reports]of [['旧引擎',s.inputs.baseline],[s.draft?'候选草稿（中间快照）':'新引擎最终臂',s.inputs.candidate],['同阵容机制对照',s.inputs.pairedFixed]])for(const r of reports)
  out.push(`|${label} [原始报告](${path.basename(r.file)})|\`${r.sourceHash}\`|\`${JSON.stringify(r.parameters)}\`|${r.counts.declared}|${r.counts.completedFullCourses}|${r.counts.completedOfficialRaces}|${r.counts.completedSoloForecastFullCourses}|${r.counts.completedStartTo600}|${r.counts.retainedErrors}|`);
 out.push('',`${s.draft?'当前候选示例':'最终臂'}合计：${s.counts.candidate.completedOfficialRaces} 场官方条件模拟，${s.counts.candidate.completedSoloForecastFullCourses} 次单马全程，${s.counts.candidate.completedStartTo600} 次部分起步。单马全程包含在“完整全程”中，不重复相加。声明、尝试、完成及异常分别记录；查询初始化不算步进比赛。`,``,
  '新旧阵容有变化的比较是引擎与群体的联合效果。只有输入字段 hash 相同的对照才可以称为隔离机制效果；相同事件/seed 并不保证相同马匹。',
  '',`[机器汇总](${path.basename(s.outputSummary)}) 保留每场种子、缺失/失败、完整参数和归档证明。源码及验证 driver 的 gzip 逐份验证 SHA；大 JSON 可以无损 gzip，原始字节 SHA 不变。`,
  '',`冻结要求状态：${s.finalRequirements.satisfied?'完整':'尚不完整'}。${s.finalRequirements.missing.length?'缺少：'+s.finalRequirements.missing.join('；')+'。':''}`,
  '', '## 与官方参考的12项对照','',
  `正式新臂每场${s.plan.officialReplicates}个预声明种子。先在每场真实事件内取模拟种子的中位数，再按事件汇总；单种子时事件值就是该次测量。主表旧臂只采用与新臂声明完全匹配的事件/seed/赛况，避免把旧3种子中位数与新1种子冒充逐对比较。比例误差用百分点 pp。旧/新/现实对照表仅使用双方都有完成结果的同一事件集合；2020 若没有旧引擎测量，旧列保持空缺。完整逐事件残差在机器汇总中，不能将不同指标各自的中位数强行相加。`);
 for(const part of s.partitions){const useCommon=part.commonOldNewEvents>0,table=useCommon?part.commonOldNewTable:part.newCoveredTable;
  out.push('',`### ${part.label}`, '',`真实事件 ${part.declaredRealEvents} 场；新臂有完成结果 ${part.newCoveredEvents} 场；新旧共同事件 ${part.commonOldNewEvents} 场。`,
   '', '|指标|现实|旧引擎|新引擎|旧误差|新误差|', '|---|---:|---:|---:|---:|---:|');
  for(const [key,label,unit]of METRICS){const m=table[key];out.push(`|${label} (${unit==='%'?'比例':unit})|${fmt(m.real.median,unit)}|${fmt(m.old.median,unit)}|${fmt(m.new.median,unit)}|${fmt(m.oldError.median,unit,true)}|${fmt(m.newError.median,unit,true)}|`);}
 }
 if(s.plan.officialReplicates===1){out.push('', '### 旧引擎3种子稳定性背景','',
  '旧72场仍完整保留，下表先取每场旧3种子中位数，再按事件汇总；只作为旧引擎稳定性背景，不与新单种子称为完全配对效果。',
  '', '|分区|旧实际事件数|指标|旧3种子事件中位残差|','|---|---:|---|---:|');
  for(const part of s.baselineAllSeedPartitions)for(const [key,label,unit]of METRICS)out.push(`|${part.label}|${part.commonOldNewEvents}|${label}|${fmt(part.commonOldNewTable[key].oldError.median,unit,true)}|`);
 }
 out.push('', '## 联合参数筛选与最终值','',
  '调参网格只使用2023/2024训练事件，逐臂保留起步、途中、末段、完赛密度和工程约束。下表是训练筛选，不能替代最终30事件检验，也不能按未完成臂挑选赢家。空气项重分配保持18m/s锚点只是模型内的识别条件。',
  '', '|参数|旧生产值|新测量实际值|','|---|---:|---:|');
 if(!s.parameterChanges.length)out.push('|—|目前输入尚无不同参数|—|');
 for(const p of s.parameterChanges)out.push(`|${p.key}|\`${JSON.stringify(p.old)}\`|\`${JSON.stringify(p.new)}\`|`);
 if(s.calibrationAttribution.crossControllerComparison)out.push('', '**下列网格使用不同骑手控制器源码，逐源分表。跨表数值差包含策略更换，不能归为纯参数效果。**');
 out.push('', '同一源码的参数比较也须检查阵容输入；selected筛选可能随参数改变入选马。只有输入hash相同的对照才隔离运动机制。');
 for(const grid of s.calibrations){out.push('',`训练筛选 [${path.basename(grid.file)}](${path.basename(grid.file)})：源码 \`${grid.sourceHash}\`，阵容 ${grid.cohort}，声明${grid.declared}、已测${grid.measured}，${grid.complete?'清单已闭合':grid.administrativeStop?'行政停止，清单未完成':'清单未完成'}；保留异常${grid.errors.length}、未覆盖${grid.missingJobKeys.length}。`,
  grid.administrativeStop?'旧探索因策略更换与实测成本停止，已测行全部保留；未完成任务实际步进量未知，不算作零执行或完整比赛。':'',
  '', '|候选|完成/声明|冠军误差s|首200误差s|途中速度误差m/s|冠军600误差s|首末差误差s|1s比例误差pp|2s比例误差pp|CV误差|工程失败|','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for(const a of grid.arms){const m=a.metrics;out.push(`|${a.name}|${a.completed}/${a.declared}|${fmt(m.winnerTime.error.median,'s',true)}|${fmt(m.first200.error.median,'s',true)}|${fmt(m.remainingSpeed.error.median,'m/s',true)}|${fmt(m.winnerFinal600.error.median,'s',true)}|${fmt(m.tailSeconds.error.median,'s',true)}|${fmt(m.within1.error.median,'%',true)}|${fmt(m.within2.error.median,'%',true)}|${fmt(m.post200Cv.error.median,'ratio',true)}|${a.engineeringFailures.length}|`);}
 }
 if(s.selectionEvidence.length){out.push('', '### 条件阵容配对与选型记录','',
  '下列预声明、同条件配对与选型记录单列为探索依据，不增加最终30事件的覆盖或48次全程数量。selected阵容可能随参数变化；同事件/seed不是同马，必须逐场检查inputHash，变化时解释为阵容与引擎的联合效果。','');
  for(const evidence of s.selectionEvidence)out.push(`- [${path.basename(evidence.file)}](${path.basename(evidence.file)})：原始解压字节SHA \`${evidence.rawByteSha256}\`，${evidence.bytes} bytes。完整选择理由、指标与限制保留在记录及机器汇总中。`);
  for(const {payload:d}of s.selectionEvidence)if(d.candidate&&d.meanAbsoluteResidualDifferenceNopeakMinusPeak&&Array.isArray(d.pairedInputs)){
   const values=Object.values(d.meanAbsoluteResidualDifferenceNopeakMinusPeak).filter(finite),same=d.pairedInputs.filter(r=>r.sameInputField===true),different=d.pairedInputs.filter(r=>r.sameInputField===false);
   out.push('',`探索选择 \`${d.candidate}\`：相对peak臂，nopeak在${values.filter(v=>v<0).length}项指标的平均绝对残差较小、${values.filter(v=>v>0).length}项较大；宽松速度门槛失败nopeak ${d.gates?.nopeak?.length??'未知'}项、peak ${d.gates?.peak?.length??'未知'}项，没有一臂全面占优。`,
    '',`已记录${d.pairedInputs.length}个配对事件，其中${same.length}场输入相同（距离${[...new Set(same.map(r=>r.length))].join('/')||'未提供'}m），${different.length}场输入变化（距离${[...new Set(different.map(r=>r.length))].join('/')||'未提供'}m）。前者支持在固定输入下比较该参数组合，后者包含阵容选择效应。这是训练筛选，不能替代最终年份检验或证明队列与节奏拟合。`);
  }
 }
 out.push('', '## 功能与页面回归','');
 if(!s.regressions.length)out.push('当前汇总尚未导入最终源码的功能回归记录；不以历史测试替代最终冻结源码验收。');
 else{out.push('|回归记录|实际源码SHA|通过|失败|源码保持不变|','|---|---|---:|---:|---|');
  for(const r of s.regressionAudit.records)out.push(`|[${path.basename(r.file)}](${path.basename(r.file)})|\`${r.sourceHash||'未提供'}\`|${r.passedCount}|${r.failedCount}|${r.immutable??'未提供'}|`);
 }
 out.push('', `功能回归状态：${s.regressionsPassed?'通过':'未通过或尚不完整'}。所需两份wrapper${s.regressionAudit.requiredWrappersComplete?'来源及清单齐全':'尚未齐全'}；工程检查结果另列，不能相互替代。`);
 for(const f of s.regressionAudit.failures)out.push(`- 保留失败 [${path.basename(f.file)}](${path.basename(f.file)})：${f.failure.name||f.failure.id}，退出码${f.failure.exitCode??'未执行'}；${f.failure.reason||f.failure.error||f.failure.spawnError||JSON.stringify(f.failure.evidence?.problems||[])}`);
 for(const i of s.regressionAudit.issues)out.push(`- wrapper检查：${path.basename(i.file)} — ${i.issue}`);
 out.push('', '## 工程检查与宽松速度门槛','',
  `${s.draft?'当前草稿输入':'最终冻结输入'}的工程检查：${s.engineering.passed?(s.draft?'当前输入样本检查通过；这不代表最终清单完成':'全部声明任务闭合且检查通过'):'有失败、未完成或缺失，请看明细'}。work 最大误差 ${s.engineering.maxWorkError.toExponential(3)}，reserve ${s.engineering.maxReserveError.toExponential(3)}，运动 ${s.engineering.maxMotionError.toExponential(3)}，漏付 ${s.engineering.maxUnpaid.toExponential(3)}；实体交叠 ${s.engineering.overlapExecutions} 次执行，交通不可行 ${s.engineering.infeasibleTrafficSteps} 步。`,
  '', `单马预测查询 ${s.engineering.forecast.queries} 次，其中可行 ${s.engineering.forecast.feasible}、不可行 ${s.engineering.forecast.infeasible}；可行预测绝对时间误差中位 ${fmt(s.engineering.forecast.feasibleAbsoluteTimeError.median,'s')}s，最大 ${fmt(s.engineering.forecast.feasibleAbsoluteTimeError.max,'s')}s。不可行请求单独保留，不能当作可行预测达标。`,
  '', `四项宽松速度门槛有 ${s.gateFailures.length} 项事件级失败（冠军5%、冠军末600/领先首600/领先首200各10%）。它们不验证完赛密度、跑法平衡或真实战术生成。`,
  '', '|事件|分区|距离|失败门槛|残差|相对误差|','|---|---|---:|---|---:|---:|');
 if(!s.gateFailures.length)out.push('|—|—|—|当前完成样本中无失败；覆盖状况见上|—|—|');
 for(const f of s.gateFailures)out.push(`|${f.id}|${f.partition}|${f.length}|${f.gate}|${fmt(f.error,'s',true)}s|${fmt(f.relativeError,'%',true).replace(' pp','%')}|`);
 out.push('', '## 按观察跑法与距离统计','',
  `分类使用比赛过程中平均相对位置：逃≤0.15、先≤0.45、差≤0.75，其余追。下表是各类出赛马获胜数/出赛数，不是把赢家比例当胜率，也不是预设跑法标签的因果效应。每个事件${s.plan.officialReplicates}个种子，样本相关、人数不同且分类由比赛过程生成，不能据小样本宣称跑法已经平衡或群体胜率稳定。`,
  '', '|距离|完成场数|观察跑法|出赛马次数|获胜次数|每次出赛胜率|占赢家比例|','|---:|---:|---|---:|---:|---:|---:|');
 for(const r of s.styles)for(const c of r.categories)out.push(`|${r.length}|${r.races}|${c.style}|${c.starts}|${c.wins}|${fmt(c.winPerStart,'%')}|${fmt(c.winnerShare,'%')}|`);
 out.push('', '## 残差对应的结构限制与下一步','',
  '目标位置和有限抢位已实现，但可见对手未来主要来自运动prior；尚没有真实对手意图推断、随机化战术选择及场内战术相互响应形成的配速共识。持续配速仍受余程能量预算强约束。工程一致性通过只说明动作与账本自洽，不能证明队列密度或节奏拟合。下列是可验证的解释假设，不是单一确定因果。', '',
  '- 若首末差仍偏大、冠军后1/2秒比例仍偏低，应先区分阵容分化与场内分离：固定相同马的输入，比较对手意图估计、跟跑收益/抢位风险和让路响应的增量影响，再检验现实赛级下的个体联合分布。不要直接压缩终点时间差。',
  '- 若领先者首200m后分段CV仍偏小，应检验余程预算是否使全场过早收敛到近似稳定速度，再引入基于观测的领跑竞争、主动降速等待与随后响应。领先者包络变化还需分解领先马更替，不能当作单马速度波动。',
  '- 若全场个人末600m极差或最后200m减倒数第二段仍偏离，应同时检验累积交通受阻、不同储备消耗历史、启动时机和疲劳恢复；分别用固定生理/自由策略与自由生理/固定动作对照，避免把所有差异塞入末段倍率。',
  '- 起步、途中速度和冠军末600m必须联合看逐事件残差。短时功率、持续阻力与供氧恢复存在代偿，单个候选改善首段不能证明整场机制已校准；新参数需在冻结后完整检验全部距离与年份。');
 if(s.durationPowerWitnesses.length){out.push('', '短时出力与持续速度的具体训练见证（仍属解释假设）：','');
  for(const w of s.durationPowerWitnesses)out.push(`- 同源\`${w.sourceHash}\`、固定输入hash、事件${w.id}/seed${w.seed}、同一冠军${w.winnerId}：${w.variants.map(v=>v.name).join(' → ')}，完赛储备比例${w.variants.map(v=>v.reserve.toFixed(3)).join(' → ')}，冠军总时仅增加${w.timeDeltaLastMinusFirst.toFixed(3)}s。数据来自[训练网格](${path.basename(w.file)})，不是最终年份检验。`);
  out.push('', '早期起步/峰值联合候选减少首段误差同时使全程和个人末600m更快；新空气/总成本候选明显支出更多储备，却很少降低短途持续速度。这提示固定全程速度上限、仍充足的储备与余程预算可能让高速度维持过久。下一步可检验更可辨识的力/功率随持续时间变化、疲劳累积及恢复关系，使短时高速度与较低持续速度从同一状态模型产生。现有引擎已有供能与疲劳；假设针对它们与可达速度/持续出力的耦合，不能说完全缺少疲劳，更不能据模型对照断言真实马的GPS或代谢机制。');
 }
 out.push('', '## 全部异常、探索与限制','',
  `${s.draft?'当前草稿输入':'正式冻结输入'}中保留 worker/执行异常 ${s.engineering.errors.length} 条、工程失败 ${s.engineering.failures.length} 条、缺覆盖 ${s.engineering.missingJobs.length} 条。完整内容在机器汇总，不换 seed、不删失败样本。`,
  '', '|探索/开发记录|声明任务|完成样本记录数|说明|','|---|---:|---:|---|');
 for(const d of s.development)out.push(`|[${path.basename(d.file)}](${path.basename(d.file)})|${d.declared??'未知'}|${d.measured??'未知'}|独立保存，未混入最终验收|`);
 out.push('',
  '- 2023/2024 用于调参；2022/2025 已经看过，只是内部交叉检验；2020 本轮未用于调参，验证代理已读其官方页面，不能称为双盲。30场是有限的六种距离赛事样本，没有声称代表整个真实赛马群体。',
  '- JRA 200m分段是各标志处的领先者包络，可能来自不同马；首段后CV不是同一匹马速度CV。冠军个人末600m、全场个人末600m极差是另一种观测，后者含公开估计误差。200m后速度代理混合冠军总时与领先者首段，不是冠军GPS速度。',
  '- 统一level86、480kg、健康、优秀骑手及冠军负重的合成阵容不是复刻真实参赛马。未知真实能力、不同马负重、风及个体生理仍是混杂因素。实际路线由官方尺寸约束的简化几何构成，未测逐马GPS轨迹。',
  '- 新阵容仍使用level±2的类别代理与4n候选池。预测准备度匹配和性格Beta(2,2)是模型假设，尚无真实人才/性格/报名分布的独立标定。更合理的机制不等于这些群体先验已验证。',
  '- 资格过滤沿用当前游戏的胜场解锁规则，尚未建模真实赛事奖金、公开rating与优先出走排序，不能把游戏参赛资格称为JRA报名规则的完整复刻。',
  s.plan.officialReplicates===1?'- 原计划30场官方事件×3种子（90官方全场），加18单马全程、108部分起步；实测一场2400m约469.858s线程CPU/1129.5s墙钟后，基本数值验收修订为全部30事件各1个固定预声明种子，保留全部距离/年份，不换seed或挑选结果。正式清单为48次完整全程+108次部分起步。减少重复模拟没有减少真实独立事件，代价是新方种子稳定性与群体胜率不能验证。':'- 使用原30事件×3预声明种子的较大方案，加18单马全程、108部分起步；正式清单为108次完整全程+108次部分起步。多个合成种子仍不增加真实独立事件数。',
  '- 可见交通预测复用物理约束，但对手未来路线/策略未知；trafficCertified保持false。空气项和其它阻力联合校准不是唯一生理参数识别，不能把实验17%空气锚点写成实测目标。',
  '', '主要口径与方法依据：[JRAハロンタイム](https://jra.jp/kouza/yougo/w291.html)、[JRA成绩报告口径](https://www.jra.go.jp/datafile/seiseki/report/mikata4.html)、[Spence等2012群体配速与跟跑研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC3391435/)、[Mercier与Aftalion2020最优出力研究](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0235024)。个别研究赛道/样本的结果不直接成为本项目全部草地群体的验收值。','');
 return out.join('\n');}
function main(args){
 const many=k=>args.flatMap((v,i)=>v===k?[args[i+1]]:[]),one=(k,d)=>many(k)[0]??d,draft=args.includes('--draft'),officialReplicates=Number(one('--official-replicates','1'));
 assert([1,3].includes(officialReplicates),'--official-replicates supports the declared 1 or original 3');
 for(let i=0;i<args.length;i++)if(args[i].startsWith('--')&&!['--draft'].includes(args[i]))assert(args[i+1]&&!args[i+1].startsWith('--'),'Missing '+args[i]);
 const productionText=fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'),productionHash=normalized(productionText),productionParameters=literalRaceParameters(productionText),
  baseline=many('--baseline').map(loadValidation),candidate=many('--candidate').map(loadValidation),pairedFixed=many('--paired-fixed').map(loadValidation);
 assert(baseline.length,'Supply --baseline validation report');assert(candidate.length||draft,'Supply --candidate validation report');
 const referenceFiles=many('--reference').length?many('--reference'):['docs/current-engine-reality-sources-2026-10-02.json','docs/system-external-reference-2022.json','tests/fixtures/race-validation-reference-2020-v11.json'],
  refs=loadReferences(referenceFiles);validateReferences([...baseline,...candidate,...pairedFixed],refs.proofs);
 assert.equal(refs.races.length,30,'The v11 reference protocol contains all30 official events');
 const oldRows=combine(baseline),newRows=combine(candidate),fixedRows=combine(pairedFixed),newEvents=groupEvents(newRows,refs.races),
  expected=one('--expected-engine-sha',null),missing=[],sourceHashes=[...new Set(candidate.map(r=>r.sourceHash))],parameterHashes=[...new Set(candidate.map(r=>sha(JSON.stringify(r.parameters))))];
 if(!expected)missing.push('最终生产源码SHA');if(candidate.some(r=>r.sourceHash!==expected))missing.push('候选源码与最终SHA一致');
 if(expected&&productionHash!==expected)missing.push('磁盘生产源码与最终SHA一致');
 if(sourceHashes.length!==1)missing.push('所有最终臂同一源码');if(parameterHashes.length!==1)missing.push('所有最终臂同一参数覆写');
 if(candidate.some(r=>!r.complete))missing.push('全部最终输入的声明任务闭合');if(candidate.some(r=>!r.sourceProof||!r.driverProof))missing.push('全部最终源码/driver归档证明');
 if(candidate.some(r=>r.cohort!=='selected'&&['external','reserved2020','calibration','internal','final'].includes(r.scope)))missing.push('官方最终臂为selected条件阵容');
 const declared=candidate.flatMap(r=>r.declaredJobs),declaredKeys=declared.map(j=>sha(JSON.stringify(j)));assert.equal(new Set(declaredKeys).size,declaredKeys.length,'Overlapping final declarations');
 for(const real of refs.races){const jobs=declared.filter(j=>j.kind==='race'&&j.id===real.id);
  if(jobs.length!==officialReplicates)missing.push('事件'+real.id+'完整'+officialReplicates+'-seed声明');
  else if(JSON.stringify(jobs.map(j=>j.replicate).sort())!==JSON.stringify(Array.from({length:officialReplicates},(_,i)=>i)))missing.push('事件'+real.id+'预声明种子序号0至'+(officialReplicates-1));
 }
 if(declared.filter(j=>j.kind==='start').length!==108)missing.push('108次受控起步声明');if(declared.filter(j=>j.kind==='forecast').length!==18)missing.push('18次单马预测全程声明');
 const controlTuples=declared.filter(j=>j.kind==='start').map(j=>JSON.stringify([j.length,j.n,j.level,j.intent,j.command])),expectedControls=[];
 for(const length of [1200,2400,3200])for(const n of [1,8,16])for(const level of [70,86])for(const intent of [.1,.5,.9])for(const command of ['maximum','natural'])expectedControls.push(JSON.stringify([length,n,level,intent,command]));
 if(JSON.stringify([...controlTuples].sort())!==JSON.stringify(expectedControls.sort()))missing.push('起步矩阵全部预声明组合');
 const forecastTuples=declared.filter(j=>j.kind==='forecast').map(j=>JSON.stringify([j.length,j.from,j.request])),expectedForecasts=[];
 for(const length of [1200,2400,3200])for(const from of [0,600])for(const request of [14.5,16.5,30])expectedForecasts.push(JSON.stringify([length,from,request]));
 if(JSON.stringify([...forecastTuples].sort())!==JSON.stringify(expectedForecasts.sort()))missing.push('预测矩阵全部预声明组合');
 const effective=[...new Set(newRows.map(r=>r.effectiveParametersHash).filter(Boolean))];if(effective.length!==1)missing.push('所有样本同一完整实际RACE_F参数');
 if(newRows.some(r=>r.effectiveParametersHash!==sha(JSON.stringify(productionParameters))))missing.push('实际测量参数等于生产RACE_F');
 if(normalized(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'))!==productionHash)missing.push('读取期间生产源码保持冻结');
 const regressions=many('--regression').map(file=>({...readJson(file),file:rel(file)})),
  regressionAudit=auditRegressions(regressions,expected,{strictSource:!draft,expectedPageHash:normalized(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'))});
 missing.push(...regressionAudit.missing);
 if(!draft)assert.equal(missing.length,0,'Final report is not ready; run with --draft or complete: '+missing.join('; '));
 const matchedOldRows=matchOldOfficialRows(oldRows,declared),
  oldEvents=groupEvents(matchedOldRows,refs.races),oldAllSeedEvents=groupEvents(oldRows,refs.races);
 const calibrationGrids=calibrations(many('--calibration'),refs);if(!draft)assert(calibrationGrids.every(g=>g.closed),'Formal report cannot include an actively writing calibration grid');
 const engineering=engineeringSummary(candidate),inputMeta=r=>({...r,rows:undefined,declaredJobs:undefined,errors:undefined}),
  outputSummary=one('--summary','docs/system-report-v11-summary.json'),out=one('--out','docs/比赛系统重构与联合校准-v11.md'),
  summary={generatedAt:new Date().toISOString(),draft,status:summaryStatus(draft,engineering.passed,regressionAudit.passed),expectedEngineHash:expected,productionHash,productionRaceParameters:productionParameters,
   sourceHashes,parameterOverrides:candidate.map(r=>({file:r.file,parameters:r.parameters})),effectiveRaceParameters:newRows.find(r=>r.effectiveRaceParameters)?.effectiveRaceParameters||null,
   parameterChanges:Object.entries(newRows.find(r=>r.effectiveRaceParameters)?.effectiveRaceParameters||{}).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(oldRows.find(r=>r.effectiveRaceParameters)?.effectiveRaceParameters[k])).map(([key,value])=>({key,old:oldRows.find(r=>r.effectiveRaceParameters)?.effectiveRaceParameters[key],new:value})),
   plan:{officialReplicates,originalOfficialEvents:30,originalOfficialReplicates:3,originalOfficialFullRaces:90,revisedOfficialFullRaces:30*officialReplicates,
    soloForecastFullCourses:18,startTo600:108,completeFullCourses:30*officialReplicates+18,
    rationale:'Full distance/year event coverage retained; fixed declared seed(s), no cherry-picking. 2400m cost witness 469.858s thread CPU /1129.5s wall. Repeated synthetic seeds add no independent real events; single-seed candidate cannot establish population win-rate stability.',
    oldMainTableMatchedSeedRows:matchedOldRows.length,oldAllSeedBackgroundRows:oldRows.filter(r=>r.kind==='race').length},
   grouping:'Seed median within each real event, then event distributions. Main old arm restricted to matching declared event/seed/conditions; all old 3-seed rows separately retained as stability background. Shared distance seeds correlate across years.',
   inputs:{baseline:baseline.map(inputMeta),candidate:candidate.map(inputMeta),pairedFixed:pairedFixed.map(inputMeta)},realReferences:refs.proofs,realEvents:refs.races,
   counts:{baseline:counts(baseline),candidate:counts(candidate),pairedFixed:counts(pairedFixed)},
   finalRequirements:{satisfied:missing.length===0,missing},engineering,regressionsPassed:regressionAudit.passed,regressionAudit,gateFailures:gateFailures(newEvents),
   partitions:comparison(refs.races,oldEvents,newEvents),baselineAllSeedPartitions:comparison(refs.races,oldAllSeedEvents,oldAllSeedEvents),eventMeasurements:{old:oldEvents,oldAllSeeds:oldAllSeedEvents,new:newEvents},styles:styles(newRows),
   supplemental:{candidateSpeedEvents:newEvents.map(e=>({id:e.id,length:e.length,...e.supplemental})),speedLimits:'Real references have no individual GPS peak speed. Champion distance/time is average route speed; simulated physical-speed measures are supplemental diagnostics, not independently verified real peak speed.'},
   fixedInputContrast:{samples:fixedRows.length,identicalInputMatches:fixedRows.filter(r=>oldRows.some(o=>o.id===r.id&&o.seed===r.seed&&o.replicate===r.replicate&&o.inputHash===r.inputHash)).length,
    explanation:'Only matching serialized entrant input isolates engine mechanics. Selected-versus-fixed arm is a joint cohort/engine effect.'},
   calibrations:calibrationGrids,calibrationAttribution:calibrationAttribution(calibrationGrids),durationPowerWitnesses:durationPowerWitnesses(calibrationGrids),
   development:development(many('--development')),selectionEvidence:selectionEvidence(many('--selection')),regressions,outputSummary:rel(outputSummary)};
 fs.mkdirSync(path.dirname(path.resolve(ROOT,outputSummary)),{recursive:true});fs.writeFileSync(path.resolve(ROOT,outputSummary),JSON.stringify(summary,null,2)+'\n');
 fs.mkdirSync(path.dirname(path.resolve(ROOT,out)),{recursive:true});fs.writeFileSync(path.resolve(ROOT,out),markdown(summary));
 console.log(JSON.stringify({report:rel(out),summary:rel(outputSummary),status:summary.status,finalRequirements:summary.finalRequirements,counts:summary.counts,regressionsPassed:summary.regressionsPassed,retainedRegressionFailures:regressionAudit.failures.length,retainedEngineeringFailures:engineering.failures.length,retainedErrors:engineering.errors.length}));
 return summary;
}
module.exports={quantile,distribution,literalRaceParameters,loadValidation,loadReferences,groupEvents,comparison,engineeringSummary,styles,matchOldOfficialRows,development,calibrations,calibrationAttribution,durationPowerWitnesses,summaryStatus,main};
if(require.main===module)try{main(process.argv.slice(2));}catch(error){console.error(error.stack);process.exitCode=1;}
