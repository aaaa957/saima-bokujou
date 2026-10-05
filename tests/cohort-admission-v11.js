#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {api,HASH}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..'),clone=x=>structuredClone(x),race={length:2400,course:'東京芝A',surface:'草地',state:'良',dir:'左回',profile:'平坦'},
 entryOverrides={surface:'草地',special:'左右皆可','斗志':50,'疲劳':0,jockeyGrade:'优秀',bodyMass:480,carriedWeight:57};
function candidates(S){
 const pool=S.makeRaceCandidatePool(S.mulberry32(347),{n:32,level:89,tierKey:'g1',entryOverrides});
 const strong=S.makeHorse(S.mulberry32(100),{id:'open-superior',level:97,...entryOverrides,physiology:S.neutralPhysiology(),
   behavior:{forwardness:.5,settle:.5,tractability:.65}});
 return {pool,strong};
}
function strongerCandidateMatch(S){
 const {pool,strong}=candidates(S),all=[...pool,strong],before=clone(all),forecast=S.raceEntryForecast(strong,race),
   selected=S.selectRaceCohort(all,()=>.999999,{n:8,tierKey:'g1',race,entryOverrides}),d=selected.diagnostics;
 assert(forecast.feasible&&forecast.seconds<d.predictionWindow.fastSeconds-1e-7);
 assert.equal(d.fastIsNotAdmissionCeiling,true);assert.match(d.eligibilityScope,/Caller filters/);
 const entry=d.entries.find(e=>e.id===strong.id);assert(entry?.eligible,'A legitimate faster candidate must keep matching support');
 assert.equal(d.fallback,0);assert.deepEqual(all,before);assert.equal(selected.horses.find(h=>h.id===strong.id),strong);
 // The candidate is the final member of the matching set. A nonzero interval of
 // the uniform random draw selects it first; no performance-based priority exists.
 const firstDrawSupport={from:(d.eligible-1)/d.eligible,to:1,probability:1/d.eligible};assert(firstDrawSupport.probability>0);
 const equalChoice=S.selectRaceCohort(all,()=>0,{n:1,tierKey:'g1',race,entryOverrides});
 assert.notEqual(equalChoice.horses[0].id,strong.id,'The faster horse must not become an artificial designated champion');
 // When a shortage actually occurs, slow unmatched horses cannot displace the
 // admissible faster entrant. Its distance from the slow boundary is zero.
 const weak=S.makeHorse(()=>.5,{id:'slow-fallback',level:35,...entryOverrides,physiology:S.neutralPhysiology()}),
   shortage=S.selectRaceCohort([weak,strong],()=>0,{n:2,tierKey:'g1',race,entryOverrides});
 assert.equal(shortage.horses[0].id,strong.id);assert.equal(shortage.diagnostics.entries[0].eligible,true);
 assert.equal(shortage.diagnostics.fallback,1);
 return {race,inputHash:HASH(JSON.stringify(before)),inputPool:before,forecast,diagnostics:d,
   firstDrawSupport,uniformZeroDraw:equalChoice.horses[0].id,shortage:shortage.diagnostics};
}
function persistentStrongRosterEntry(S){
 const {pool,strong}=candidates(S);
 const roster=pool.map(h=>Object.assign(h,{age:4,wins:5,starts:12,ability:89,lastRaceWeek:0,retired:false}));
 Object.assign(strong,{id:'legacy-superior',age:4,wins:6,starts:12,ability:97,lastRaceWeek:0,retired:false});
 for(const key of Object.keys(strong.stats))strong.stats[key]=97;
 delete strong.physiology;
 const legacy=JSON.parse(JSON.stringify(strong)),coreBefore={stats:clone(legacy.stats),behavior:clone(legacy.behavior),age:legacy.age,wins:legacy.wins};
 const barred=[{id:'too-young',age:2},{id:'resting',lastRaceWeek:19},{id:'not-open-qualified',wins:3}]
   .map(change=>({...clone(legacy),...change}));roster.push(legacy,...barred);
 const options={n:8,ageMin:3,ageMax:5,winsMin:4,winsMax:99,abilityMin:78,cooldown:2,tierKey:'g1',race},
   selected=S.pickRosterField(roster,()=>.999999,20,options),d=selected.cohort,entry=d.entries.find(e=>e.id===legacy.id);
 assert(selected.includes(legacy),'A saved elite horse that passes caller filters must be able to enter G1');
 assert(entry?.eligible);assert(entry.forecast.seconds<d.predictionWindow.fastSeconds-1e-7);
 assert(barred.every(h=>!selected.includes(h)));assert.equal(d.candidates,33);
 assert.deepEqual({stats:legacy.stats,behavior:legacy.behavior,age:legacy.age,wins:legacy.wins},coreBefore);
 const migrated=clone(legacy),reloaded=JSON.parse(JSON.stringify(roster));
 S.pickRosterField(reloaded,()=>.999999,20,options);
 assert.deepEqual(reloaded.find(h=>h.id===legacy.id),migrated,'Legacy physiology migration persists across reload without reroll');
 return {race,coreBefore,legacyAfter:legacy,diagnostics:d,barredIds:barred.map(h=>h.id),
   roundtripStable:true,inputHash:HASH(JSON.stringify(roster))};
}
function maidenZeroWinQualification(S){
 const common={level:70,...entryOverrides,physiology:S.neutralPhysiology()},
   maiden=Object.assign(S.makeHorse(()=>.5,{...common,id:'maiden-zero'}),{age:3,wins:0,starts:1,ability:70,lastRaceWeek:0,retired:false}),
   winner=Object.assign(S.makeHorse(()=>.5,{...common,id:'already-won'}),{age:3,wins:1,starts:2,ability:70,lastRaceWeek:0,retired:false}),
   roster=[maiden,winner],before=clone(roster),opts={n:8,ageMin:2,ageMax:3,winsMax:0,abilityMin:0,cooldown:2,tierKey:'maiden',race:{...race,length:1600}},
   selected=S.pickRosterField(roster,()=>.5,20,opts);
 assert.deepEqual(selected.map(h=>h.id),[maiden.id]);assert.equal(selected.cohort.candidates,1);
 assert.deepEqual(roster,before);
 const defaultMax=S.pickRosterField(roster,()=>.5,20,{...opts,winsMax:undefined});
 assert.equal(defaultMax.length,2,'Omitted wins maximum must retain its historical default');
 return {zeroMaximumSelected:selected.map(h=>h.id),zeroMaximumDiagnostics:selected.cohort,
   omittedMaximumSelected:defaultMax.map(h=>h.id),rosterUnchanged:true};
}
module.exports={strongerCandidateMatch,persistentStrongRosterEntry,maidenZeroWinQualification};
if(require.main===module){
 const original=fs.readFileSync(path.join(root,'sim.js'),'utf8'),source=require('./fixtures/race-cohort-admission-v11').applyAdmissionPatch(original),S=api(source),cases=[];
 for(const [name,fn]of Object.entries(module.exports)){
  try{const result=fn(S);cases.push({name,passed:true,result});console.log('PASS '+name);}
  catch(error){cases.push({name,passed:false,error:error.stack});console.error(error.stack);}
 }
 const report={generatedAt:new Date().toISOString(),productionInputHash:HASH(original),testedSourceHash:HASH(source),
   inMemoryPatch:source!==original,productionSourceUnchanged:HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===HASH(original),
   scope:'Three focused stronger-tail matching, persistent-roster and zero-win qualification checks; zero actual race steps.',cases,
   passed:cases.filter(c=>c.passed).length,failed:cases.filter(c=>!c.passed).length};
 fs.writeFileSync(path.join(root,'docs/cohort-admission-v11.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,failed:report.failed,testedSourceHash:report.testedSourceHash,productionSourceUnchanged:report.productionSourceUnchanged}));
 if(report.failed)process.exitCode=1;
}
