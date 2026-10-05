#!/usr/bin/env node
'use strict';
// Small hand-calculated grouping and omission guards for the report reducer.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const R=require('./report-system-v11'),root=path.resolve(__dirname,'..');
const realMetric={winnerTime:10,winnerFinal600:3,first200:2,first400:4,first600:6,remainingSpeed:10,tailSeconds:2,within1:.5,within2:1,final600Span:1,post200Cv:.05,last200Difference:0},
 refs=[{id:'a',date:'2023-01-01',length:1200,partition:'calibration',metrics:realMetric},{id:'b',date:'2024-01-01',length:1200,partition:'calibration',metrics:realMetric}];
function row(id,t,seed){return {kind:'race',id,length:1200,n:2,seed,replicate:seed,completed:true,finished:true,engineering:{passed:true},
 ...realMetric,winnerTime:t,inputHash:id+'-'+seed,horses:[{id:'1',place:1,observedStyle:'逃'},{id:'2',place:2,observedStyle:'追'}],powerProfiles:[]};}
const rows=[row('a',5,1),row('a',5,2),row('a',100,3),row('b',20,1),row('b',20,2),row('b',500,3)],events=R.groupEvents(rows,refs),p=R.comparison(refs,events,events)[0];
assert.equal(events[0].metrics.winnerTime.value,5);assert.equal(events[1].metrics.winnerTime.value,20);
assert.equal(p.commonOldNewTable.winnerTime.new.median,12.5);assert.equal(p.commonOldNewTable.winnerTime.newError.median,2.5);
assert.equal(p.commonOldNewTable.last200Difference.newAbsoluteRelativeError.n,0);assert.equal(p.commonOldNewTable.last200Difference.newAbsoluteRelativeError.missing,2);
console.log('PASS Seed medians precede event medians; a zero real target yields unavailable relative error');
const failed={...row('a',0,4),completed:false,finished:false,engineering:{passed:false,failedChecks:['completed']}},failedGroup=R.groupEvents([...rows,failed],refs)[0];
assert.equal(failedGroup.measuredSeeds,4);assert.equal(failedGroup.completedSeeds,3);assert.equal(failedGroup.metrics.winnerTime.value,5);
const audit=R.engineeringSummary([{file:'fixture',complete:true,errors:[{jobKey:'exception',error:'retained'}],missingJobKeys:['not-run'],rows:[failed]}]);
assert.equal(audit.passed,false);assert.equal(audit.failures.length,1);assert.equal(audit.errors.length,1);assert.equal(audit.missingJobs.length,1);
console.log('PASS Incomplete measurements stay counted and failures/exceptions/missing jobs remain explicit');
const styles=R.styles(rows)[0];assert.equal(styles.races,6);assert.equal(styles.categories[0].starts,6);assert.equal(styles.categories[0].wins,6);assert.equal(styles.categories[0].winPerStart,1);assert.equal(styles.categories[1].winPerStart,null);
console.log('PASS Observed-style win rate uses per-style starts and preserves absent-category missing values');
const source=fs.readFileSync(path.join(root,'sim.js'),'utf8'),literal=R.literalRaceParameters(source);assert(literal.maxAccel>0&&literal.baseSpeed.a>0);
console.log('PASS Production constants are parsed as data without compiling the engine');
const oldSeeds=[row('a',9,0),row('a',10,1),row('a',11,2)],declared=[{...oldSeeds[0],kind:'race'}],matched=R.matchOldOfficialRows(oldSeeds,declared);
assert.equal(matched.length,1);assert.equal(matched[0].replicate,0);assert.equal(matched[0].winnerTime,9);
assert.equal(R.matchOldOfficialRows(oldSeeds,[{...declared[0],n:3}]).length,0);
console.log('PASS Main comparison matches only declared seed0 and identical event/condition identity');
const attribution=R.calibrationAttribution([{file:'old-six',sourceHash:'old-controller',cohort:'fixed-v8',arms:Array(6).fill({}),measured:14},
 {file:'new-three',sourceHash:'new-controller',cohort:'fixed-v8',arms:Array(3).fill({}),measured:12}]);
assert.equal(attribution.crossControllerComparison,true);assert.equal(attribution.sourceGroups.length,2);
assert.deepEqual(attribution.sourceGroups.map(g=>[g.arms,g.measured]),[[6,14],[3,12]]);
assert.equal(R.calibrationAttribution([{file:'a',sourceHash:'same',cohort:'fixed-v8',arms:[],measured:0}]).crossControllerComparison,false);
console.log('PASS Six old and three new arms retain separate controller source groups');
const names=['fast80-nopeak','air2-fast80-nopeak-cost105','air2-fast80-nopeak-cost110'],sample={id:'a',length:1200,seed:0,raceSeed:10,replicate:0,inputHash:'same',winnerId:'h1'},
 mechanismGrid={file:'fixed',sourceHash:'controller',cohort:'fixed-v8',pairedMechanismRows:names.map((gridVariant,i)=>({...sample,gridVariant,winnerTime:65+i*.06,winnerReserve:.276-i*.08}))},
 witnesses=R.durationPowerWitnesses([mechanismGrid]);assert.equal(witnesses.length,1);assert(Math.abs(witnesses[0].timeDeltaLastMinusFirst-.12)<1e-10);
assert.equal(R.durationPowerWitnesses([{...mechanismGrid,pairedMechanismRows:mechanismGrid.pairedMechanismRows.map((r,i)=>({...r,inputHash:i===2?'different':r.inputHash}))}]).length,0);
console.log('PASS Duration-power hypotheses use same-source, identical-input and same-winner witnesses only');
const resumeFiles=['docs/calibration-mechanical-v11-missing-process-resume.json','docs/calibration-mechanical-v11-checkpoint-resume.json'],beforeRecords=resumeFiles.map(f=>fs.readFileSync(path.join(root,f),'utf8')),
 retained=R.development(resumeFiles);
assert.match(retained[0].payload.uncompletedAttemptProgress,/Unknown/);
assert.match(retained[1].payload.runningUncompletedAttempt.steppedProgress,/Unknown/);
for(let i=0;i<resumeFiles.length;i++)assert.deepEqual(retained[i].payload,JSON.parse(beforeRecords[i]));
assert.deepEqual(resumeFiles.map(f=>fs.readFileSync(path.join(root,f),'utf8')),beforeRecords);
console.log('PASS Small interruption records preserve unknown progress, timing and original payload without writes');
console.log(JSON.stringify({passed:8,completeRaceExecutions:0}));
