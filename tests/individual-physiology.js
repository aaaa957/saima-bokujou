#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const S=require('../sim.js');
let passed=0;
function test(name,fn) { fn();passed++;console.log('PASS '+name); }
const copy=v=>JSON.parse(JSON.stringify(v));
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} vs ${b}`);
function horse(id,profile=S.neutralPhysiology()) {
  const h=S.makeHorse(()=>0.5,{id,physiology:profile,'斗志':50,'疲劳':0,jockeyGrade:'殿堂',
    surface:'草地',special:'左右皆可',behavior:{forwardness:0.5,settle:0.7,tractability:0.9},
    racePlan:{position:0.5,risk:0.5,patience:0.7},bodyMass:480,carriedWeight:57});
  for(const key of Object.keys(h.stats)) h.stats[key]=70;return h;
}
function race(h,length=2000,seed=12233) { return S.createRace([h],{length,course:'标准',profile:'平坦',state:'良',rng:S.mulberry32(seed)}); }
test('legacy physiology persists before training and uses neither generation nor race random draws',()=>{
  const a=horse('old'),b=copy(a);delete a.physiology;delete b.physiology;
  const profile=copy(S.horsePhysiology(a));
  assert.deepEqual(profile,S.horsePhysiology(b));
  a.stats['耐力']+=10;assert.deepEqual(S.horsePhysiology(a),profile);
  const c=copy(b);delete c.physiology;
  let countA=0,countB=0;const rngA=S.mulberry32(765),rngB=S.mulberry32(765);
  const rA=S.createRace([c],{length:1200,rng:()=>{countA++;return rngA();}});
  const rB=S.createRace([b],{length:1200,rng:()=>{countB++;return rngB();}});
  assert.equal(countA,countB);assert.deepEqual(c.physiology,b.physiology);
  assert.equal(rA.race.horses[0].startDelay,rB.race.horses[0].startDelay);
});
const distribution={};
test('stable bounded axes have small mean drift and distinct supply/capacity variation',()=>{
  const profiles=Array.from({length:5000},(_,i)=>S.horsePhysiology({id:'individual-'+i,stats:horse('stats').stats}));
  assert.equal(new Set(profiles.map(p=>JSON.stringify(p))).size,5000);
  for(const key of S.PHYSIOLOGY_KEYS) {
    const values=profiles.map(p=>p[key]),mean=values.reduce((a,b)=>a+b,0)/values.length;
    const sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
    assert.ok(values.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));
    assert.ok(Math.abs(mean)<0.02);assert.ok(sd>0.25&&sd<0.60);
    distribution[key]={mean,sd,min:Math.min(...values),max:Math.max(...values)};
  }
  const meanA=distribution.endurance.mean,meanB=distribution.power.mean;
  distribution.supplyCapacityCorrelation=profiles.reduce((a,p)=>a+(p.endurance-meanA)*(p.power-meanB),0)/profiles.length/distribution.endurance.sd/distribution.power.sd;
  assert.ok(Math.abs(distribution.supplyCapacityCorrelation)<0.15);
});
test('neutral 70-point physiology preserves the established mechanical-equivalent scale',()=>{
  const H=race(horse('neutral')).race.horses[0];
  near(H.aerobic,S.RACE_F.aerobicPower);near(H.aerobicTau,S.RACE_F.aerobicTau);
  near(H.reservePower,S.RACE_F.reservePower);near(H.staminaMax,70*S.RACE_F.staminaPer);
  near(H.economy,1);near(H.fatigueLoss,S.RACE_F.fatigueLoss);
});
test('each trait changes its relevant physical pathway and training acts on the persisted profile',()=>{
  const neutral=race(horse('a')).race.horses[0];
  const power=race(horse('a',{...S.neutralPhysiology(),power:1})).race.horses[0];
  const endurance=race(horse('a',{...S.neutralPhysiology(),endurance:1})).race.horses[0];
  const economy=race(horse('a',{...S.neutralPhysiology(),economy:1})).race.horses[0];
  const kinetics=race(horse('a',{...S.neutralPhysiology(),kinetics:1})).race.horses[0];
  const durability=race(horse('a',{...S.neutralPhysiology(),durability:1})).race.horses[0];
  assert.ok(power.reservePower>neutral.reservePower&&power.staminaMax>neutral.staminaMax);
  near(power.aerobic,neutral.aerobic);near(endurance.staminaMax,neutral.staminaMax);
  assert.ok(endurance.aerobic>neutral.aerobic&&endurance.recoveryRate>neutral.recoveryRate);
  assert.ok(economy.powerFor(17,0,false)<neutral.powerFor(17,0,false));
  assert.ok(kinetics.aerobicTau<neutral.aerobicTau);
  assert.ok(durability.gutsMax>neutral.gutsMax&&durability.fatigueLoss<neutral.fatigueLoss);
  const h=horse('training'),profile=copy(h.physiology);h.stats['耐力']+=15;h.stats['爆发力']+=15;
  const trained=race(h).race.horses[0];assert.deepEqual(h.physiology,profile);
  assert.ok(trained.aerobic>neutral.aerobic&&trained.staminaMax>neutral.staminaMax);
  assert.ok(trained.reservePower>neutral.reservePower&&trained.aerobicTau<neutral.aerobicTau);
});
test('race entries, retiring stock and offspring preserve bounded physiology',()=>{
  const rng=S.mulberry32(911),stock=S.makeBaseBreedingStock(rng),roster=S.makeRoster(rng,stock),h=roster[0];
  assert.deepEqual(S.rosterEntry(h,rng).physiology,h.physiology);
  assert.deepEqual(S.breederFromHorse(h).physiology,h.physiology);
  const sire=stock.find(h=>h.sex==='牡'),dam=stock.find(h=>h.sex==='牝');
  const a=S.breedFoal(S.mulberry32(91),sire,dam),b=S.breedFoal(S.mulberry32(91),sire,dam);
  assert.deepEqual(a,b);
  assert.ok(S.PHYSIOLOGY_KEYS.every(key=>Number.isFinite(a.physiology[key])&&Math.abs(a.physiology[key])<=1));
  assert.deepEqual(S.foalToRosterHorse(S.mulberry32(919),a,sire,dam,91).physiology,a.physiology);
  const career=S.makeCareerHorse(S.mulberry32(444));
  const field=S.makeCareerRaceField(career,S.TIER_BY_KEY.maiden,S.mulberry32(919));
  assert.deepEqual(field.find(h=>h.player).physiology,career.physiology);
});
function finish(h,length,controlV) {
  const R=race(h,length),H=R.race.horses[0];
  if(controlV) H.control={targetV:controlV,targetT:H.t};
  while(!R.race.finished&&R.race.t<600) R.step(1/30);
  assert.ok(H.place&&Number.isFinite(H.time));
  assert.ok(H.statsSummary.unpaidWork<1e-6);
  near(H.statsSummary.workUsed,H.statsSummary.aerobicUsed+H.statsSummary.energyUsed,1e-6);
  near(H.stamina,H.staminaMax-H.statsSummary.energyUsed+H.statsSummary.recovered,1e-6);
  return {time:H.time,final600:H.final3f,peakSpeed:H.statsSummary.peakSpeed,energyUsed:H.statsSummary.energyUsed,
    aerobicUsed:H.statsSummary.aerobicUsed,reserveLeft:H.stamina/H.staminaMax};
}
const phenotypes={sustained:{...S.neutralPhysiology(),endurance:1,power:-1,kinetics:1,durability:1},
  shortPower:{...S.neutralPhysiology(),endurance:-1,power:1,kinetics:-1,durability:-1},neutral:S.neutralPhysiology()};
const distanceRows=[];
test('the same physiological types can reverse distance ordering without distance multipliers',()=>{
  for(const length of [1200,1600,2000,2400,3000,3200]) {
    const row={length};for(const [key,profile] of Object.entries(phenotypes)) row[key]=finish(horse('paired',profile),length);
    distanceRows.push(row);
  }
  assert.ok(distanceRows[0].shortPower.time<distanceRows[0].sustained.time);
  assert.ok(distanceRows.at(-1).sustained.time<distanceRows.at(-1).shortPower.time);
});
test('more aerobic supply leaves more short-term reserve under identical actual effort',()=>{
  const weak=finish(horse('same',{...S.neutralPhysiology(),endurance:-1}),1200,16);
  const strong=finish(horse('same',{...S.neutralPhysiology(),endurance:1}),1200,16);
  near(weak.time,strong.time,1e-7);
  assert.ok(strong.reserveLeft>weak.reserveLeft);assert.ok(strong.aerobicUsed>weak.aerobicUsed);
});
test('changing only displayed running style does not alter the race',()=>{
  const field=S.makeField(S.mulberry32(5644),{n:8,level:70}),other=copy(field);
  field.forEach(h=>h.style='逃');other.forEach(h=>h.style='追');
  const a=S.createRace(field,{length:1600,rng:S.mulberry32(883)}),b=S.createRace(other,{length:1600,rng:S.mulberry32(883)});
  while(!a.race.finished) a.step(1/30);while(!b.race.finished) b.step(1/30);
  for(let i=0;i<field.length;i++) {
    const x=a.race.horses[i],y=b.race.horses[i];near(x.time,y.time);near(x.final3f,y.final3f);
    assert.equal(x.place,y.place);near(x.statsSummary.workUsed,y.statsSummary.workUsed);
  }
});
const out=process.argv[2];
if(out) fs.writeFileSync(path.resolve(out),JSON.stringify({passed,protocol:'single horse, all stats 70, same seed/body/weight/rider/plan, standard flat track, no traffic',distribution,distanceRows},null,2));
console.log(JSON.stringify({passed,distanceRows,distribution},null,2));
