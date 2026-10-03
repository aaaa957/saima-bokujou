#!/usr/bin/env node
'use strict';
// No production edits or fitted parameters. Archived populations are decomposed
// first; 12 original solo reproductions + 12 one-horse, locked-command boost
// interventions preserve the original 16-horse denominator and all other times.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {api,fieldFor,HASH,q,distribution:D,DIST}=require('./system-reality-v9');
const {S:B,source:baselineSource,engineHash:baselineHash}=require('./helpers/frozen-v8');
const numeric=require('./helpers/v9-numeric-snapshot');
const {replaySolo,aggregate}=require('./tempo-system-v9');
const ROOT=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x)),START=Date.now();
const expectedProduction='51caabc1395b62a325f3048aa923994516310d8c69665f3fd17b89978615b82a';
const production=fs.readFileSync(path.join(ROOT,'sim.js'),'utf8');
assert.equal(HASH(production),expectedProduction,'Production source changed before diagnosis');
const sourceVerification=numeric.verify(),S=api(numeric.source()),inputs={};
function load(key,name){const full=path.join(ROOT,name),raw=fs.readFileSync(full),text=(name.endsWith('.gz')?zlib.gunzipSync(raw):raw).toString('utf8');inputs[key]={path:name,uncompressedHash:HASH(text),fileSha256:crypto.createHash('sha256').update(raw).digest('hex')};return JSON.parse(text);}
const current=load('current','docs/system-current-v2026.10.02.3.json.gz');
const old=load('baseline','docs/system-baseline-v2026.10.02.3.json.gz');
const extra=load('current2022','docs/system-current-external2022-v2026.10.02.3.json.gz');
const oldExtra=load('baseline2022','docs/system-baseline-external2022-v2026.10.02.3.json.gz');
const tempo=load('tempo','docs/tempo-system-v9.json'),paths=load('path','docs/path-isolation-v9.json');
const real=load('realPrimary','docs/current-engine-reality-sources-2026-10-02.json');
const realExtra=load('real2022','docs/system-external-reference-2022.json');
const covariance=load('covariance','docs/pace-covariance-v9.json');
const previousComparison=load('previousComparison','docs/system-reality-comparison-v2026.10.02.3.json');
for(const doc of [current,extra,tempo,paths])assert.equal(doc.engineHash,numeric.NUMERIC_HASH);
for(const doc of [old,oldExtra])assert.equal(doc.engineHash,baselineHash());
for(const doc of [current,extra,old,oldExtra])assert(doc.integrity.complete&&doc.integrity.allFinish&&doc.integrity.allFinite&&doc.integrity.sourceUnchanged&&(doc.errors||[]).length===0);
assert(tempo.integrity.complete&&tempo.samples.length===12&&paths.integrity.complete&&paths.rows.length===12);
assert.equal(paths.tempoInputHash,inputs.tempo.uncompressedHash);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const variance=a=>a.length?a.reduce((s,x)=>s+(x-mean(a))**2,0)/a.length:null;
const cov=(a,b)=>a.length?a.reduce((s,x,i)=>s+(x-mean(a))*(b[i]-mean(b)),0)/a.length:null;
const rho=(a,b)=>a.length>=3&&variance(a)>0&&variance(b)>0?cov(a,b)/Math.sqrt(variance(a)*variance(b)):null;
const range=a=>a.length?Math.max(...a)-Math.min(...a):null;
const ranks=a=>a.map(x=>1+a.filter(y=>y<x).length+(a.filter(y=>y===x).length-1)/2);
const spearman=(a,b)=>rho(ranks(a),ranks(b));
const keys=['tailSeconds','within1','within2','final600Span','rhoPrefixFinal600','rhoFirst200Final600','rhoFirst200Finish','rhoPrefixFinish','rhoFinal600Finish',
 'winnerFinal600RankFraction','winnerPrefixRankFraction','winnerFastestFinal600','winnerFastestPrefix','variancePrefix','varianceFinal600','varianceFinish','cancelIndex',
 'first200Range','middleRange','prefixRange','finishRange','partialVarianceFirst200','partialVarianceMiddle','partialVarianceFinal600'];
