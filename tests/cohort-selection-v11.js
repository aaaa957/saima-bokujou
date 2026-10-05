#!/usr/bin/env node
'use strict';
// The production source is owned by the root agent. This file composes exact
// source changes in memory and writes their reviewable fixture on request.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {api,HASH}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),BASE_HASH='51caabc1395b62a325f3048aa923994516310d8c69665f3fd17b89978615b82a';
const fixturePath=path.join(ROOT,'tests/fixtures/race-cohort-v11.patch'),clone=x=>structuredClone(x);
const helpers=String.raw`  /* ---------------- 赛前候选与条件阵容 ---------------- */
  // 报名分布的模型假设；不会乘进速度、成本或距离适性。
  const COHORT_VERSION = 1;
  const COHORT_POOL_MULTIPLIER = 4;
  const cohortForecastCache = new Map();
  function applyCohortEntryOverrides(h, overrides) {
    const o=overrides||{};
    // 状态规范在完整生成和档案物化之后、报名评估之前；不改生成 RNG。
    for(const key of ['surface','special','斗志','疲劳','jockeyGrade','bodyMass','carriedWeight'])
      if(Object.prototype.hasOwnProperty.call(o,key))h[key]=o[key];
    return h;
  }
  function cohortRaceOptions(options) {
    const o=options||{}, race=o.race||o;
    return {length:Number(race.length||race.dist)||2000,course:race.course||race.venue||'标准',
      surface:race.surface||'草地',state:race.state||'良',dir:race.dir||'左回',
      profile:race.profile||'平坦',wind:Number(race.wind)||0};
  }
  function cohortLevelBand(options) {
    const o=options||{}, tier=typeof o.tierKey==='string'?TIER_BY_KEY[o.tierKey]:o.tierDef;
    const explicit=o.levelBand||tier?.level;
    const requestedCenter=Number.isFinite(o.level)?o.level:explicit?(explicit[0]+explicit[1])/2:70;
    const lower=explicit?Number(explicit[0]):20,upper=explicit?Number(explicit[1]):97;
    if(!Number.isFinite(lower)||!Number.isFinite(upper)||lower>upper)throw new Error('无效赛级能力区间');
    const center=clamp(requestedCenter,lower,upper);
    return [clamp(Math.max(lower,center-FIELD_LEVEL_SPAN),20,97),clamp(Math.min(upper,center+FIELD_LEVEL_SPAN),20,97)];
  }
  function raceEntryForecast(h, options) {
    if(!h||!h.stats)throw new Error('无效赛前候选马');
    const raceOptions=cohortRaceOptions(options);
    if(!Number.isFinite(raceOptions.length)||raceOptions.length<200)throw new Error('无效报名比赛距离');
    // 仅克隆并构造同物理的赛前状态，不 step、不读取赛后名次/总时。
    // 输入档案不因评估距离而改变，现有马只由选择入口显式补齐旧档。
    const entry=JSON.parse(JSON.stringify(h));horsePhysiology(entry);entry.behavior=horseBehavior(entry);
    const key=JSON.stringify([raceOptions,entry.stats,entry.physiology,entry['疲劳']||0,entry['斗志']??70,
      entry.behavior,entry.surface,entry.special,entry.bodyMass,entry.carriedWeight,RACE_F]);
    if(cohortForecastCache.has(key))return {...cohortForecastCache.get(key)};
    const r=createRace([entry],{...raceOptions,rng:()=>0.5}),H=r.race.horses[0];
    H.t=r.race.geo.referenceLane;H.targetT=H.t;
    let low=3,high=H.maxV,best=null;
    for(let i=0;i<9;i++){
      const requested=(low+high)/2,forecast=H.finishPlan(requested,0,{earlyExit:true});
      if(forecast.feasible){low=requested;best=forecast;}else high=requested;
    }
    if(!best)best=H.finishPlan(low,0);
    const result={version:COHORT_VERSION,seconds:best.seconds,requestedV:low,
      required:best.required,capacity:H.staminaMax,aerobic:H.aerobic,maxV:H.maxV,
      peakPowerShortfall:best.peakPowerShortfall,feasible:best.feasible,referenceLane:H.t};
    if(![result.seconds,result.requestedV,result.required,result.capacity,result.aerobic,result.maxV].every(Number.isFinite)||result.seconds<=0)
      throw new Error('赛前候选预测未产生有限结果');
    if(cohortForecastCache.size>=512)cohortForecastCache.delete(cohortForecastCache.keys().next().value);
    cohortForecastCache.set(key,result);return {...result};
  }
  function cohortReference(level, race, entryOverrides) {
    const reference=makeHorse(()=>0.5,{id:'cohort-reference',level,physiology:neutralPhysiology(),
      behavior:{forwardness:0.5,settle:0.5,tractability:0.65},surface:race.surface,
      special:'左右皆可','斗志':50,'疲劳':0,bodyMass:480,carriedWeight:57});
    applyCohortEntryOverrides(reference,entryOverrides);return raceEntryForecast(reference,race);
  }
  function selectRaceCohort(candidates, rng, options) {
    if(!Array.isArray(candidates)||typeof rng!=='function')throw new Error('无效候选池');
    const o=options||{},race=cohortRaceOptions(o),band=cohortLevelBand(o);
    const requested=Number.isInteger(o.n)?Math.max(0,o.n):8,n=Math.min(requested,candidates.length);
    const ids=new Set();
    for(const h of candidates){if(!h||!h.id||ids.has(h.id))throw new Error('候选身份重复或缺失');ids.add(h.id);horsePhysiology(h);}
    const references=band.map(level=>cohortReference(level,race,o.entryOverrides));
    const fast=Math.min(...references.map(r=>r.seconds)),slow=Math.max(...references.map(r=>r.seconds));
    const assessed=candidates.map((h,index)=>{
      const forecast=raceEntryForecast(h,race),inside=forecast.feasible&&forecast.seconds<=slow+1e-7;
      const distance=forecast.seconds>slow?forecast.seconds-slow:0;
      return {h,index,forecast,inside,distance};
    });
    const eligible=assessed.filter(x=>x.inside),selected=[];
    const available=eligible.slice();
    // 合格候选无放回报名；没有“八匹最接近”或指定冠军。
    while(selected.length<n&&available.length){const i=Math.min(available.length-1,Math.floor(rng()*available.length));selected.push(available.splice(i,1)[0]);}
    const fallback=n-selected.length;
    if(fallback){
      const rest=assessed.filter(x=>!x.inside).map(x=>({...x,tie:rng()})).sort((a,b)=>a.distance-b.distance||a.tie-b.tie||a.index-b.index);
      selected.push(...rest.slice(0,fallback));
    }
    return {horses:selected.map(x=>x.h),diagnostics:{version:COHORT_VERSION,race,levelBand:band,
      predictionWindow:{fastSeconds:fast,slowSeconds:slow},candidates:candidates.length,requested,selected:selected.length,
      eligibilityScope:'Caller filters decide age, wins/class and rest qualification; forecast only matches payable distance/grade readiness.',
      fastIsNotAdmissionCeiling:true,
      eligible:eligible.length,fallback,shortage:Math.max(0,requested-candidates.length),
      selection:'Payable entrants no slower than shared grade/distance reference: uniform without replacement. Faster entrants remain admissible. Scarcity: nearest slow boundary, explicitly reported. Qualification is determined by caller filters; no realized race simulation.',
      entries:selected.map(x=>({id:x.h.id,eligible:x.inside,forecast:{...x.forecast}}))}};
  }
  function makeRaceCandidatePool(rng, options) {
    const o=options||{},n=Number.isInteger(o.n)?o.n:32,band=cohortLevelBand(o),used=new Set(),horses=[];
    if(n<1||n>256)throw new Error('无效候选池规模');
    // 生成不读取比赛距离/赛道；相同 RNG、赛级和池规模对应相同个体。
    for(let i=0;i<n;i++){
      const level=band[0]+rng()*(band[1]-band[0]);
      const h=makeHorse(rng,{level,id:(o.idPrefix||'h')+(i+1),player:false});
      h.name=makeName(rng,used);h.sire=makeName(rng,used);h.dam=makeName(rng,used);
      applyCohortEntryOverrides(h,o.entryOverrides);horses.push(h);
    }
    return horses;
  }
`;
const field=String.raw`  function makeField(rng, opts) {
    const o=opts||{},n=o.n||8;
    if(!Number.isInteger(n)||n<1||n>64)throw new Error('无效阵容规模');
    // strongIndex 保留为玩家身份兼容选项，不再给能力或生理加点。
    const identityIndex=o.strongIndex!==undefined?o.strongIndex:Math.floor(rng()*n);
    const playerIndex=o.playerIndex!==undefined?o.playerIndex:identityIndex;
    const level=o.level!==undefined?o.level:62+Math.floor(rng()*17);
    const race=o.race||(Number.isFinite(o.length)||Number.isFinite(o.dist)?o:null);
    if(!race){
      const used=new Set(),horses=[];
      for(let i=0;i<n;i++){
        const h=makeHorse(rng,{level,id:(o.idPrefix||'h')+(i+1),player:i===playerIndex});
        h.name=makeName(rng,used);h.sire=makeName(rng,used);h.dam=makeName(rng,used);horses.push(h);
      }
      return horses;
    }
    const poolSize=Math.min(256,Math.max(n,n*COHORT_POOL_MULTIPLIER));
    const pool=makeRaceCandidatePool(rng,{n:poolSize,level,levelBand:o.levelBand,tierKey:o.tierKey,tierDef:o.tierDef,idPrefix:o.idPrefix,entryOverrides:o.entryOverrides});
    const player=Number.isInteger(playerIndex)&&playerIndex>=0&&playerIndex<pool.length?pool[playerIndex]:null;
    const result=selectRaceCohort(pool.filter(h=>h!==player),rng,{...o,level,race,n:n-(player?1:0)});
    const horses=result.horses;
    if(player){player.player=true;horses.splice(Math.min(playerIndex,horses.length),0,player);}
    Object.defineProperty(horses,'cohort',{value:{...result.diagnostics,playerReserved:player?.id||null},enumerable:false});
    return horses;
  }
`;
function changesFrom(source,indexSource){
 const changes=[],add=(file,old,newText,description)=>{assert.equal((file==='sim.js'?source:indexSource).split(old).length-1,1,'Expected exact unique source fragment: '+description);changes.push({file,old,new:newText,description});};
 add('sim.js',"    const values={forwardness:0.5+((s['出闸能力']??70)-(s['爆发力']??70))*0.006+(r()-0.5)*0.5,",String.raw`    // Mild full-support temperament prior; gate execution does not dictate intent.
    const values={forwardness:0.5-Math.sin(Math.asin(1-2*r())/3),`,'Independent full-support forward intention for newly generated or missing behavior; saved values remain authoritative');
 add('sim.js',"    const boost = o.tier === 'strong' ? 2 : (o.tier === 'weak' ? -2 : 0);","    const boost = 0; // 历史 tier 兼容，不为指定马制造能力优势。",'Remove artificial strong/weak stat advantage');
 add('sim.js','      h.wins >= (o.winsMin || 0) && h.wins <= (o.winsMax || 99) &&','      h.wins >= (o.winsMin || 0) && h.wins <= (o.winsMax !== undefined ? o.winsMax : 99) &&','Honor an explicit zero wins maximum in maiden qualification');
 const start=source.indexOf('  function makeField(rng, opts) {'),end=source.indexOf('\n  /* 兼容旧调用的返回形状',start);
 assert(start>0&&end>start);add('sim.js',source.slice(start,end),helpers+field,'Stable candidate pool, entry forecast and conditioned cohort');
 const careerStart=source.indexOf('  function makeCareerRaceField(h, tierDef, rng) {'),careerEnd=source.indexOf('    const playerEntry = {',careerStart);
 add('sim.js',source.slice(careerStart,careerEnd),String.raw`  function makeCareerRaceField(h, tierDef, rng, race) {
    horsePhysiology(h);
    const base=(tierDef.level[0]+tierDef.level[1])/2;
    const horses=makeField(rng,{n:7,level:base,tierDef,race,playerIndex:-1,idPrefix:'r'});
    for(const rh of horses){rh.age=h.age;rh.player=false;}
`,'Career opponents share distance and grade selection; preserve player migration');
 add('sim.js','      const field = makeCareerRaceField(h, t, rng);','      const field = makeCareerRaceField(h, t, rng, {length:dist,surface,state,dir,profile});','Career race passes actual conditions');
 add('sim.js','    const field = makeField(rng, { n: 8, level: t.level[0] + rng() * (t.level[1] - t.level[0]) });','    const field = makeField(rng, {n:8,level:t.level[0]+rng()*(t.level[1]-t.level[0]),tierDef:t,playerIndex:-1,race:{length:dist,surface,state,dir,profile}});','Featured race uses conditioned all-AI cohort');
 add('sim.js','    const n = Math.min(o.n || 8, pool.length);',String.raw`    const n = Math.min(o.n || 8, pool.length);
    if(o.race){
      const selected=selectRaceCohort(pool,rng,{...o,n});
      Object.defineProperty(selected.horses,'cohort',{value:selected.diagnostics,enumerable:false});
      return selected.horses;
    }`,'Existing roster filter plus stable physical entry selection');
 add('sim.js','      startsMax: spec.startsMax, abilityMin: spec.abilityMin, n: 8, cooldown: spec.cooldown,','      startsMax:spec.startsMax,abilityMin:spec.abilityMin,n:8,cooldown:spec.cooldown,\n      tierKey:spec.key===\'listed\'?\'open\':spec.key,race:{length:dist,course:venue,surface,state,dir,profile},','Scheduled race selects at actual venue and distance');
 add('sim.js','    const chosen = pickRosterField(roster, rng, weekNum, { ageMin: spec.ageMin, ageMax: spec.ageMax, winsMax: spec.winsMax, abilityMin, n: 8 });','    const chosen = pickRosterField(roster,rng,weekNum,{ageMin:spec.ageMin,ageMax:spec.ageMax,winsMax:spec.winsMax,abilityMin,n:8,tierKey:tierName===\'G1\'?\'g1\':tierName===\'G2\'?\'g2\':tierName===\'G3\'?\'g3\':key===\'maiden\'?\'maiden\':\'cond2\',race:{length:dist,surface,state,dir,profile}});','Weekly AI race selects from persistent roster by its conditions');
 add('sim.js','      const rivals = pickRosterField(roster, rng, weekNum, { ageMin: band[2], ageMax: band[3], abilityMin: band[0], abilityMax: band[1], n: 7 });','      const rivals = pickRosterField(roster,rng,weekNum,{ageMin:band[2],ageMax:band[3],abilityMin:band[0],abilityMax:band[1],n:7,tierKey:key,race:{length:dist,surface,state,dir,profile}});','Player roster race shares grade and actual distance');
 add('sim.js','    makeHorse, makeField, horseBehavior, racePlanFor, horsePhysiology, neutralPhysiology, PHYSIOLOGY_KEYS,','    makeHorse,makeField,makeRaceCandidatePool,raceEntryForecast,selectRaceCohort,COHORT_VERSION,COHORT_POOL_MULTIPLIER,horseBehavior,racePlanFor,horsePhysiology,neutralPhysiology,PHYSIOLOGY_KEYS,','Export cohort APIs');
 add('index.html','  field = S.makeField(rng, { n: 8 });','  field = S.makeField(rng, {n:8,race:singleRaceOptions()});','Only new single-race fields use current conditions; editing existing field does not regenerate');
 return changes;
}
const args=process.argv.slice(2),read=(name)=>fs.readFileSync(path.join(ROOT,name),'utf8').replace(/\r\n/g,'\n');
const current=read('sim.js'),page=read('index.html');
const reportPath=path.join(ROOT,'docs/cohort-selection-v11.json'),historyPath=path.join(ROOT,'docs/cohort-selection-v11-history');
// Never overwrite a real failed report when a source-signature regression is repaired.
if(fs.existsSync(reportPath)){
 const previousText=fs.readFileSync(reportPath,'utf8'),previous=JSON.parse(previousText);
 if(previous.integrity?.failed){
  fs.mkdirSync(historyPath,{recursive:true});
  const name=(previous.protocol?.engineHash||'unknown')+'-'+String(previous.generatedAt||'unknown').replace(/[:.]/g,'-')+'.json';
  const destination=path.join(historyPath,name);if(!fs.existsSync(destination))fs.writeFileSync(destination,previousText);
 }
}
let fixture;
if(args.includes('--write-fixture')){
 assert.equal(HASH(current),BASE_HASH,'Write fixture only against registered source');
 fixture={version:1,baseEngineHash:BASE_HASH,basePageHash:HASH(page),generatedAt:new Date().toISOString(),changes:changesFrom(current,page),
   notes:['Exact unique before/after replacements; root agent integrates production sequentially.','No legacy v9 helper changes. Use tests/helpers/race-cohort-v11.js for new formal generation.','Candidate generation ignores distance; selection never advances a race or reads realized outcomes.','Joint entry window is uncalibrated grade/distance population assumption; fallback is explicitly reported.']};
 fs.mkdirSync(path.dirname(fixturePath),{recursive:true});fs.writeFileSync(fixturePath,JSON.stringify(fixture,null,2)+'\n');console.log('Wrote '+fixturePath);
}
fixture=fixture||JSON.parse(fs.readFileSync(fixturePath,'utf8'));
let source=current;
if(!source.includes('  const COHORT_VERSION = 1;'))for(const change of fixture.changes.filter(x=>x.file==='sim.js')){assert.equal(source.split(change.old).length-1,1,'Integration fragment no longer unique: '+change.description);source=source.replace(change.old,change.new);}
if(args.includes('--admission-fixture'))source=require('./fixtures/race-cohort-admission-v11').applyAdmissionPatch(source);
const S=api(source),sourceHash=HASH(source),initialHash=HASH(current),tests=[],samples=[];
function test(name,f){try{f();tests.push({name,passed:true});console.log('PASS '+name);}catch(error){tests.push({name,passed:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}}
const race=(length)=>({length,course:'标准',surface:'草地',state:'良',dir:'左回',profile:'平坦',wind:0});
test('Default makeField retains shape, ids, chosen player and deterministic seed without strong advantage',()=>{
 const f=S.makeField(S.mulberry32(128),{n:8,level:70,strongIndex:2,playerIndex:2}),g=S.makeField(S.mulberry32(128),{n:8,level:70,strongIndex:7,playerIndex:2});
 assert.equal(f.length,8);assert.deepEqual(f.map(h=>h.id),Array.from({length:8},(_,i)=>'h'+(i+1)));assert.equal(f.filter(h=>h.player).length,1);assert.equal(f[2].player,true);assert.deepEqual(f,g);
 const normal=S.makeHorse(S.mulberry32(22),{id:'tier-equal',level:70,tier:'normal'}),strong=S.makeHorse(S.mulberry32(22),{id:'tier-equal',level:70,tier:'strong'});assert.deepEqual(normal,strong);
});
test('Stable candidate generation does not read race distance or relabel identity',()=>{
 const a=S.makeRaceCandidatePool(S.mulberry32(903),{n:40,level:86,race:race(1200)}),b=S.makeRaceCandidatePool(S.mulberry32(903),{n:40,level:86,race:race(3200)});assert.deepEqual(a,b);assert.equal(new Set(a.map(h=>h.id)).size,40);
});
test('Selection is deterministic, without replacement, and preserves existing attributes and profiles',()=>{
 const pool=S.makeRaceCandidatePool(S.mulberry32(931),{n:64,level:70}),before=clone(pool);
 const a=S.selectRaceCohort(pool,S.mulberry32(505),{n:16,level:70,race:race(1200)}),b=S.selectRaceCohort(pool,S.mulberry32(505),{n:16,level:70,race:race(1200)});
 assert.deepEqual(a,b);assert.deepEqual(pool,before);assert.equal(a.horses.length,16);assert.equal(new Set(a.horses.map(h=>h.id)).size,16);
 for(const h of a.horses)assert.equal(pool.find(x=>x.id===h.id),h);
});
test('Selected cohort has physical joint window and disclosed scarcity, not a hidden perfect packet',()=>{
 const pool=S.makeRaceCandidatePool(S.mulberry32(4981),{n:64,level:70});
 for(const length of [1200,2400,3200]){const r=S.selectRaceCohort(pool,S.mulberry32(618),{n:16,level:70,race:race(length)}),d=r.diagnostics;
  assert.equal(d.selected,16);assert.equal(d.entries.filter(x=>!x.eligible).length,d.fallback);assert.equal(d.shortage,0);
  assert.equal(d.fastIsNotAdmissionCeiling,true);assert.match(d.eligibilityScope,/Caller filters/);
  for(const e of d.entries.filter(x=>x.eligible))assert(e.forecast.feasible&&e.forecast.seconds<=d.predictionWindow.slowSeconds+1e-7);
  samples.push({length,...d,ids:r.horses.map(h=>h.id)});
 }
 assert(samples[0].predictionWindow.fastSeconds!==samples[2].predictionWindow.fastSeconds);
});
test('Out-of-band sparse pool retains honest fallback and never fabricates new horses',()=>{
 const pool=S.makeRaceCandidatePool(S.mulberry32(6),{n:3,level:35}),r=S.selectRaceCohort(pool,S.mulberry32(44),{n:8,level:90,race:race(2400)});
 assert.equal(r.horses.length,3);assert.equal(r.diagnostics.shortage,5);assert.equal(r.diagnostics.fallback,3);assert(r.horses.every(h=>pool.includes(h)));
});
test('Forecast ignores realized place/time and does not mutate input or consume caller RNG',()=>{
 const h=S.makeHorse(S.mulberry32(123),{id:'forecast-immutable',level:70}),before=clone(h),f=S.raceEntryForecast(h,race(2000)),poison=clone(h);
 Object.assign(poison,{place:1,time:1,final600:1,history:[{place:1,time:1,dist:2000}],wins:999});
 assert.deepEqual(S.raceEntryForecast(poison,race(2000)),f);assert.deepEqual(h,before);
});
test('Entry forecast counts the start delay exactly once in shared route integration',()=>{
 const h=S.makeHorse(S.mulberry32(1294),{id:'once-delay',level:70}),entry=clone(h),options=race(1200);
 S.horsePhysiology(entry);entry.behavior=S.horseBehavior(entry);
 const forecast=S.raceEntryForecast(h,options),r=S.createRace([entry],{...options,rng:()=>.5}),H=r.race.horses[0];
 H.t=r.race.geo.referenceLane;H.targetT=H.t;
 const shared=H.finishPlan(forecast.requestedV,0);
 assert(H.startDelay>0);assert.equal(forecast.seconds,shared.seconds,'Shared finish time already contains launch delay');
 const withDelay=shared.seconds;H.startDelay=0;const immediate=H.finishPlan(forecast.requestedV,0);
 assert(withDelay>immediate.seconds,'Delayed horse must not cross before identical immediate launch');
});
test('Forecast and selection never step the engine or secretly use race results',()=>{
 const stepPattern=/function step\(dt(?:,onTick)?\)\s*\{/g;assert.equal([...source.matchAll(stepPattern)].length,1);
 const noStep=api(source.replace(stepPattern,matched=>matched+" throw new Error('COHORT_STEP_FORBIDDEN');"));
 const pool=noStep.makeRaceCandidatePool(noStep.mulberry32(832),{n:16,level:70});
 assert.throws(()=>noStep.createRace(pool,{...race(2000),rng:noStep.mulberry32(44)}).step(1/60),/COHORT_STEP_FORBIDDEN/,
   'The mutant guard must actually intercept step before any physical tick');
 assert.equal(noStep.selectRaceCohort(pool,noStep.mulberry32(92),{n:8,level:70,race:race(2000)}).horses.length,8);
});
test('Legacy roster migration persists before selection and survives JSON roundtrip across distances',()=>{
 const roster=S.makeRoster(S.mulberry32(20261003));for(const h of roster)delete h.physiology;
 S.pickRosterField(roster,S.mulberry32(32),10,{n:8,race:race(1200)});const migrated=clone(roster);
 S.pickRosterField(roster,S.mulberry32(33),10,{n:8,race:race(3200)});assert.deepEqual(roster,migrated);
 const recovered=JSON.parse(JSON.stringify(roster));S.pickRosterField(recovered,S.mulberry32(33),10,{n:8,race:race(3200)});assert.deepEqual(recovered,roster);
});
test('Cohort field reserves same player identity across distances without stat or physiology replacement',()=>{
 const a=S.makeField(S.mulberry32(716),{n:8,level:70,playerIndex:2,race:race(1200)}),b=S.makeField(S.mulberry32(716),{n:8,level:70,playerIndex:2,race:race(3200)}),p=a.find(h=>h.player),q=b.find(h=>h.player);
 assert.equal(p.id,q.id);assert.deepEqual(p.stats,q.stats);assert.deepEqual(p.physiology,q.physiology);assert.equal(a.filter(h=>h.player).length,1);assert.equal(b.filter(h=>h.player).length,1);
 const noPlayer=S.makeField(S.mulberry32(716),{n:16,level:70,playerIndex:-1,race:race(1200)});assert(noPlayer.every(h=>!h.player));assert.equal(noPlayer.length,16);
});
test('Career callers condition opponents and preserve old player phenotype without adding save requirements',()=>{
 const h=S.makeCareerHorse(S.mulberry32(995)),profile=clone(S.horsePhysiology(h)),stats=clone(h.stats);
 const field=S.makeCareerRaceField(h,S.TIER_BY_KEY.maiden,S.mulberry32(770),race(1600));assert.equal(field.length,8);assert.deepEqual(field.find(x=>x.player).physiology,profile);assert.deepEqual(h.stats,stats);
 const options=S.raceOptionsFor(h,S.mulberry32(42));assert(options.every(r=>r.field.length===8));assert.deepEqual(h.physiology,profile);
});
test('Tier keys condition bounds but do not mutate the same horse across grades',()=>{
 const h=S.makeHorse(S.mulberry32(980),{id:'same-across-class',level:70}),copy=clone(h);
 const low=S.selectRaceCohort([h],S.mulberry32(1),{n:1,tierKey:'maiden',race:race(2000)}),high=S.selectRaceCohort([h],S.mulberry32(1),{n:1,tierKey:'g1',race:race(2000)});
 assert.deepEqual(h,copy);assert.notDeepEqual(low.diagnostics.levelBand,high.diagnostics.levelBand);
});
test('Entry overrides preserve generation RNG and latent identity before physical selection',()=>{
 const overrides={surface:'草地',special:'左右皆可','斗志':50,'疲劳':0,jockeyGrade:'优秀',bodyMass:480,carriedWeight:58},a=S.makeRaceCandidatePool(S.mulberry32(908),{n:32,level:86}),b=S.makeRaceCandidatePool(S.mulberry32(908),{n:32,level:86,entryOverrides:overrides});
 for(let i=0;i<a.length;i++){assert.equal(a[i].id,b[i].id);assert.equal(a[i].name,b[i].name);assert.deepEqual(a[i].stats,b[i].stats);assert.deepEqual(a[i].physiology,b[i].physiology);assert.deepEqual(a[i].behavior,b[i].behavior);for(const [k,v]of Object.entries(overrides))assert.equal(b[i][k],v);}
 const f=S.makeField(S.mulberry32(990),{n:16,level:86,playerIndex:-1,race:race(2400),entryOverrides:overrides});for(const e of f.cohort.entries)assert.deepEqual(e.forecast,S.raceEntryForecast(f.find(h=>h.id===e.id),race(2400)));
});
test('Explicit v11 equal-ability diagnostic uses same selected identities and frozen latent profiles',()=>{
 const fieldFor=require('./helpers/race-cohort-v11').fieldFor,base={n:16,length:2400,course:'标准',dir:'左回',seed:773,context:'healthy-flat'},a=fieldFor(base,S),b=fieldFor({...base,context:'equal-ability-flat'},S);
 assert.deepEqual(a.map(h=>h.id),b.map(h=>h.id));for(let i=0;i<a.length;i++){assert.deepEqual(a[i].physiology,b[i].physiology);assert.deepEqual(a[i].behavior,b[i].behavior);assert(Object.values(b[i].stats).every(x=>x===70));}
});
test('Stronger payable G1 candidate retains nonzero uniform matching support and no fast-side fallback penalty',()=>{
 require('./cohort-admission-v11').strongerCandidateMatch(S);
});
test('Legacy saved elite can pass real G1 roster qualification while age, wins and rest exclusions remain effective',()=>{
 require('./cohort-admission-v11').persistentStrongRosterEntry(S);
});
test('Maiden winsMax zero excludes an already-winning horse before forecast matching',()=>{
 require('./cohort-admission-v11').maidenZeroWinQualification(S);
});
const report={generatedAt:new Date().toISOString(),protocol:{scope:'Mechanism, population constraints and save/seed compatibility; no race-fit or coefficient-search claim.',source:'Current source with exact review fixture in memory unless production already integrated.',baseEngineHash:initialHash,engineHash:sourceHash,fixtureHash:HASH(fs.readFileSync(fixturePath,'utf8')),testRaces:'Zero actual race steps; forecast-only physical route integration.'},
 integrity:{complete:tests.length===17,passed:tests.filter(x=>x.passed).length,failed:tests.filter(x=>!x.passed).length,productionSourceUnchanged:HASH(read('sim.js'))===initialHash,pageSourceUnchanged:HASH(read('index.html'))===HASH(page)},tests,samples};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.integrity));
if(report.integrity.failed||!report.integrity.productionSourceUnchanged||!report.integrity.pageSourceUnchanged)process.exitCode=1;
