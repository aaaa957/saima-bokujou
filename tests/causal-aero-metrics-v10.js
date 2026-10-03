#!/usr/bin/env node
'use strict';
// Identification experiment only: no production coefficient is changed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {api,HASH,DT,distribution:D}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'),engineHash=HASH(source);
assert.equal(engineHash,'51caabc1395b62a325f3048aa923994516310d8c69665f3fd17b89978615b82a','Registered production source changed');
const read=name=>{const text=fs.readFileSync(path.join(ROOT,'docs',name),'utf8');return {name,hash:HASH(text),data:JSON.parse(text)};};
const inputs=['system-reality-comparison-v2026.10.02.3.json','current-engine-reality-sources-2026-10-02.json','system-external-reference-2022.json','tempo-system-v9.json'].map(read);
const oldAir='air:RACE_F.airK*(drafting?RACE_F.draftSave:1),wind:headwindAt(at),';
const diagnosticAir='air:RACE_F.airK*((o.__diagnosticAeroShield||drafting)?RACE_F.draftSave:1),wind:headwindAt(at),';
assert.equal(source.split(oldAir).length,2);
const diagnosticSource=source.replace(oldAir,diagnosticAir),diagnosticHash=HASH(diagnosticSource);
assert.equal(diagnosticSource.replace(diagnosticAir,oldAir),source,'Exact instrumentation inverse');
const speeds=[15,17,18,19],baseApi=api(source),F={...baseApi.RACE_F};
const steadyShares=speeds.map(v=>{const ground=F.resistanceK*v*v,air=F.airK*v*v*v;return {speed:v,ground,air,total:ground+air,airFraction:air/(ground+air),totalSavingWithDefaultShield:air*(1-F.draftSave)/(ground+air)};});
const referenceSpeed=18,referenceTotal=F.resistanceK*referenceSpeed**2+F.airK*referenceSpeed**3;
// 17% is a published rough aerodynamic power estimate, not an identified game target.
// Match only steady straight work at 18m/s to separate the relative component split.
const reallocation={airK:.17*referenceTotal/referenceSpeed**3,resistanceK:.83*referenceTotal/referenceSpeed**2};
const variants=['original-unshielded','original-shielded','zero-air-upper-bound','reallocated17-unshielded','reallocated17-shielded'];
const rows=[];
function run(length,request,variant,proof=false,plain=false){
 const S=api(plain?source:diagnosticSource);S.RACE_F.turnCost=0;S.RACE_F.curveLateral=1000;
 if(variant==='zero-air-upper-bound')S.RACE_F.airK=0;
 if(variant.startsWith('reallocated17'))Object.assign(S.RACE_F,reallocation);
 const h={id:'aero-reference70',name:'aero-reference70',stats:Object.fromEntries(['速度','爆发力','出闸能力','耐力','力量','毅力','体格','智力'].map(k=>[k,70])),
  physiology:S.neutralPhysiology(),behavior:{forwardness:.5,settle:.5,tractability:.65},surface:'草地',special:'左右皆可',
  jockeyGrade:'优秀',bodyMass:480,carriedWeight:57,'斗志':50,'疲劳':0};
 const r=S.createRace([h],{length,course:'标准',profile:'平坦',surface:'草地',state:'良',wind:0,rng:S.mulberry32(2026100301),__diagnosticAeroShield:variant.endsWith('-shielded')});
 const H=r.race.horses[0];H.t=H.targetT=r.race.geo.referenceLane;H.startDelay=.3;H.control={targetV:request,targetT:H.t};
 let frames=0,maxWorkError=0,maxReserveError=0,maxUnpaid=0;
 const frameDigest=proof?crypto.createHash('sha256'):null;
 while(!r.race.finished&&r.race.t<610){r.step(DT);frames++;const s=H.statsSummary;
  if(frameDigest)frameDigest.update(JSON.stringify(H)+'\n');
  maxWorkError=Math.max(maxWorkError,Math.abs(s.workUsed-s.aerobicUsed-s.energyUsed));
  maxReserveError=Math.max(maxReserveError,Math.abs(H.stamina-(H.staminaMax-s.energyUsed+s.recovered)));
  maxUnpaid=Math.max(maxUnpaid,s.unpaidWork);
 }
 assert(H.place===1&&Number.isFinite(H.time)&&!H.dnf);
 assert(maxWorkError<1e-6&&maxReserveError<1e-6&&maxUnpaid<1e-6);
 const splits=H.sectionals.map(s=>s.split);
 return {length,request,variant,time:H.time,final600:H.final3f,first200:splits[0],last200Difference:splits.at(-1)-splits.at(-2),
  finalReserve:H.stamina/H.staminaMax,work:H.statsSummary.workUsed,frames,maxWorkError,maxReserveError,maxUnpaid,
  parameters:{airK:S.RACE_F.airK,resistanceK:S.RACE_F.resistanceK,turnCost:0,curveLateral:1000},sectionals:splits,
  ...(frameDigest?{frameDigest:frameDigest.digest('hex')}:{})};
}
for(const length of [1200,2400])for(const request of [18,30])for(const variant of variants)rows.push(run(length,request,variant));
const instrumentationProofs=[];
for(const length of [1200,2400]){
 const a=run(length,18,'original-unshielded',true),b=run(length,18,'original-unshielded',true,true);
 assert.deepEqual(a,b,'Disabled diagnostic shielding must preserve every serialized horse frame and result');
 instrumentationProofs.push({length,frames:a.frames,allSerializedHorseFramesExact:true,resultsExact:true,frameDigest:a.frameDigest});
}
const paired=[];
for(const length of [1200,2400])for(const request of [18,30]){
 const get=variant=>rows.find(r=>r.length===length&&r.request===request&&r.variant===variant),a=get('original-unshielded'),b=get('original-shielded'),z=get('zero-air-upper-bound'),c=get('reallocated17-unshielded'),d=get('reallocated17-shielded');
 paired.push({length,request,originalShieldTimeSaving:a.time-b.time,originalShieldFinal600Saving:a.final600-b.final600,
  originalShieldWorkSaving:a.work-b.work,zeroAirTimeSavingUpperBound:a.time-z.time,
  reallocatedShieldTimeSaving:c.time-d.time,reallocatedUnshieldedTimeChange:c.time-a.time,
  originalFinishReserve:a.finalReserve,shieldFinishReserve:b.finalReserve});
}
function cv(values){const m=values.reduce((a,b)=>a+b,0)/values.length;return Math.sqrt(values.reduce((a,b)=>a+(b-m)**2,0)/values.length)/m;}
const tempo=inputs.find(x=>x.name==='tempo-system-v9.json').data;
const quantization=tempo.samples.map(row=>{const splits=row.crowd.metrics.leaderSectionals200.slice(1);return {length:row.job.length,replicate:row.job.replicate,unroundedCv:cv(splits),rounded01Cv:cv(splits.map(x=>Math.round(x*10)/10))};});
const refs=inputs.filter(x=>x.data.races).flatMap(x=>x.data.races);
const realShape=refs.map(r=>{const s=r.raceSectionals200m;return {id:r.id,length:r.length,state:r.state,first200:s[0],last200Difference:s.at(-1)-s.at(-2),post200Cv:cv(s.slice(1))};});
const realByDistance=[1200,1600,2000,2400,3000,3200].map(length=>{const rows=realShape.filter(r=>r.length===length);return {length,events:rows.length,last200:D(rows.map(r=>r.last200Difference)),positiveLast200:rows.filter(r=>r.last200Difference>0).length,post200Cv:D(rows.map(r=>r.post200Cv))};});
const report={engineHash,diagnosticHash,inputs:inputs.map(({name,hash})=>({name,hash})),
 protocol:{races:rows.length,validationExecutions:4,instrumentationProofs,distances:[1200,2400],requests:[18,30],variants,referenceSpeed,referenceTotal,reallocation,
  fixed:'One neutral70 horse, fixed reference lane, same delay/RNG/weight. No opponents, AI, hills or wind. All variants disable turn work and turn speed caps; geometry still supplies arc length.',
  scope:'Permanent full shielding is a counterfactual upper-benefit scenario, not an actual pack. Air removal is a numerical bound inside this plant. Reallocation holds total steady straight work only at18m/s; at other speeds total work differs. 17% is a rough study estimate, not measured for these horses or an accepted coefficient.',
  sourceMutation:'A single exact in-memory powerTerms marker exposes permanent shielding. Parameters changed only on separately compiled module objects. Production source and old reports are never rewritten.'},
 steadyShares,rows,paired,quantization:{rows:quantization,unroundedCv:D(quantization.map(r=>r.unroundedCv)),rounded01Cv:D(quantization.map(r=>r.rounded01Cv))},realByDistance,
 integrity:{complete:rows.length===20,instrumentationInverseExact:true,instrumentationPairedProofsPassed:instrumentationProofs.length===2,allFinite:rows.every(r=>[r.time,r.final600,r.first200,r.work].every(Number.isFinite)),
  sourceUnchanged:HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'))===engineHash,
  inputsUnchanged:inputs.every(x=>read(x.name).hash===x.hash),originalParametersUnchanged:JSON.stringify(baseApi.RACE_F)===JSON.stringify(F),
  maxWorkError:Math.max(...rows.map(r=>r.maxWorkError)),maxReserveError:Math.max(...rows.map(r=>r.maxReserveError)),maxUnpaid:Math.max(...rows.map(r=>r.maxUnpaid))}};
assert(Object.values(report.integrity).every(x=>typeof x!=='boolean'||x));
fs.writeFileSync(path.join(ROOT,'docs/causal-aero-metrics-v10.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({paired,steadyShares,quantization:report.quantization.unroundedCv,rounded:report.quantization.rounded01Cv,realByDistance,integrity:report.integrity},null,2));