function decomposition(horses,timeKey='time',round=false){
 const started=horses.filter(h=>h.isStarter!==false),all=started.filter(h=>Number.isFinite(h[timeKey])),h=all.filter(h=>Number.isFinite(h.final600)),r=x=>round?Math.round(x*10)/10:x;
 const T=h.map(x=>r(x[timeKey])),F=h.map(x=>r(x.final600)),A=T.map((t,i)=>t-F[i]);
 const E=h.map(x=>Number.isFinite(x.first200)?r(x.first200):null),validE=E.every(Number.isFinite),M=validE?A.map((a,i)=>a-E[i]):[];
 const best=Math.min(...all.map(x=>r(x[timeKey]))),knownWinner=h.findIndex(x=>(x.place??x.finishPosition)===1),wi=knownWinner>=0?knownWinner:T.indexOf(Math.min(...T)),vT=variance(T),vA=variance(A),vF=variance(F),cAF=cov(A,F);
 // Cov(component,T) sum exactly to Var(T); signed contributions are not
 // causal shares. First200 is unavailable per individual in JRA references.
 return {nEntries:horses.length,nNonStarters:horses.length-started.length,nStarted:started.length,nWithoutFiniteFinish:started.length-all.length,nFiniteFinishers:all.length,nPaired:h.length,tailSeconds:range(all.map(x=>r(x[timeKey]))),
  within1:all.filter(x=>r(x[timeKey])-best<=1+1e-9).length/all.length,within2:all.filter(x=>r(x[timeKey])-best<=2+1e-9).length/all.length,
  within1Starters:all.filter(x=>r(x[timeKey])-best<=1+1e-9).length/started.length,within2Starters:all.filter(x=>r(x[timeKey])-best<=2+1e-9).length/started.length,
  final600Span:range(F),rhoPrefixFinal600:rho(A,F),rhoFirst200Final600:validE?rho(E,F):null,rhoFirst200Finish:validE?rho(E,T):null,
  rhoPrefixFinish:rho(A,T),rhoFinal600Finish:rho(F,T),winnerFinal600RankFraction:(ranks(F)[wi]-1)/Math.max(1,h.length-1),
  winnerPrefixRankFraction:(ranks(A)[wi]-1)/Math.max(1,h.length-1),winnerFastestFinal600:F[wi]===Math.min(...F)?1:0,winnerFastestPrefix:A[wi]===Math.min(...A)?1:0,
  variancePrefix:vA,varianceFinal600:vF,varianceFinish:vT,cancelIndex:-2*cAF/(vA+vF),first200Range:validE?range(E):null,
  middleRange:validE?range(M):null,prefixRange:range(A),finishRange:range(T),
  partialVarianceFirst200:validE&&vT>0?cov(E,T)/vT:null,partialVarianceMiddle:validE&&vT>0?cov(M,T)/vT:null,partialVarianceFinal600:vT>0?cov(F,T)/vT:null,
  varianceIdentityError:Math.abs(vT-(vA+vF+2*cAF))};
}
const summarise=rows=>Object.fromEntries(keys.map(k=>[k,D(rows.map(r=>r[k]))]));
const summariseFields=(rows,ks)=>Object.fromEntries(ks.map(k=>[k,D(rows.map(r=>r[k]))]));
const pkeys=['maxV','cruise','aerobic','capacity','reservePower','tau','economy','startDelay','fatMult','speedStat','staminaStat','burstStat','gateStat','fatigue','bodyMass','carriedWeight'];
const axes=['endurance','power','economy','kinetics','durability'];
function params(job){const field=fieldFor(job,B,S),race=S.createRace(field,{length:job.length,course:job.course,dir:job.dir,surface:'草地',state:job.state||'良',profile:'平坦',wind:0,rng:S.mulberry32(job.raceSeed)});
 const strongIndex=Math.floor(B.mulberry32(job.seed)()*job.n);
 return race.race.horses.map((h,i)=>({id:h.id,strong:i===strongIndex,physiology:clone(h.physiology),stats:clone(h.adj),
  maxV:h.maxV,cruise:h.cruise,aerobic:h.aerobic,capacity:h.staminaMax,reservePower:h.reservePower,tau:h.aerobicTau,economy:h.economy,startDelay:h.startDelay,fatMult:h.fatMult,
  speedStat:h.adj['速度'],staminaStat:h.adj['耐力'],burstStat:h.adj['爆发力'],gateStat:h.adj['出闸能力'],fatigue:h.h['疲劳'],bodyMass:h.bodyMass,carriedWeight:h.carriedWeight,
  declaredStyle:h.style,planPosition:h.plan.position,forwardness:h.behavior.forwardness}));}
