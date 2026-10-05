#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {HASH}=require('./system-reality-v9'),{compileSource}=require('./race-validation-v11');
const {applySequenceSafetyOverridePatch,restoreSequenceSafetyOverrideBaseline}=require('./fixtures/sequence-safety-override-v11'),{run}=require('./sequence-safety-override-v11');
const root=path.resolve(__dirname,'..'),filename=path.join(root,'sim.js'),source=fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n'),baseline=restoreSequenceSafetyOverrideBaseline(source),candidate=applySequenceSafetyOverridePatch(baseline);
assert.equal(applySequenceSafetyOverridePatch(candidate),candidate);if(source.includes('H.planning.fallbackReason=reason'))assert.equal(candidate,source);
const report={sourceHash:HASH(source),baselineHash:HASH(baseline),candidateHash:HASH(candidate),scriptHash:HASH(fs.readFileSync(__filename,'utf8')),builtAt:new Date().toISOString(),actualStepCalls:0,
 baselineScope:'Same current coefficients/version/physics with the former controller tail restored in memory, only for a fault comparison.',
 scope:'Synthetic follow forecast acceptance selects exact branch outcomes; visible geometry, real applyRiderSequence and real avoidBlock are exercised. This is instruction/commitment coherence, not physical candidate feasibility, prevalence or field numerical validation.',checks:[],failures:[]};
