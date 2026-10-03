#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const S=require('../sim.js');
const Save=require('../career-save.js');
function snapshot() {
  const rng=S.mulberry32(11991),stock=S.makeBaseBreedingStock(rng),roster=S.makeRoster(rng,stock);
  const sire=stock.find(h=>h.sex==='牡'),dam=stock.find(h=>h.sex==='牝');
  const foal=S.breedFoal(rng,sire,dam);
  return {bankroll:100,careerStaff:S.makeStaff(rng),career:{roster,breedingStock:stock,aiRaces:[],intel:[],
    date:{year:1968,week:22},weekNum:1,weekBets:{},startedIds:{},watchedIds:{},settledIds:{},betTypes:{},
    stats:{bets:0,hits:0,profit:0},debug:false,recap:null,watchInfo:null},
    breedState:{sireId:sire.id,damId:dam.id,foal,foalSireId:sire.id,foalDamId:dam.id}};
}
function storage() {
  const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))};
}
const state=snapshot(),store=storage();
assert.ok(Save.validateSnapshot(state).ok);
assert.ok(Save.save(store,state).ok);
const loaded=Save.load(store);assert.ok(loaded.ok);
assert.deepEqual(loaded.snapshot,state);
for(const [a,b] of [[state.career.roster,loaded.snapshot.career.roster],[state.career.breedingStock,loaded.snapshot.career.breedingStock]]) {
  a.forEach((h,i)=>assert.deepEqual(h.physiology,b[i].physiology));
}
assert.deepEqual(state.breedState.foal.physiology,loaded.snapshot.breedState.foal.physiology);
console.log('PASS newborn/roster/retired physiology round-trip without losing pedigree sharing');
const old=snapshot();for(const h of [...old.career.roster,...old.career.breedingStock]) delete h.physiology;
delete old.breedState.foal.physiology;
assert.ok(Save.save(storage(),old).ok);
const a=JSON.parse(JSON.stringify(old.career.roster[0])),b=JSON.parse(JSON.stringify(a));
assert.deepEqual(S.horsePhysiology(a),S.horsePhysiology(b));
console.log('PASS legacy saves still validate and stable migration is reproducible');
for(const invalid of [null,{...S.neutralPhysiology(),version:2},{...S.neutralPhysiology(),power:NaN},
  {...S.neutralPhysiology(),endurance:1.01},{...S.neutralPhysiology(),economy:-1.01},{version:1}]) {
  for(const where of ['horse','foal']) {
    const malformed=snapshot();
    if(where==='horse') malformed.career.roster[0].physiology=invalid;
    else malformed.breedState.foal.physiology=invalid;
    assert.equal(Save.validateSnapshot(malformed).ok,false);
    const good=store.getItem(Save.KEY);
    assert.equal(Save.save(store,malformed).ok,false);
    assert.equal(store.getItem(Save.KEY),good,'invalid physiology cannot replace current progress');
  }
}
console.log('PASS malformed, non-finite, out-of-range and unknown-version profiles preserve existing saves');
assert.ok(Save.save(store,state).ok); // create a valid recovery backup
const envelope=JSON.parse(store.getItem(Save.KEY));
const profileNode=envelope.payload.nodes.find(node=>node.type==='object'&&node.entries.some(([k])=>k==='endurance')&&node.entries.some(([k])=>k==='kinetics'));
profileNode.entries.find(([k])=>k==='version')[1]=2;
const payload=JSON.stringify(envelope.payload);let hash=2166136261;
for(let i=0;i<payload.length;i++) hash=Math.imul(hash^payload.charCodeAt(i),16777619);
envelope.checksum=(hash>>>0).toString(16).padStart(8,'0');
store.setItem(Save.KEY,JSON.stringify(envelope));
const recovered=Save.load(store);assert.ok(recovered.ok);assert.equal(recovered.status,'recovered');
assert.deepEqual(recovered.snapshot,state);
console.log('PASS correctly checksummed unknown physiology versions recover the valid backup');