const matrix=current.samples.map(job=>{const p=params(job);p.forEach((x,i)=>{assert.equal(x.id,job.horses[i].id);assert.deepEqual(x.physiology,job.horses[i].physiology);assert.deepEqual(x.stats,job.horses[i].stats);
 for(const [k,s] of [['aerobic','aerobic'],['capacity','capacity'],['reservePower','reservePower'],['tau','tau']])assert.equal(x[k],job.horses[i].physiologicalParameters[s]);});
 const d=decomposition(job.horses),corr=Object.fromEntries(pkeys.flatMap(k=>[
  [k+'VsFinish',rho(p.map(h=>h[k]),job.horses.map(h=>h.time))],
  [k+'VsPrefix',rho(p.map(h=>h[k]),job.horses.map(h=>h.time-h.final600))],
  [k+'VsFinal600',rho(p.map(h=>h[k]),job.horses.map(h=>h.final600))]]));
 for(const axis of axes){corr[axis+'VsFinish']=rho(p.map(h=>h.physiology[axis]),job.horses.map(h=>h.time));corr[axis+'VsFinal600']=rho(p.map(h=>h.physiology[axis]),job.horses.map(h=>h.final600));}
 const strong=job.horses[p.findIndex(h=>h.strong)],best=job.horses.find(h=>h.place===1);
 return {job:Object.fromEntries(['context','id','n','length','seed','raceSeed','replicate'].map(k=>[k,job[k]??null])),decomposition:d,
  parameters:p,correlations:corr,strong:{id:strong.id,won:strong.place===1,timeGap:strong.time-best.time,place:strong.place},
  parameterRanges:Object.fromEntries(pkeys.map(k=>[k,range(p.map(h=>h[k]))]))};});
const contexts=[...new Set(matrix.map(r=>r.job.context))];
const population=contexts.flatMap(context=>DIST.map(length=>{const group=matrix.filter(r=>r.job.context===context&&r.job.length===length),actual=current.samples.filter(r=>r.context===context&&r.length===length);
 return {context,length,raceCount:group.length,nValues:[...new Set(group.map(r=>r.job.n))],outcomes:summarise(group.map(r=>r.decomposition)),
  parameters:Object.fromEntries(pkeys.map(k=>[k,D(group.flatMap(r=>r.parameters.map(h=>h[k])))])),ranges:summariseFields(group.map(r=>r.parameterRanges),pkeys),
  correlations:summariseFields(group.map(r=>r.correlations),Object.keys(group[0].correlations)),strongWins:group.filter(r=>r.strong.won).length,
  strongWinFraction:group.filter(r=>r.strong.won).length/group.length,uniformChanceMean:mean(group.map(r=>1/r.job.n)),
  speedCapSpearmanVsTime:D(group.map(r=>spearman(r.parameters.map(p=>p.maxV),actual.find(j=>j.seed===r.job.seed&&j.n===r.job.n).horses.map(h=>h.time))))};}));
const populationByFieldSize=[...new Set(matrix.map(r=>r.job.context+'|'+r.job.n+'|'+r.job.length))].map(key=>{const [context,nText,lengthText]=key.split('|'),n=Number(nText),length=Number(lengthText),g=matrix.filter(r=>r.job.context===context&&r.job.n===n&&r.job.length===length);return {context,n,length,raceCount:g.length,
 outcomes:summarise(g.map(r=>r.decomposition)),strongWins:g.filter(r=>r.strong.won).length,strongWinFraction:g.filter(r=>r.strong.won).length/g.length,
 parameterRanges:summariseFields(g.map(r=>r.parameterRanges),pkeys),correlations:summariseFields(g.map(r=>r.correlations),Object.keys(g[0].correlations))};});
const realCases=[...real.races.map(r=>({...r,context:'external',set:'2023–2025'})),...realExtra.races.map(r=>({...r,context:'external2022',set:'2022'}))];
const matched=realCases.map(ref=>{const rowsFor=arm=>[...(arm==='current'?current:old).samples,...(arm==='current'?extra:oldExtra).samples].filter(r=>r.context===ref.context&&String(r.id)===String(ref.id));
 assert.equal(ref.horses.filter(h=>h.isStarter!==false).length,ref.fieldSize,'Official starter denominator differs from fieldSize');
 const simulated=arm=>{const rows=rowsFor(arm);assert.equal(rows.length,3);const d=rows.map(r=>{const m=decomposition(r.horses,'time',true);for(const k of ['tailSeconds','within1','within2','final600Span'])m[k]=r[k];return m;});return {runs:d,median:Object.fromEntries(keys.map(k=>[k,q(d.map(x=>x[k]))]))};};
 return {id:ref.id,length:ref.length,set:ref.set,source:ref.source?.url,real:decomposition(ref.horses,'finishTime',true),baseline:simulated('baseline'),current:simulated('current')};});
