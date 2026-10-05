#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {api,HASH}=require('./system-reality-v9'),root=path.resolve(__dirname,'..'),clone=x=>structuredClone(x);
const original=fs.readFileSync(path.join(root,'sim.js'),'utf8'),initialHash=HASH(original),
 source=process.argv.includes('--fixture')?require('./fixtures/race-cohort-player-entry-v11').applyPlayerEntryPatch(original):original,
 S=api(source),cases=[];
function horse(id,{level=80,wins=0,starts=1,ability=level,age=3,lastRaceWeek=0}={}){
 const h=S.makeHorse(()=>.5,{id,level,surface:'草地',special:'左右皆可','斗志':50,'疲劳':0,
   physiology:S.neutralPhysiology(),behavior:{forwardness:.6,settle:.5,tractability:.65}});
 return Object.assign(h,{age,wins,starts,ability,lastRaceWeek,retired:false});
}
function test(name,fn){try{cases.push({name,passed:true,result:fn()});console.log('PASS '+name);}catch(error){cases.push({name,passed:false,error:error.stack});console.error('FAIL '+name+' '+error.message);}}
function options(h,roster){return S.raceOptionsForRoster(h,()=>.999999,roster,20);}
test('Newcomer sporting qualification accepts a gifted unstarted horse and excludes started/winning peers',()=>{
 const player=horse('player-new',{starts:0}),gifted=horse('gifted-new',{level:97,starts:0}),
   started=horse('started-new',{starts:1}),won=horse('won-new',{wins:1,starts:1}),
   resting=horse('resting-new',{starts:0,lastRaceWeek:20}),roster=[player,gifted,started,won,resting],before=clone(roster),
   result=options(player,roster)[0];
 assert.equal(result.key,'newcomer');assert.deepEqual(result.field.filter(h=>!h.player).map(h=>h.id),[gifted.id]);
 assert.equal(new Set(result.field.map(h=>h.id)).size,result.field.length);assert.deepEqual(roster,before);
 return {key:result.key,ids:result.field.map(h=>h.id),rosterUnchanged:true};
});
test('Maiden and one/two/three-win races enforce exact wins before physical readiness matching',()=>{
 const results=[];
 for(let wins=0;wins<=3;wins++){
   const key=wins===0?'maiden':'cond'+wins,player=horse('player-'+key,{level:50,wins,starts:10}),
     eligible=horse('eligible-'+key,{level:50,wins,starts:10}),
     wrong=horse('wrong-'+key,{level:50,wins:wins===0?1:0,starts:10}),roster=[clone(player),eligible,wrong],before=clone(roster),
     result=options(player,roster)[0];
   assert.equal(result.key,key);assert.deepEqual(result.field.filter(h=>!h.player).map(h=>h.id),[eligible.id]);
   assert.equal(new Set(result.field.map(h=>h.id)).size,result.field.length);assert.deepEqual(roster,before);
   results.push({key,ids:result.field.map(h=>h.id),wins:result.field.map(h=>h.form['胜利'])});
 }
 return results;
});
test('Public graded/open player entry accepts a superior saved horse above the former ability ceiling',()=>{
 const player=horse('player-open',{wins:6,starts:12}),strong=horse('superior-110',{level:97,ability:110,wins:6,starts:12}),
   weaklyQualified=horse('only-two-wins',{level:97,wins:2,starts:12}),tooYoung=horse('too-young',{age:2,wins:6}),
   resting=horse('resting-open',{wins:6,lastRaceWeek:20}),roster=[clone(player),strong,weaklyQualified,tooYoung,resting],before=clone(roster),
   results=options(player,roster);
 assert.deepEqual(results.map(x=>x.key),['open','g3','g2','g1']);
 for(const r of results){const opponents=r.field.filter(h=>!h.player),ids=opponents.map(h=>h.id);
   assert(ids.includes(strong.id),r.key+' must retain the strong saved entrant');
   assert.equal(ids.includes(weaklyQualified.id),r.key==='g3',r.key+' wins qualification');
   assert(!ids.includes(player.id)&&!ids.includes(tooYoung.id)&&!ids.includes(resting.id));
   assert.equal(new Set(r.field.map(h=>h.id)).size,r.field.length);
   const e=opponents.find(h=>h.id===strong.id);assert.deepEqual(e.stats,strong.stats);assert.deepEqual(e.physiology,strong.physiology);assert.deepEqual(e.behavior,strong.behavior);
 }
 assert.deepEqual(roster,before);
 return {inputAbility:strong.ability,results:results.map(r=>({key:r.key,ids:r.field.map(h=>h.id)})),rosterUnchanged:true};
});
test('Multiple aliases of the player are excluded while duplicate rival ids fail clearly without rerolling traits',()=>{
 const player=horse('same-player',{level:50,wins:0}),rival=horse('duplicate-rival',{level:50,wins:0}),roster=[player,clone(player),rival,clone(rival)],before=clone(roster);
 assert.throws(()=>options(player,roster),/候选身份重复或缺失/);assert.deepEqual(roster,before);
 const unique=options(player,[player,clone(player),rival])[0];
 assert.deepEqual(unique.field.map(h=>h.id).sort(),[player.id,rival.id].sort());
 return {duplicateRivalRejected:true,uniqueIds:unique.field.map(h=>h.id),rosterUnchanged:true};
});
test('Explicit zero ability maximum is respected independently of zero-win qualification',()=>{
 const zero=horse('zero-ability',{ability:0}),positive=horse('positive-ability',{ability:1}),roster=[zero,positive],before=clone(roster),
   result=S.pickRosterField(roster,()=>.5,20,{abilityMax:0,winsMax:0,n:8,race:{length:1600,surface:'草地',course:'标准'}});
 assert.deepEqual(result.map(h=>h.id),[zero.id]);assert.deepEqual(roster,before);
 return {ids:result.map(h=>h.id),rosterUnchanged:true};
});
test('Qualified-roster scarcity reports the original request and never fabricates ineligible fillers',()=>{
 const qualified=horse('scarce-qualified',{wins:0}),ineligible=horse('scarce-winner',{wins:1}),roster=[qualified,ineligible],before=clone(roster),
   result=S.pickRosterField(roster,()=>.5,20,{winsMax:0,n:8,race:{length:1600,surface:'草地',course:'标准'}});
 assert.deepEqual(result.map(h=>h.id),[qualified.id]);assert.equal(result.cohort.requested,8);assert.equal(result.cohort.candidates,1);
 assert.equal(result.cohort.selected,1);assert.equal(result.cohort.shortage,7);assert.deepEqual(roster,before);
 return {ids:result.map(h=>h.id),diagnostics:result.cohort,rosterUnchanged:true};
});
const report={generatedAt:new Date().toISOString(),productionInputHash:initialHash,testedSourceHash:HASH(source),testSourceHash:HASH(fs.readFileSync(__filename,'utf8')),
 inMemoryPatch:source!==original,productionSourceUnchanged:HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===initialHash,
 scope:'Six focused public player entry qualification/identity checks. No actual race steps and no race-fit claim.',cases,
 passed:cases.filter(x=>x.passed).length,failed:cases.filter(x=>!x.passed).length};
const dir=path.join(root,'docs/cohort-player-entry-v11-history');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,report.testedSourceHash+'-'+(report.inMemoryPatch?'fixture':'production')+'-'+report.generatedAt.replace(/[:.]/g,'-')+'.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(root,'docs/cohort-player-entry-v11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,testedSourceHash:report.testedSourceHash,productionSourceUnchanged:report.productionSourceUnchanged}));
if(report.failed||!report.productionSourceUnchanged)process.exitCode=1;
