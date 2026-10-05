#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {api,HASH}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..');
let source=fs.readFileSync(path.join(root,'sim.js'),'utf8');
if(process.argv.includes('--fixtures')){
  source=require('./fixtures/race-prediction-v11-install').applyPredictionPatch(source);
  source=require('./fixtures/rider-controller-v11').applyController(source);
}
const S=api(source),cases=[];
const clone=x=>JSON.parse(JSON.stringify(x));
function horse(id,position=.5){
  const h=S.makeHorse(()=>.5,{id,name:id,level:70,surface:'草地',special:'左右皆可',jockeyGrade:'优秀',
    '斗志':50,'疲劳':0,bodyMass:480,carriedWeight:57,physiology:S.neutralPhysiology(),
    behavior:{forwardness:position,settle:.6,tractability:.8},racePlan:{position,risk:.5,patience:.6}});
  for(const key of Object.keys(h.stats))h.stats[key]=70;return h;
}
function race(field,opts={}){return S.createRace(field,{length:1200,course:'标准',profile:'平坦',rng:S.mulberry32(2026101103),...opts});}
function guards(r){
  for(const h of r.race.horses){const st=h.statsSummary;
    assert([h.s,h.t,h.v,h.stamina,h.guts].every(Number.isFinite));
    assert(Math.abs(st.workUsed-st.aerobicUsed-st.energyUsed)<1e-6);
    assert(Math.abs(h.stamina-(h.staminaMax-st.energyUsed+st.recovered))<1e-6);
    assert(st.unpaidWork<1e-6);assert(h.accel>=-S.RACE_F.braking-1e-6);
  }
  assert.equal(r.race.traffic?.infeasibleSteps??0,0);
}
function test(name,fn){const at=performance.now();const result=fn();cases.push({name,passed:true,seconds:(performance.now()-at)/1000,result});console.log('PASS '+name);}
test('position intention values attainable positions and pays for a useful launch',()=>{
  const byDistance=[1200,2400].map(length=>{const runs=[.1,.9].map(intent=>{
    const r=race(Array.from({length:8},(_,i)=>horse('launch-'+i,intent)),{length});r.step(1/60);guards(r);
    return {intent,meanRequest:r.race.horses.reduce((sum,h)=>sum+h.targetV,0)/8,
      plans:r.race.horses.map(h=>({mode:h.planning?.selected,request:h.targetV,capacity:h.staminaMax,aerobic:h.aerobic,maxV:h.maxV,candidates:h.planning?.candidates}))};
  });
  assert(runs[1].meanRequest>=runs[0].meanRequest-1e-8,'forward intent must not deliberately request a slower break');
  if(length===1200)assert(runs[1].meanRequest>runs[0].meanRequest+.01,'an affordable sprint launch should respond to position intention');
  assert(runs[1].plans.some((p,i)=>p.candidates.some(c=>c.mode==='start-position'&&
    c.score>(runs[0].plans[i].candidates.find(d=>d.mode==='start-position')?.score??Infinity)+.01)),
    'position scoring must respond even when an expensive long-race surge is declined');
  assert.deepEqual(runs[0].plans.map(p=>[p.capacity,p.aerobic,p.maxV]),runs[1].plans.map(p=>[p.capacity,p.aerobic,p.maxV]));return {length,runs};});return byDistance;
});
test('above-cap catch request cannot certify a lost-distance goal',()=>{
  const r=race([horse('catch')],{length:2400,course:'東京芝A'}),h=r.race.horses[0];
  Object.assign(h,{s:2200,t:1.4,targetT:1.4,v:18.6,prevV:18.6,startDelay:0});h.stamina=800;h.aerobicOutput=h.aerobic;r.race.t=130;
  const planned=18.71923828125,follow=planned-.1,catchTime=2.6842,catchV=planned+.8/catchTime;
  const duration=8+catchTime,baseline=h.projectActions([{duration,targetV:planned,targetT:1.4}],{maxDt:1/60});
  const f=h.projectActions([{duration:8,targetV:follow,targetT:1.4},
    {duration:catchTime,targetV:catchV,targetT:1.4}],{maxDt:1/60,goal:{s:baseline.endpoint.s,tolerance:.12}});
  assert(catchV>h.maxV);assert(f.targetShortfall>0);assert.equal(f.goalReached,false);
  return {catchV,maxV:h.maxV,targetShortfall:f.targetShortfall,regainedDistance:f.endpoint.s-baseline.endpoint.s,goalReached:f.goalReached};
});
test('parallel bodies exclude an immediate inward crossing',()=>{
  const r=race([horse('inside'),horse('middle'),horse('outside')],{length:2400,course:'東京芝A'});
  r.race.t=25;
  for(let i=0;i<3;i++){const h=r.race.horses[i];Object.assign(h,{s:300,t:1.4+i*1.2,targetT:1.4+i*1.2,v:16,prevV:16,startDelay:0,lastObserve:0,startSettled:true});
    h.aerobicOutput=h.aerobic;if(i<2)h.control={targetV:16,targetT:h.t};}
  r.step(1/60);const outside=r.race.horses[2],plan=clone(outside.planning);
  assert(!plan.candidates.some(c=>c.mode==='route'&&c.targetT<2.7&&!c.pathConflict));
  for(let i=0;i<120;i++){r.step(1/60);guards(r);}return {plan,finalLane:outside.t,blockedSeconds:outside.statsSummary.blockedSeconds};
});
test('a finite rider sequence executes its transition at the predicted time',()=>{
  const r=race([horse('sequence')],{length:2400}),h=r.race.horses[0];
  r.race.t=20;Object.assign(h,{s:300,t:1.4,targetT:1.4,v:16,prevV:16,startDelay:0,lastObserve:100});h.aerobicOutput=h.aerobic;
  const actions=[{duration:.027,targetV:14.5,targetT:1.4,leader:null},{duration:.173,targetV:18,targetT:1.4,leader:null}];
  const predicted=h.projectActions(actions,{maxDt:1/60});
  h.riderSequence={at:r.race.t,mode:'follow',stage:-1,actions:clone(actions)};
  // The real engine splits the 60 Hz interval at .027 s just as the forecast does.
  for(let i=0;i<12;i++){r.step(1/60);guards(r);}
  for(const key of ['s','t','v','stamina','guts','retention','aerobicOutput'])
    assert(Math.abs(h[key]-predicted.endpoint[key])<1e-7,key+' transition mismatch: '+(h[key]-predicted.endpoint[key]));
  return {duration:.2,targetV:h.targetV,errors:Object.fromEntries(['s','v','stamina','guts'].map(k=>[k,h[k]-predicted.endpoint[k]]))};
});
test('running style labels leave physical trajectories unchanged',()=>{
  const original=Array.from({length:4},(_,i)=>horse('labels-'+i,[.15,.4,.65,.9][i]));
  const fields=[clone(original),clone(original)];fields[0].forEach(h=>h.style='逃');fields[1].forEach(h=>h.style='追');
  const runs=fields.map(field=>{const r=race(field);let steps=0;while(!r.race.finished&&steps++<15000){r.step(1/60);guards(r);}
    assert(r.race.finished);return r.race.horses.map(h=>({id:h.id,time:h.time,place:h.place,energy:h.statsSummary.energyUsed,peak:h.statsSummary.peakSpeed,observedStyle:h.observedStyle}));});
  assert.deepEqual(runs[0],runs[1]);return runs[0];
});
const report={sourceHash:HASH(source),builtAt:new Date().toISOString(),passed:cases.length,cases};
fs.writeFileSync(path.join(root,'docs/rider-planning-v11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:cases.length,sourceHash:report.sourceHash}));