for(const r of matched){const oldRow=[...previousComparison.alreadyViewed2023to2025.paired,...previousComparison.newlyFrozen2022.paired].find(x=>String(x.id)===String(r.id));assert(oldRow);for(const arm of ['real','baseline','current'])for(const key of ['tailSeconds','within1','within2','final600Span'])assert.equal(arm==='real'?r.real[key]:r[arm].median[key],oldRow[arm][key],'Outcome convention differs from original '+r.id+'/'+arm+'/'+key);}
const winnerRelations=group=>Object.fromEntries(['real','baseline','current'].map(arm=>[arm,{winnerFastestFinal600Fraction:mean(group.map(r=>arm==='real'?r.real.winnerFastestFinal600:mean(r[arm].runs.map(x=>x.winnerFastestFinal600)))),
 winnerFastestPrefixFraction:mean(group.map(r=>arm==='real'?r.real.winnerFastestPrefix:mean(r[arm].runs.map(x=>x.winnerFastestPrefix))))}]));
const official={count:matched.length,rows:matched,winnerRelations:winnerRelations(matched),byDistance:DIST.map(length=>{const group=matched.filter(r=>r.length===length);return {length,eventCount:group.length,winnerRelations:winnerRelations(group),
 arms:{real:summarise(group.map(r=>r.real)),baseline:summarise(group.map(r=>r.baseline.median)),current:summarise(group.map(r=>r.current.median))}};}),
 all:{real:summarise(matched.map(r=>r.real)),baseline:summarise(matched.map(r=>r.baseline.median)),current:summarise(matched.map(r=>r.current.median))}};
const hp=current.samples.filter(r=>r.context==='healthy-flat'),ep=current.samples.filter(r=>r.context==='equal-ability-flat');
const attributePairs=hp.map(h=>{const e=ep.find(x=>x.length===h.length&&x.seed===h.seed&&x.raceSeed===h.raceSeed&&x.n===h.n);assert(e);let changed=0,maxAxisDifference=0;
 for(let i=0;i<h.n;i++){assert.equal(h.horses[i].id,e.horses[i].id);assert.deepEqual(h.horses[i].behavior,e.horses[i].behavior);
  const diffs=axes.map(k=>Math.abs(h.horses[i].physiology[k]-e.horses[i].physiology[k]));if(diffs.some(x=>x>0))changed++;maxAxisDifference=Math.max(maxAxisDifference,...diffs);}
 return {length:h.length,seed:h.seed,raceSeed:h.raceSeed,n:h.n,physiologyProfilesChanged:changed,maxAxisDifference,
  pairedDifferenceHealthyMinusEqual:Object.fromEntries(['tailSeconds','within1','within2','final600Span'].map(k=>[k,h[k]-e[k]]))};});
const attributes={pairs:attributePairs.length,profilesChanged:attributePairs.reduce((s,r)=>s+r.physiologyProfilesChanged,0),profilesCompared:attributePairs.reduce((s,r)=>s+r.n,0),
 maxAxisDifference:Math.max(...attributePairs.map(r=>r.maxAxisDifference)),
 warning:'Equal-ability resets stats before v8 legacy migration. physiologySeed includes initial stats; latent profiles also change. This comparison is a joint input intervention, never pure attribute homogenization.',
 byDistance:DIST.map(length=>{const group=attributePairs.filter(r=>r.length===length);return {length,pairs:group.length,pairedDifferences:summariseFields(group.map(r=>r.pairedDifferenceHealthyMinusEqual),['tailSeconds','within1','within2','final600Span'])};}),rows:attributePairs};