function check(name,fn){try{report.checks.push({name,pass:true,...fn()});}catch(e){report.failures.push(name);report.checks.push({name,pass:false,error:String(e.stack||e)});}}
check('The patch is idempotent, exactly reversible, and changes only runAI',()=>{assert.equal(applySequenceSafetyOverridePatch(candidate),candidate);assert.equal(restoreSequenceSafetyOverrideBaseline(candidate),baseline);const start=baseline.indexOf('    function runAI(H)'),end=baseline.indexOf('    function headwindAt(at)');const a=candidate.indexOf('    function runAI(H)'),b=candidate.indexOf('    function headwindAt(at)');assert.equal(candidate.slice(0,a),baseline.slice(0,start));assert.equal(candidate.slice(b),baseline.slice(end));return {};});
for(const [kind,mode,changed] of [['different-wake-front','route','laneChanged'],['speed-override','wait','speedChanged']])check('Actual '+changed+' cancels the unexecuted follow commitment',()=>{
 const before=run(baseline,kind,true,true),after=run(candidate,kind,true,true),a=after.afterDecision,b=before.afterDecision;
 assert.equal(b.sequence?.mode,'follow');assert.equal(b.followOpportunity.accepted,true);assert(b.avoidCalls>0);
 assert.equal(a.targetV,b.targetV);assert.equal(a.targetT,b.targetT);assert(a.avoidCalls>0,'Safety behavior still executes');
 assert.equal(a.sequence,null);assert.equal(a.followOpportunity.accepted,false);assert.equal(a.followOpportunity.rejectedReason,'safety-override');
 assert.equal(a.followRejectedReasons['safety-override'],1);assert.equal(a.safetyOverriddenSequences,1);assert.equal(a.committedSequences,0);
 assert.equal(a.planning.selectedCandidate,'follow');assert.equal(a.planning.selected,mode);assert.equal(a.strategy.mode,mode);assert.equal(a.strategy.selectedCandidate,'follow');
 assert.equal(a.planning.sequenceCommitted,false);assert.equal(a.planning.selectedScore,null);assert.equal(a.planning.safetyOverride[changed],true);
 assert.deepEqual(a.planning.actualControls,{targetV:a.targetV,targetT:a.targetT});assert.equal(a.strategy.targetV,a.targetV);assert.equal(a.strategy.targetT,a.targetT);
 assert.equal(after.afterApplyAgain.targetV,a.targetV);assert.equal(after.afterApplyAgain.targetT,a.targetT,'Cancelled sequence cannot restore an old instruction');
 return {before:b,after:a};
});
check('Repeated safe lane assignment with the same actual tuple keeps legal follow',()=>{
 const result=run(candidate,'same-lane-target',true,true),a=result.afterDecision;assert(a.avoidCalls>0);assert.equal(a.sequence?.mode,'follow');assert.equal(a.followOpportunity.accepted,true);assert.equal(a.followOpportunity.rejectedReason,null);assert.equal(a.targetV,a.sequence.actions[0].targetV);assert.equal(a.targetT,a.sequence.actions[0].targetT);assert.equal(a.committedSequences,1);assert.equal(a.safetyOverriddenSequences,0);assert.equal(a.planning.sequenceCommitted,true);assert.equal(a.strategy.mode,'follow');return {after:a};
});
check('A nonsequence settled candidate records its actual safety lane instruction',()=>{
 const before=run(baseline,'settle-lane-override',false,true).afterDecision,a=run(candidate,'settle-lane-override',false,true).afterDecision;
 assert.equal(before.planning.selected,'settle');assert(before.avoidCalls>0);assert.equal(a.targetV,before.targetV);assert.equal(a.targetT,before.targetT);
 assert.equal(a.sequence,null);assert.equal(a.planning.selectedCandidate,'settle');assert.equal(a.planning.selected,'route');assert.equal(a.strategy.mode,'route');assert.equal(a.strategy.selectedCandidate,'settle');
 assert.equal(a.safetyOverrides,1);assert.equal(a.safetyOverriddenSequences,0);assert.equal(a.committedSequences,0);assert.equal(a.attacking,false);return {before,after:a};
});
check('An attack overridden to wait cannot emit a false launch or sprint start',()=>{
 const before=run(baseline,'attack-speed-override',false,true).afterDecision,a=run(candidate,'attack-speed-override',false,true).afterDecision;
 assert.equal(before.planning.selected,'attack');assert.equal(before.attacking,true);assert.equal(before.launches,1);
 assert.equal(a.targetV,before.targetV);assert.equal(a.targetT,before.targetT);assert.equal(a.planning.selectedCandidate,'attack');assert.equal(a.planning.selected,'wait');assert.equal(a.strategy.mode,'wait');
 assert.equal(a.attacking,false);assert.equal(a.launches,0);assert.equal(a.sprintAt,null);assert.equal(a.events.filter(e=>String(e.text).includes('开始发力')).length,0);assert.equal(a.action,before.action,'Safety action must be preserved');return {before,after:a};
});
check('An unchanged attack tuple keeps its label and emits one real launch',()=>{
 const before=run(baseline,'attack-no-override',false,true).afterDecision,a=run(candidate,'attack-no-override',false,true).afterDecision;
 assert.equal(a.targetV,before.targetV);assert.equal(a.targetT,before.targetT);assert.equal(a.planning.selected,'attack');assert.equal(a.strategy.mode,'attack');assert.equal(a.attacking,true);assert.equal(a.launches,1);assert.equal(a.withdrawals,0);assert.equal(a.sprintAt,500);
 assert.equal(a.events.filter(e=>String(e.text).includes('开始发力')).length,1);assert.equal(a.safetyOverrides,0);assert.equal(a.action,before.action);return {after:a};
});
check('Attack persistence and genuine withdrawal each bookkeep only once',()=>{
 const held=run(candidate,'attack-already-attacking',false,true).afterDecision,withdrawn=run(candidate,'withdraw-no-override',false,true).afterDecision;
 assert.equal(held.attacking,true);assert.equal(held.launches,0);assert.equal(held.withdrawals,0);
 assert.equal(withdrawn.attacking,false);assert.equal(withdrawn.withdrawals,1);assert.equal(withdrawn.launches,0);assert.equal(withdrawn.safetyOverrides,0);
 assert.equal(withdrawn.events.filter(e=>String(e.text).includes('收力重新调整节奏')).length,1);return {held,withdrawn};
});
check('A no-viable-plan fallback keeps wait even when the actual tuple is unchanged',()=>{
 const before=run(baseline,'no-viable-unchanged',false,true).afterDecision,a=run(candidate,'no-viable-unchanged',false,true).afterDecision;
 assert.equal(before.planning.selected,'settle');assert.equal(before.strategy.mode,'wait');assert(a.avoidCalls>0);assert.equal(a.targetV,before.targetV);assert.equal(a.targetT,before.targetT);
 assert.equal(a.planning.selectedCandidate,'settle');assert.equal(a.planning.selected,'wait');assert.equal(a.strategy.mode,'wait');assert.equal(a.strategy.selectedCandidate,'settle');
 assert.equal(a.planning.fallbackReason,a.strategy.reason);assert.equal(a.strategy.fallbackReason,a.strategy.reason);assert.equal(a.planning.selectedScore,null);
 assert.equal(a.safetyOverrides,0);assert.equal(a.sequence,null);assert.equal(a.committedSequences,0);assert.equal(a.attacking,false);assert.equal(a.launches,0);return {before,after:a};
});
check('Default projected physical movement is unchanged by the controller patch',()=>{
 function forecast(code){const S=compileSource(code),h=S.makeHorse(()=>.5,{id:'default',level:70,physiology:S.neutralPhysiology(),surface:'草地','疲劳':0,'斗志':50,bodyMass:480,carriedWeight:57});for(const k of Object.keys(h.stats))h.stats[k]=70;const r=S.createRace([h],{length:1200,course:'标准',surface:'草地',state:'良',rng:()=>.5});return r.race.horses[0].projectActions([{duration:.2,targetV:15}],{maxDt:1/60,trace:true});}
 const a=forecast(baseline),b=forecast(candidate);assert.deepEqual(a,b);return {forecastQueries:2,exactHash:HASH(JSON.stringify(a))};
});
report.productionUnchanged=HASH(fs.readFileSync(filename,'utf8'))===report.sourceHash;report.pass=!report.failures.length&&report.productionUnchanged;
const out=path.join(root,'docs/sequence-safety-override-focused-v11.json');if(fs.existsSync(out)){const old=fs.readFileSync(out),history=path.join(root,'docs/sequence-safety-override-focused-v11-history');fs.mkdirSync(history,{recursive:true});fs.writeFileSync(path.join(history,HASH(old.toString())+'.json'),old);}
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');fs.writeFileSync(out+'.source.js.gz',zlib.gzipSync(source));fs.writeFileSync(out+'.candidate.js.gz',zlib.gzipSync(candidate));fs.writeFileSync(out+'.script.js.gz',zlib.gzipSync(fs.readFileSync(__filename)));
console.log(JSON.stringify({sourceHash:report.sourceHash,candidateHash:report.candidateHash,pass:report.pass,productionUnchanged:report.productionUnchanged,actualStepCalls:0,checks:report.checks.map(c=>({name:c.name,pass:c.pass,error:c.error}))},null,2));if(!report.pass)process.exitCode=1;
