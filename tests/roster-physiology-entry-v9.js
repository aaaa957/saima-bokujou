#!/usr/bin/env node
'use strict';
// Lifecycle regression only: no tick/race results or benchmark engine changes.
const assert=require('node:assert/strict');
const S=require('../sim.js');
const clone=x=>JSON.parse(JSON.stringify(x));
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message);}}
function player(){
  const h=S.makeCareerHorse(S.mulberry32(123));
  h.physiology={version:1,endurance:0.21,power:-0.34,economy:0.57,kinetics:-0.68,durability:0.79};
  h.starts=0;h.wins=0;return h;
}
function entryFor(h,seed=987){
  const option=S.raceOptionsForRoster(h,S.mulberry32(seed),[],10)[0];
  const entry=option.field.find(x=>x.player&&x.id===h.id);
  assert.ok(entry,'the player must appear in the roster race option');
  return {option,entry};
}
function initial(entry,option){return S.createRace([entry],{length:option.dist,surface:option.surface,state:option.state,
  dir:option.dir,profile:option.profile,rng:S.mulberry32(77)}).race.horses[0];}
test('roster options preserve persisted axes through race initialisation',()=>{
  const h=player(),profile=clone(h.physiology),{entry,option}=entryFor(h);
  assert.deepEqual(entry.physiology,profile);
  assert.deepEqual(initial(entry,option).h.physiology,profile);
  assert.deepEqual(h.physiology,profile);
});
test('training changes physical ability without replacing individual axes',()=>{
  const h=player(),profile=clone(h.physiology),first=entryFor(h);
  assert.deepEqual(first.entry.physiology,profile);
  const before=initial(first.entry,first.option);
  h.stats['耐力']+=8;h.stats['爆发力']+=6;
  const trained=entryFor(h),after=initial(trained.entry,trained.option);
  assert.deepEqual(trained.entry.physiology,profile);
  assert.deepEqual(h.physiology,profile);
  assert.ok(after.aerobic>before.aerobic&&after.staminaMax>before.staminaMax);
  assert.ok(after.reservePower>before.reservePower);
});
test('legacy roster player is migrated once before later training',()=>{
  const h=player();delete h.physiology;
  const expected=S.horsePhysiology(clone(h)),first=entryFor(h);
  assert.deepEqual(h.physiology,expected);
  assert.deepEqual(first.entry.physiology,expected);
  h.stats['耐力']+=8;h.stats['速度']+=4;
  const later=entryFor(h,123456);
  assert.deepEqual(h.physiology,expected);
  assert.deepEqual(later.entry.physiology,expected);
});
test('race entry physiology is detached in both mutation directions',()=>{
  const h=player(),profile=clone(h.physiology),{entry}=entryFor(h);
  assert.deepEqual(entry.physiology,profile);
  assert.notEqual(entry.physiology,h.physiology);
  entry.physiology.power=0.45;
  assert.deepEqual(h.physiology,profile);
  h.physiology.economy=-0.23;
  assert.equal(entry.physiology.economy,profile.economy);
});
console.log(JSON.stringify({passed,failed,total:passed+failed}));
if(failed)process.exitCode=1;