function labelStats(rows,select){const horses=rows.flatMap(r=>r.horses.map(h=>({...h,label:select(h,r)})));return ['逃','先','差','追'].map(label=>{const h=horses.filter(x=>x.label===label);return {label,starts:h.length,wins:h.filter(x=>x.place===1).length,winFraction:h.length?h.filter(x=>x.place===1).length/h.length:null};});}
const styleRows=current.samples.filter(r=>r.context==='native-official').map(r=>({...r,parameters:matrix.find(x=>x.job.context===r.context&&x.job.length===r.length&&x.job.seed===r.seed&&x.job.n===r.n).parameters}));
const labels={scope:'Native official courses, without pooling external synthetic G1 cohorts. Declared style, early/middle mean rank, and snapshot rank use different definitions; labels never enter physics.',
 byDistance:DIST.map(length=>{const group=styleRows.filter(r=>r.length===length);let disagree=0,count=0;const matrix={};for(const r of group)for(const h of r.horses){count++;if(h.observedStyle!==h.straightStyle)disagree++;const key=h.observedStyle+'→'+h.straightStyle;matrix[key]=(matrix[key]||0)+1;}
  return {length,raceCount:group.length,disagreement:disagree/count,confusion:matrix,
   declared:labelStats(group,(h,r)=>r.parameters.find(p=>p.id===h.id).declaredStyle),observed:labelStats(group,h=>h.observedStyle),straight:labelStats(group,h=>h.straightStyle)};})};
const pathDiagnosis={byDistance:DIST.map(length=>{const group=paths.rows.filter(r=>r.job.length===length),t=tempo.samples.filter(r=>r.job.length===length);return {length,raceCount:group.length,
 routeOriginalMinusInner:summariseFields(group.map(r=>r.differences),['tailSeconds','within1','within2','final600Span','first200']),
 trafficCrowdMinusOriginalSolo:summariseFields(t.map(r=>Object.fromEntries(Object.keys(r.differences).map(k=>[k,r.differences[k].crowdMinusSolo]))),['tailSeconds','within1','within2','final600Span','first200']),
 normalMinusNeutral:summariseFields(t.map(r=>Object.fromEntries(Object.keys(r.differences).map(k=>[k,r.differences[k].normalMinusNeutral]))),['tailSeconds','within1','within2','final600Span','first200']),
 individualRouteTime:D(group.flatMap(r=>r.horses.map(h=>h.originalMinusInnerTime))),individualRouteFinal600:D(group.flatMap(r=>r.horses.map(h=>h.originalMinusInnerFinal600))),
 gateVsRouteLoss:D(group.map(r=>rho(r.horses.map(h=>h.gate),r.horses.map(h=>h.originalMinusInnerTime)))),
 originalSolo:summarise(group.map(r=>decomposition(r.horses.map(h=>h.originalSolo)))),innerSolo:summarise(group.map(r=>decomposition(r.horses.map(h=>h.sameInnerLine))))};})};
function cv(a){const m=mean(a);return a.length?Math.sqrt(variance(a))/m:null;}
function leaderSelection(horses){
 const sectionalCount=horses[0].sectionals.length;
 const leaders=Array.from({length:sectionalCount},(_,i)=>horses.reduce((a,b)=>b.sectionals[i].time<a.sectionals[i].time?b:a).id);
 const crossings=Array.from({length:sectionalCount},(_,i)=>Math.min(...horses.map(h=>h.sectionals[i].time)));
 const leaderSplits=crossings.map((x,i)=>x-(crossings[i-1]||0)),winner=horses.reduce((a,b)=>b.time<a.time?b:a);
 const individual=h=>cv(h.sectionals.slice(1).map(s=>Math.round(s.split*10)/10));
 return {leaderCv:cv(leaderSplits.slice(1).map(x=>Math.round(x*10)/10)),winnerCv:individual(winner),
  individualCvMedian:q(horses.map(individual)),individualCvP90:q(horses.map(individual),.9),individualCvRange:range(horses.map(individual)),
  leaderIdentities:leaders,leaderChanges:leaders.slice(1).filter((x,i)=>x!==leaders[i]).length,
  leaderVsWinnerCv:cv(leaderSplits.slice(1).map(x=>Math.round(x*10)/10))-individual(winner),
  leaderVsIndividualMedianCv:cv(leaderSplits.slice(1).map(x=>Math.round(x*10)/10))-q(horses.map(individual))};
}
const leaderSelectionDiagnosis={protocol:'Each per-horse split is the same 200m reference progress distance. Leader times are minimum cumulative crossing times, then differenced; never the minimum individual split. Post200 splits individually rounded to 0.1s before CV. Reference progress is not equal physical distance on different lanes.',
 rows:tempo.samples.map(r=>({job:r.job,crowd:leaderSelection(r.crowd.horses),solo:leaderSelection(r.solo.horses),neutral:leaderSelection(r.neutral.horses),
  inner:leaderSelection(paths.rows.find(p=>p.job.length===r.job.length&&p.job.seed===r.job.seed).horses.map(h=>h.sameInnerLine))})),
 byDistance:DIST.map(length=>{const t=tempo.samples.filter(r=>r.job.length===length),p=paths.rows.filter(r=>r.job.length===length),ks=['leaderCv','winnerCv','individualCvMedian','individualCvP90','leaderChanges','leaderVsWinnerCv','leaderVsIndividualMedianCv'];return {length,raceCount:t.length,
  crowd:summariseFields(t.map(r=>leaderSelection(r.crowd.horses)),ks),solo:summariseFields(t.map(r=>leaderSelection(r.solo.horses)),ks),neutral:summariseFields(t.map(r=>leaderSelection(r.neutral.horses)),ks),
  inner:summariseFields(p.map(r=>leaderSelection(r.horses.map(h=>h.sameInnerLine))),ks)};})};
