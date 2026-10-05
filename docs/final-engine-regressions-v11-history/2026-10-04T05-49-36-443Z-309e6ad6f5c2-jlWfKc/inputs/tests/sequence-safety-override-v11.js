#!/usr/bin/env node
'use strict';
// Advisory branch witness: real controller and visible geometry; only follow
// forecast acceptance/utility is stubbed to select the candidate deliberately.
// No actual race steps, production writes or field-calibration claims.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {HASH}=require('./system-reality-v9'),{compileSource}=require('./race-validation-v11');
const root=path.resolve(__dirname,'..'),filename=path.join(root,'sim.js'),source=fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n');
const hook='      H.projectActions=(actions,options={})=>projectActions(H,actions,options);';
assert.equal(source.split(hook).length-1,1);
function api(code){
 const avoid='    function avoidBlock(H,gap=findGap(H,true)) {';
 assert.equal(code.split(avoid).length-1,1);
 const privateSource=code.replace(hook,hook+'\n      H.__runAI=()=>runAI(H);H.__applyRiderSequence=()=>applyRiderSequence(H);H.__planned=()=>budgetSpeed(H,H.stamina*.975,0);')
  .replace(avoid,avoid+'\n      H.__avoidCalls=(H.__avoidCalls||0)+1;H.__avoidGap=gap?{...gap}:null;')
  .replace('const attackPlan=finishPlan(H,H.maxV,0,{reserve:reserveEstimate});','const attackPlan=H.__attackPlan??finishPlan(H,H.maxV,0,{reserve:reserveEstimate});')
  .replace('const openGap=findGap(H,true);','const openGap=H.__forcedGap??findGap(H,true);');
 return {S:compileSource(privateSource),privateSourceHash:HASH(privateSource)};
}
function horse(S,id){const h=S.makeHorse(()=>.5,{id,name:id,level:70,surface:'草地',special:'左右皆可',jockeyGrade:'优秀',physiology:S.neutralPhysiology(),behavior:{forwardness:.5,settle:.6,tractability:.65},racePlan:{position:.5,risk:.5,patience:.6},'疲劳':0,'斗志':50,bodyMass:480,carriedWeight:57});for(const k of Object.keys(h.stats))h.stats[k]=70;return h;}
function run(code,kind='different-wake-front',stub=true,direct=false){
 const {S,privateSourceHash}=api(code),r=S.createRace(['own','wake','front'].map(id=>horse(S,id)),{length:2400,course:'标准',surface:'草地',state:'良',profile:'平坦',rng:()=>.5}),[H,W,F]=r.race.horses;
 r.step=()=>{throw Error('Actual steps prohibited in this branch review');};r.race.t=30;
 for(const x of [H,W,F]){Object.assign(x,{s:500,t:4,targetT:4,v:17,prevV:17,accel:0,lateralV:0,startDelay:0,startSettled:true,lastObserve:0,laneIntentT:0});x.stamina=x.staminaMax;x.guts=x.gutsMax;x.aerobicOutput=x.aerobic;}
 H.v=H.prevV=14;H.aerobicOutput=H.aerobic*.5;
 const planned=H.__planned();Object.assign(W,{s:504,t:5.4,targetT:5.4,v:planned-.2});Object.assign(F,{s:507,v:14});
 if(kind==='same-lane-target')H.__forcedGap={t:W.t,pace:planned,score:planned};
 if(kind==='speed-override'){
  W.s=503.5;F.s=504.5;F.v=Math.min(planned,W.v+.04)-1;
  H.__forcedGap={t:H.t,pace:planned,score:planned};
 }
 if(kind==='settle-lane-override')H.plan.patience=0;
 if(kind.startsWith('attack-')){
  H.plan.patience=0;H.__attackPlan={feasible:true,seconds:0};
  H.__forcedGap={t:H.t,pace:planned,score:planned};
  if(kind!=='attack-speed-override')F.v=H.maxV+.5;
  if(kind==='attack-already-attacking')H.attacking=true;
 }
 if(kind==='withdraw-no-override'){
  H.plan.patience=0;H.attacking=true;H.__attackPlan={feasible:false,seconds:null};
  F.v=H.maxV+.5;H.laneIntentT=1;H.__forcedGap={t:H.t,pace:planned,score:planned};
 }
 if(kind==='no-viable-unchanged'){
  H.plan.patience=0;H.__attackPlan={feasible:true,seconds:0};
  W.s=550;F.s=560;F.t=F.targetT=9;H.__forcedGap={t:H.t,pace:planned,score:planned};
 }
 const actual=H.projectActions,calls=[];let baseline=null,reference=null;
 H.projectActions=(actions,options)=>{
  const duration=actions.reduce((sum,a)=>sum+a.duration,0);
  const f=direct?{complete:true,finished:false,energyFeasible:true,goalReached:true,pathConflict:false,
   endpoint:{s:H.s+planned*duration,t:actions.at(-1).targetT,v:planned,stamina:H.stamina,guts:H.guts,retention:H.retention,aerobicOutput:H.aerobicOutput},
   seconds:duration,ledgerSeconds:duration,ledger:{energyUsed:100,recovered:0},targetShortfall:0,steps:Math.ceil(duration/options.maxDt),
   trace:actions.map((a,i)=>{const elapsed=actions.slice(0,i+1).reduce((sum,x)=>sum+x.duration,0);return {time:r.race.t+elapsed,s:H.s+planned*elapsed};}),
   observedLeaderEndpoints:[W,F].map(x=>({id:x.id,s:x.s+x.v*duration,t:x.t,v:x.v,finished:false}))}:actual(actions,options),goal=actions.some(a=>a.goal),fine=options.maxDt===1/60;
  if(direct&&kind==='settle-lane-override'&&(actions[0].targetT!==H.t||actions[0].targetV!==planned))f.endpoint.s-=100;
  if(direct&&kind.startsWith('attack-')&&actions[0].targetV===H.maxV)f.endpoint.s+=100;
  if(direct&&kind==='no-viable-unchanged')f.pathConflict=true;
  const natural={complete:f.complete,energyFeasible:f.energyFeasible,goalReached:f.goalReached,pathConflict:f.pathConflict,endpoint:{...f.endpoint},netEnergy:f.ledger.energyUsed-f.ledger.recovered};
  if(!baseline&&!goal)baseline=f;if(fine&&!goal)reference=f;
  if(stub&&goal){Object.assign(f,{complete:true,finished:false,energyFeasible:true,goalReached:true,pathConflict:false});f.ledger.energyUsed=0;f.ledger.recovered=0;f.endpoint.s=(fine?reference:baseline).endpoint.s+100;}
  calls.push({actions:structuredClone(actions),maxDt:options.maxDt,goal,fine,natural,stubbed:stub&&goal});return f;
 };
 H.__runAI();
 const snapshot=()=>({targetV:H.targetV,targetT:H.targetT,planning:structuredClone(H.planning),strategy:structuredClone(H.strategy),
  sequence:H.riderSequence?structuredClone(H.riderSequence):null,followOpportunity:H.followOpportunity?structuredClone(H.followOpportunity):null,
  avoidCalls:H.__avoidCalls||0,avoidGap:H.__avoidGap??null,committedSequences:H.statsSummary.committedSequences||0,
  safetyOverriddenSequences:H.statsSummary.safetyOverriddenSequences||0,safetyOverrides:H.statsSummary.safetyOverrides||0,
  followRejectedReasons:H.statsSummary.followRejectedReasons||null,attacking:H.attacking,
  launches:H.statsSummary.launches||0,withdrawals:H.statsSummary.withdrawals||0,sprintAt:H.sprintAt,action:H.action,events:structuredClone(r.race.events)});
 const afterDecision=snapshot();H.__applyRiderSequence();const afterApplyAgain=snapshot();
 return {kind,stub,direct,privateSourceHash,planned,input:{own:{s:H.s,t:H.t,v:H.v},wake:{s:W.s,t:W.t,v:W.v},front:{s:F.s,t:F.t,v:F.v}},calls,afterDecision,afterApplyAgain};
}
function main(){const report={sourceHash:HASH(source),scriptHash:HASH(fs.readFileSync(__filename,'utf8')),builtAt:new Date().toISOString(),actualStepCalls:0,
 scope:'Branch reachability and command/sequence coherence. Stubbed accepted follow projections are not physically certified candidate evidence or natural-event frequency. Actual controller geometry and avoidBlock execution are unchanged; raw real forecasts retained.',rows:[]};
for(const kind of ['different-wake-front','same-lane-target','speed-override']){
 const result=run(source,kind),a=result.afterDecision;
 result.selectionWitness=a.sequence?.mode==='follow'&&a.followOpportunity?.accepted===true;
 result.commandMatchesFirstAction=result.selectionWitness?a.targetV===a.sequence.actions[0].targetV&&a.targetT===a.sequence.actions[0].targetT:null;
 result.reapplyRepairsLane=result.selectionWitness?result.afterApplyAgain.targetT===a.sequence.actions[0].targetT:null;
 report.rows.push(result);
}
report.rows.push(run(source,'different-wake-front',false));
report.productionUnchanged=HASH(fs.readFileSync(filename,'utf8'))===report.sourceHash;
report.overrideWitness=report.rows.some(r=>r.selectionWitness&&r.afterDecision.avoidCalls>0&&!r.commandMatchesFirstAction);
const out=path.join(root,'docs/sequence-safety-override-v11.json');
if(fs.existsSync(out)){const old=fs.readFileSync(out),history=path.join(root,'docs/sequence-safety-override-v11-history');fs.mkdirSync(history,{recursive:true});fs.writeFileSync(path.join(history,HASH(old.toString())+'.json'),old);}
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');fs.writeFileSync(out+'.source.js.gz',zlib.gzipSync(source));fs.writeFileSync(out+'.script.js.gz',zlib.gzipSync(fs.readFileSync(__filename)));
console.log(JSON.stringify({sourceHash:report.sourceHash,productionUnchanged:report.productionUnchanged,overrideWitness:report.overrideWitness,rows:report.rows.map(r=>({kind:r.kind,stub:r.stub,planned:r.planned,selected:r.afterDecision.planning.selected,strategy:r.afterDecision.strategy.mode,sequence:r.afterDecision.sequence?.mode,actual:{v:r.afterDecision.targetV,t:r.afterDecision.targetT},first:r.afterDecision.sequence?.actions[0],avoidCalls:r.afterDecision.avoidCalls,avoidGap:r.afterDecision.avoidGap,commandMatchesFirstAction:r.commandMatchesFirstAction,reapplyRepairsLane:r.reapplyRepairsLane,follow:r.afterDecision.followOpportunity}))},null,2));}
if(require.main===module)main();
module.exports={run};