// Counterfactual generator exact tier substitution, never written to disk.
const oldTier="tier: i === strongIdx ? 'strong' : 'normal',";assert.equal(baselineSource.split(oldTier).length-1,1);
const noStrongSource=baselineSource.replace(oldTier,"tier: 'normal',"),BNoStrong=api(noStrongSource),boostRows=[],failures=[];
for(const row of tempo.samples){const {job}=row,strongIndex=Math.floor(B.mulberry32(job.seed)()*job.n),field=fieldFor(job,B,S),unboosted=fieldFor(job,BNoStrong,S),index=strongIndex;
 // Lock all axes to the already-observed originals BEFORE changing stats.
 for(let i=0;i<job.n;i++)field[i].physiology=clone(row.crowd.horses[i].physiology);
 const reconstructed={field,initial:clone(row.crowd.initial),horses:clone(row.crowd.horses)};
 try{const reproduction=replaySolo(job,reconstructed,index,S),original=row.solo.horses[index];
  for(const key of ['time','final600','sectionals','physiology','physiologicalParameters','reserveFraction','retention','frames','extendedSeconds'])assert.deepEqual(reproduction[key],original[key]);
  const noBoost=clone(reconstructed);noBoost.field[index].stats=clone(unboosted[index].stats);
  assert.deepEqual(noBoost.field[index].physiology,reconstructed.field[index].physiology);assert.deepEqual(noBoost.field[index].behavior,reconstructed.field[index].behavior);
  const cf=replaySolo(job,noBoost,index,S),otherFieldsExact=noBoost.field.every((h,i)=>i===index||JSON.stringify(h)===JSON.stringify(field[i]));assert(otherFieldsExact);
  const inserted=row.solo.horses.map((h,i)=>i===index?cf:clone(h)),before=aggregate(row.solo.horses),after=aggregate(inserted);assert.equal(inserted.length,job.n);
  boostRows.push({job,strongHorse:original.id,originalReproductionExact:true,physiologyLocked:true,behaviorLocked:true,otherInputFieldsExact:otherFieldsExact,
   originalStats:field[index].stats,noBoostStats:noBoost.field[index].stats,original:reproduction,counterfactual:cf,
   originalMinusNoBoostTime:original.time-cf.time,originalMinusNoBoostFinal600:original.final600-cf.final600,
   fieldTimesInserted:{before,after,difference:Object.fromEntries(['tailSeconds','within1','within2','final600Span','winnerTime'].map(k=>[k,before[k]-after[k]]))}});
  console.log('Boost audit '+boostRows.length+'/12 '+job.length+'m h'+(index+1)+' '+((Date.now()-START)/1000).toFixed(1)+'s');
 }catch(e){failures.push({job,strongIndex,error:e.stack});}
}
const boost={protocol:'Only originally designated strong horse loses generator tier boost. All original physiology axes, behavior, identity, reaction delay, gate/lane start state and wall-clock commands stay fixed; no traffic, drafting or AI replanning. Replace ONLY that horse in the original 16 solo results. This diagnoses the direct executed effect of a synthetic one-horse boost, not a full-crowd equilibrium or real winner selection.',
 generatorHash:baselineHash(),counterfactualGeneratorHash:HASH(noStrongSource),exactGeneratorChange:{old:oldTier,current:"tier: 'normal',"},rows:boostRows,failures,
 summary:{raceGroups:boostRows.length,originalReproductions:boostRows.length,newSoloInterventions:boostRows.length,
  strongHorseTimeEffect:D(boostRows.map(r=>r.originalMinusNoBoostTime)),strongHorseFinal600Effect:D(boostRows.map(r=>r.originalMinusNoBoostFinal600)),
  fieldInsertionDifferences:summariseFields(boostRows.map(r=>r.fieldTimesInserted.difference),['tailSeconds','within1','within2','final600Span','winnerTime'])},
 byDistance:DIST.map(length=>{const group=boostRows.filter(r=>r.job.length===length);return {length,raceCount:group.length,timeEffect:D(group.map(r=>r.originalMinusNoBoostTime)),final600Effect:D(group.map(r=>r.originalMinusNoBoostFinal600)),fieldInsertionDifferences:summariseFields(group.map(r=>r.fieldTimesInserted.difference),['tailSeconds','within1','within2','final600Span','winnerTime'])};})};
const inputHomogenization={protocol:'Exactly two predefined tempo jobs: lengths1200/2400, replicate0, original16horses. Independent solos with common physical inner lane, all original wall-clock speed commands, start delay, gates and behavior. Baseline comes from exact archived inner-line replay. Stats arm assigns each of 8 physical attributes its original-field arithmetic mean (blood trait unchanged), while preserving original latent profiles. Physiology arm assigns five neutral axes while preserving original attributes. Whole-field realized competition is NOT rerun; no latent/attribute joint intervention; no fitted range or desired outcome.',
 rows:[],failures:[]};
for(const original of tempo.samples.filter(r=>[1200,2400].includes(r.job.length)&&r.job.replicate===0)){
 const {job}=original,oldPath=paths.rows.find(r=>r.job.length===job.length&&r.job.replicate===job.replicate),lane=oldPath.referenceLane;
 const field=fieldFor(job,B,S);for(let i=0;i<job.n;i++)field[i].physiology=clone(original.crowd.horses[i].physiology);
 const baseline={field,initial:original.crowd.initial.map(h=>({...clone(h),t:lane,targetT:lane})),horses:original.crowd.horses.map(h=>({...clone(h),commands:h.commands.map(c=>[c[0],c[1],lane,c[3]])}))};
 try{const reproduction=replaySolo(job,baseline,0,S),stored=oldPath.horses[0].sameInnerLine;
  for(const k of ['time','final600','sectionals','physiology','physiologicalParameters','reserveFraction','retention','frames','extendedSeconds'])assert.deepEqual(reproduction[k],stored[k]);
  const statKeys=['速度','耐力','出闸能力','爆发力','力量','毅力','智力','体格'],means=Object.fromEntries(statKeys.map(k=>[k,mean(field.map(h=>h.stats[k]))]));
  const arms={baseline:oldPath.horses.map(h=>clone(h.sameInnerLine))};
  for(const arm of ['statsHomogeneous','physiologyNeutral']){
   const variant=clone(baseline);
   for(let i=0;i<job.n;i++){if(arm==='statsHomogeneous'){Object.assign(variant.field[i].stats,means);assert.deepEqual(variant.field[i].physiology,baseline.field[i].physiology);}else{variant.field[i].physiology=S.neutralPhysiology();assert.deepEqual(variant.field[i].stats,baseline.field[i].stats);}assert.deepEqual(variant.field[i].behavior,baseline.field[i].behavior);}
   arms[arm]=variant.horses.map((_,i)=>replaySolo(job,variant,i,S));
  }
  const metrics=Object.fromEntries(Object.entries(arms).map(([arm,h])=>[arm,aggregate(h)]));
  const d=Object.fromEntries(Object.entries(arms).map(([arm,h])=>[arm,decomposition(h)]));
  inputHomogenization.rows.push({job,referenceLane:lane,originalInnerReproductionExact:true,attributeMeans:means,horses:arms,metrics,decomposition:d,
   maxIndividualPrefixTimeChange:Object.fromEntries(['statsHomogeneous','physiologyNeutral'].map(arm=>[arm,Math.max(...arms[arm].map((h,i)=>Math.abs((h.time-h.final600)-(arms.baseline[i].time-arms.baseline[i].final600))))])),
   baselineMinusIntervention:Object.fromEntries(['statsHomogeneous','physiologyNeutral'].map(arm=>[arm,Object.fromEntries(['tailSeconds','within1','within2','final600Span','winnerTime'].map(k=>[k,metrics.baseline[k]-metrics[arm][k]]))]))});
  console.log('Homogenization '+job.length+'m: 1 reproduction + 32 isolated solos complete '+((Date.now()-START)/1000).toFixed(1)+'s');
 }catch(error){inputHomogenization.failures.push({job,error:error.stack});}
}
const maxIdentityError=Math.max(...matrix.map(r=>r.decomposition.varianceIdentityError),...matched.map(r=>r.real.varianceIdentityError));
const newRuns=[...boostRows.flatMap(r=>[r.original,r.counterfactual]),...inputHomogenization.rows.flatMap(r=>[...r.horses.statsHomogeneous,...r.horses.physiologyNeutral])];
const newRunMaxWorkError=Math.max(0,...newRuns.map(r=>r.workBalanceError)),newRunMaxReserveError=Math.max(0,...newRuns.map(r=>r.reserveBalanceError)),newRunMaxUnpaid=Math.max(0,...newRuns.map(r=>r.unpaidWork));
assert(newRuns.every(h=>[h.time,h.final600,h.reserveFraction,h.retention].every(Number.isFinite)));assert(newRunMaxWorkError<1e-6&&newRunMaxReserveError<1e-6&&newRunMaxUnpaid<1e-6);
const inputsUnchanged=Object.values(inputs).every(v=>{const raw=fs.readFileSync(path.join(ROOT,v.path)),text=(v.path.endsWith('.gz')?zlib.gunzipSync(raw):raw).toString('utf8');return HASH(text)===v.uncompressedHash&&crypto.createHash('sha256').update(raw).digest('hex')===v.fileSha256;});
const sourceUnchanged=HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'))===expectedProduction;
const report={generatedAt:new Date().toISOString(),productionEngineHash:expectedProduction,numericalEngineHash:numeric.NUMERIC_HASH,baselineEngineHash:baselineHash(),sourceVerification,inputs,
 protocol:{noParameterFitting:true,productionEdits:false,aggregation:'Within-race descriptive statistics, median across 3 replicates per official event, then equal-weight event summaries. Population context summaries median per race. Correlations are observations, not causal attribution. Conditional/distance selection is not implemented in either synthetic cohort.',
   round:'For covariance and winner split-rank comparison simulated T/B independently quantized0.1s, exactly matching old pace-covariance. Main simulated tailSeconds/within1/within2/final600Span instead retain native archived results, matching existing system-reality-comparison; source of outcome metrics and covariance precision explicitly differ. Reference has per-horse first200 missing. Main within1/within2 include winner and use finite-finishers denominator, matching existing realStats. Separate within1Starters/within2Starters preserve actual-starting-field denominator for sensitivity; scratches excluded from both. Missing official final600 excluded only from covariance. All controlled synthetic arms have16 finite finishers, preserving the original16-horse denominator.',
   archive:'All 270+18 old/current comparisons and tempo/path interventions remain attached to numeric hash 3b837b. Current source 51caabc is separately byte-inverse-verified; old rows are never re-labelled as reruns.',
   counts:{currentMain:current.samples.length,current2022:extra.samples.length,baselineMain:old.samples.length,baseline2022:oldExtra.samples.length,tempoRaceGroups:tempo.samples.length,pathRaceGroups:paths.rows.length,officialEvents:matched.length,newSoloReproductions:boostRows.length+inputHomogenization.rows.length,newSoloInterventions:boostRows.length+inputHomogenization.rows.length*32}},
 integrity:{complete:boostRows.length===12&&failures.length===0&&inputHomogenization.rows.length===2&&inputHomogenization.failures.length===0,sourceUnchanged,inputsUnchanged,allArchivedDataComplete:true,allPopulationParametersReconstructed:true,previousOutcomeConventionVerified:true,maxVarianceIdentityError:maxIdentityError,newRunMaxWorkError,newRunMaxReserveError,newRunMaxUnpaid},
 parameterReconstruction:{horseCount:matrix.reduce((s,r)=>s+r.parameters.length,0),source:'All input fields regenerated by exact frozen v8 RNG; numeric 3b createRace only, no step; IDs, adjusted attributes, every latent axis and four archived physiological parameters exactly verified for every horse. Detailed original horses are already in immutable source matrices; redundant per-horse parameters omitted from this result.'},
 official,population,populationByFieldSize,attributes,labels,pathDiagnosis,leaderSelectionDiagnosis,boost,inputHomogenization,matrix:matrix.map(({parameters,...row})=>row)};
assert(sourceUnchanged&&inputsUnchanged&&maxIdentityError<1e-8);fs.writeFileSync(path.join(ROOT,'docs/causal-population-paths-v10.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({integrity:report.integrity,boost:boost.summary,attributes:{pairs:attributes.pairs,profilesChanged:attributes.profilesChanged,profilesCompared:attributes.profilesCompared,maxAxisDifference:attributes.maxAxisDifference}},null,2));
if(!report.integrity.complete)process.exitCode=1;
