#!/usr/bin/env node
'use strict';
// Read-only independent safety review. No engine file is rewritten: both variants
// are compiled from separate frozen snapshots. The repaired-heading baseline
// contains none of the candidate's cell/adaptive certificates.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Module=require('node:module'),crypto=require('node:crypto');
const zlib=require('node:zlib'),args=process.argv.slice(2);
const argument=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const registry=require('./helpers/v9-numeric-snapshot');
const enginePath=path.resolve(__dirname,'../sim.js'),sourcePath=path.resolve(__dirname,'..',argument('--source-archive',registry.archivePath));
const referencePath=path.resolve(__dirname,'..',argument('--reference-source','docs/system-heading-source-ac9dc7-v9.js.gz'));
const readArtifact=file=>{const b=fs.readFileSync(file);return(b[0]===0x1f&&b[1]===0x8b?zlib.gunzipSync(b):b).toString('utf8');};
const readSource=()=>readArtifact(sourcePath),referenceSource=readArtifact(referencePath);
const raw=readSource();
const digest=source=>crypto.createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
const engineHash=digest(raw),sourceArtifact={path:sourcePath,kind:args.includes('--source-archive')?'explicit-artifact':'frozen-numeric-artifact',contentHash:engineHash};
const referenceSourceArtifact={path:referencePath,contentHash:digest(referenceSource),kernel:'Repaired-heading baseline; original full-domain query without candidate cell/adaptive certificates.'};
assert.equal(referenceSourceArtifact.contentHash,'ac9dc7f3f8d9a6bf001ad6aef979021b3e7d59a9c5d5cdf36dd7884182f99d84','Full reference must use the reviewed repaired-heading snapshot');
assert(!referenceSource.includes('certifyInterval(')&&!referenceSource.includes('trafficRouteIntervalBounds('),'Reference contains candidate certificates');
if(args.includes('--check-source')){console.log(JSON.stringify({sourceArtifact,referenceSourceArtifact,engineHash}));process.exit(0);}
const criticalPerCourse=Number(argument('--critical-per-course',25));
assert(Number.isInteger(criticalPerCourse)&&criticalPerCourse>=1&&criticalPerCourse<=1000);
const expectedHash=argument('--expected-hash',null);if(expectedHash)assert.equal(engineHash,expectedHash);
const injectionMarker='      // 横移提案同步审核；两匹相向并道不得分别对照旧位置获得许可。';
assert.equal(raw.split(injectionMarker).length,2,'Closure instrumentation marker changed; review this harness before running.');
function compile(reference){
 let source=reference?referenceSource:raw;
 if(reference){
  const start=source.indexOf('      function followingSlack(');
  const from=source.indexOf('        const ownScale=',start);
  const to=source.indexOf('        const own=brakingTrajectory(move)',from);
  assert(start>=0&&from>start&&to>from,'Full-domain reference markers changed; do not silently leave fast paths enabled.');
  // All safety fast paths must precede this marker. Keep an isolated pair cache
  // for the final result assignment, but omit every cached-return/early-exit.
  source=source.slice(0,from)+'        const ownScale=laneProgressCoef(move.s,move.t,geo);\n        const response=(1/60)*move.v*ownScale;\n        const paired=new WeakMap();\n'+source.slice(to);
  // These three witness exits are safe for classification but do not return
  // the complete minimum; disable them in the comparison module as well.
  source=source.replaceAll('if(withResponse&&closest-response<-1e-7)','if(false&&closest-response<-1e-7)');
 }
 source=source.replace(injectionMarker,
  '      race.__trafficReview={followingSlack,bodyClearance,stoppingEnd};\n'+injectionMarker);
 const module=new Module(enginePath);module.filename=enginePath;module.paths=Module._nodeModulePaths(path.dirname(enginePath));
 module._compile(source,enginePath);return module.exports;
}
const S=compile(false),referenceS=compile(true),rng=S.mulberry32(11857003),tolerance=1e-6;
const routes=[['标准',2000],['東京芝A',2000],['東京芝A',1600],['京都芝外A',3200]];
const boundLayouts=Object.keys(S.COURSES).map(key=>[key,2000]);
boundLayouts.push(['東京芝A',1600],['京都芝外A',1600],['京都芝外A',1800],['京都芝外A',3200]);
let coefficientChecks=0,maximumCoefficientRatio=0,physicalMetricChecks=0,maximumPhysicalMetricRatio=0;
for(const [course,length] of boundLayouts){
 const g=S.trackGeometry(length,course,'草地');
 const regions=g.route?[g.route.loop.stations.map(s=>s-g.startOffset),
  ...(g.route.chute?[Array.from({length:g.route.chute.samples.length},(_,i)=>i*g.route.chute.step)]:[])]:
  [Array.from({length:10001},(_,i)=>i*g.lap/10000)];
 for(const points of regions)for(let i=0;i<points.length-1;i++)for(const f of [0,.25,.5,.75,1])for(const t of [.3,g.referenceLane,g.width-.3]){
  const s=points[i]+(points[i+1]-points[i])*f,value=S.laneProgressCoef(s,t,g);
  assert(Number.isFinite(value)&&value>0,'Invalid legal-lane progress coefficient');
  assert(value<=g.progressCoefUpperBound+1e-12,JSON.stringify({course,length,s,t,value,bound:g.progressCoefUpperBound}));
  assert(value>=g.progressCoefLowerBound-1e-12,'Progress coefficient lower bound exceeds a legal-lane sample');
  // Sparse independent arc differences also exercise the signed-heading
  // metric; body-projection curvature itself is clamped nonnegative.
  if(i%20===0){
   const metric=S.laneArcDistance(s-.001,s+.001,t,g)/.002,ratio=metric*g.progressCoefLowerBound;
   assert(metric>0&&ratio<=1+1e-7,'Signed physical arc exceeds absolute-offset metric upper bound');
   maximumPhysicalMetricRatio=Math.max(maximumPhysicalMetricRatio,ratio);physicalMetricChecks++;
  }
  maximumCoefficientRatio=Math.max(maximumCoefficientRatio,value/g.progressCoefUpperBound);coefficientChecks++;
 }
}
function closure(engine,course,length){
 const entries=engine.makeField(engine.mulberry32(1),{n:2,level:70});
 const r=engine.createRace(entries,{length,course,profile:'平坦',surface:'草地',state:'良',rng:engine.mulberry32(77)});
 const [rear,front]=r.race.horses;
 // Supply is enlarged only to initialize a future-domain probe horizon of 30m/s;
 // these two horses do not constitute a gameplay race or a realism observation.
 for(const h of [rear,front]){h.v=30;h.aerobic=100000;h.aerobicOutput=100000;h.startDelay=0;h.control={targetV:30,targetT:h.t};}
 rear.s=-100;front.s=400;r.step(1/60);
 assert(r.race.__trafficReview,'Instrumented closure was not captured');
 return {rear,front,geo:r.race.geo,probe:r.race.__trafficReview};
}
const reports=[];
for(const [course,length] of routes){
 const optimized=closure(S,course,length),reference=closure(referenceS,course,length);
 const {rear:H,front:F,geo:g,probe:p}=optimized,{probe:rp}=reference;
 const boundaries=g.boundaries.map(b=>b.s),bendStarts=g.boundaries.filter(b=>b.kind==='bendStart');
 const nodes=g.route?[...g.route.loop.stations.map(s=>s-g.startOffset),
  ...(g.route.chute?Array.from({length:g.route.chute.samples.length},(_,i)=>i*g.route.chute.step):[])]:[];
 const report={course,length,randomCases:100,criticalCases:criticalPerCourse,cases:[],
  maximumFullDomainOptimism:-Infinity,maximumPositiveFastPathOptimism:-Infinity,
  fastPathChangedResults:0,negativeFastPathCases:0,positiveFastPathCases:0,
  fullDomainInteriorMinima:0,maximumResponseCacheError:0,standaloneNegativeResponseResults:0};
 for(let j=0;j<100+criticalPerCourse;j++){
  const critical=j>=100;
  let s=j<25?(boundaries[j%Math.max(1,boundaries.length)]??100)+(rng()-.5)*40:
   j<50&&nodes.length?nodes[Math.floor(rng()*nodes.length)]+(rng()-.5)*.5:rng()*length;
  if(j%10===0&&g.route?.chute)s=rng()*g.route.startLength;
  if(critical)s=(bendStarts[j%Math.max(1,bendStarts.length)]?.s??100)-rng()*65;
  const t=critical?g.width-.3:.3+rng()*(g.width-.6);
  const ft=critical?t:j%3===0?.3+rng()*(g.width-.6):Math.max(.3,Math.min(g.width-.3,t+(rng()-.5)*1.3));
  const v=critical?16+rng()*8:10+rng()*17;
  const fv=critical?v+.02+rng()*.6:j%4===0?10+rng()*17:v+(rng()-.5)*2;
  const gap=critical?3.02+rng():j>=90?100+rng()*100:2.9+rng()*15;
  const move={s,t,v},frontMove={s:s+gap,t:ft,v:fv};
  const observed=p.followingSlack(H,F,move,frontMove,false);
  const withResponse=p.followingSlack(H,F,move,frontMove,true),response=v*S.laneProgressCoef(s,t,g)/60;
  const cacheError=Math.abs(observed-withResponse-response);
  assert(cacheError<1e-10,'Cached withResponse variants differ beyond the explicit response margin');
  report.maximumResponseCacheError=Math.max(report.maximumResponseCacheError,cacheError);
  const complete=rp.followingSlack(reference.rear,reference.front,{...move},{...frontMove},false);
  assert(Number.isFinite(observed)&&Number.isFinite(complete));
  // A negative witness shortcut may return a non-minimal upper bound when the
  // response-aware query runs first. It must reject only an unsafe domain and
  // must not poison a later no-response query with a partial positive value.
  const responseMove={...move},responseFront={...frontMove};
  const standaloneResponse=p.followingSlack(H,F,responseMove,responseFront,true);
  const afterResponse=p.followingSlack(H,F,responseMove,responseFront,false);
  assert(Number.isFinite(standaloneResponse)&&Number.isFinite(afterResponse));
  if(standaloneResponse>=-1e-8){
   assert(complete-response>=-1e-7,'Response-first early query approved an unsafe full domain');
   assert(standaloneResponse<=complete-response+tolerance,'Positive response-first query is not conservative');
  }else{
   report.standaloneNegativeResponseResults++;
   assert(complete-response<=tolerance,'Negative witness rejected a safe response-aware full domain');
  }
  if(afterResponse>=-1e-8){
   assert(complete>=-1e-7,'Response-first partial cache caused an unsafe no-response approval');
   assert(afterResponse<=complete+tolerance,'Response-first cache did not retain a conservative full-domain bound');
  }
  if(observed>=-1e-8)assert(complete>=-1e-7,'Unsafe positive approval from a fast path: '+JSON.stringify({course,length,move,frontMove,observed,complete}));
  if(observed>0){
   report.maximumPositiveFastPathOptimism=Math.max(report.maximumPositiveFastPathOptimism,observed-complete);
   assert(observed<=complete+tolerance,'Positive fast path exceeds full-domain minimum: '+JSON.stringify({course,length,move,frontMove,observed,complete}));
  }
  if(Math.abs(observed-complete)>tolerance){
   report.fastPathChangedResults++;
   if(observed<0){report.negativeFastPathCases++;assert(complete<0,'Negative fast path rejected a full-domain safe state');}
   else report.positiveFastPathCases++;
  }
  let fine=Infinity,minTime=0,at=0,rs=s,fs=s+gap;
  const stop=Math.max(v,fv)/S.RACE_F.braking,step=.005;
  const first=gap-p.bodyClearance(H,F,rs,fs,t,ft).longitudinal;
  while(at<=stop+1e-9){
   const value=fs-rs-p.bodyClearance(H,F,rs,fs,t,ft).longitudinal;
   if(value<fine){fine=value;minTime=at;}
   const next=Math.min(stop,at+step);if(next<=at)break;
   const rv0=Math.max(0,v-S.RACE_F.braking*at),rv1=Math.max(0,v-S.RACE_F.braking*next);
   const fv0=Math.max(0,fv-S.RACE_F.braking*at),fv1=Math.max(0,fv-S.RACE_F.braking*next);
   rs=S.laneAdvance(rs,(rv0+rv1)*(next-at)/2,t,g);fs=S.laneAdvance(fs,(fv0+fv1)*(next-at)/2,ft,g);at=next;
  }
  const last=fs-rs-p.bodyClearance(H,F,rs,fs,t,ft).longitudinal,optimism=complete-fine;
  assert(optimism<=tolerance,'Full-domain root search missed a sampled interior minimum: '+JSON.stringify({course,length,move,frontMove,complete,fine,minTime,optimism}));
  if(fine<Math.min(first,last)-tolerance)report.fullDomainInteriorMinima++;
  report.maximumFullDomainOptimism=Math.max(report.maximumFullDomainOptimism,optimism);
  report.cases.push({kind:critical?'near-bend-critical':'random',s,t,ft,v,fv,gap,observed,complete,fine,minTime,
   fullDomainOptimism:optimism,fastPathDifference:observed-complete,standaloneResponse,afterResponse});
 }
 reports.push(report);
 console.log(JSON.stringify({course,length,cases:report.cases.length,maximumFullDomainOptimism:report.maximumFullDomainOptimism,
  fullDomainInteriorMinima:report.fullDomainInteriorMinima,fastPathChangedResults:report.fastPathChangedResults}));
}
assert.equal(engineHash,digest(readSource()),'Selected source artifact changed during review; results are not a frozen-source verification');
assert.equal(referenceSourceArtifact.contentHash,digest(readArtifact(referencePath)),'Reference source artifact changed during review');
const output={engineHash,sourceArtifact,referenceSourceArtifact,protocol:{sourceArtifact,referenceSourceArtifact},sourceUnchangedDuringRun:true,referenceSourceUnchangedDuringRun:true,seed:11857003,randomCases:400,criticalCases:criticalPerCourse*4,
 totalCases:reports.reduce((sum,r)=>sum+r.cases.length,0),fineGridSeconds:.005,toleranceMeters:tolerance,
 method:'Compile the candidate and a separate repaired-heading baseline snapshot in memory. The reference has no new cell/adaptive certificates; its old followingSlack fast-path prefix/cache and negative-witness exits are disabled. Capture tick closures; compare fresh motion identities, response cache variants, and independent 5ms finite-braking stepping via public laneAdvance/body projection. No production mutation or game race calibration.',
 mathematicalClaim:'Quintic Bezier derivative control polygons enclose velocity and acceleration. Positive tangent projection bounds |r\u2032| below; ||v||upper*||a||upper/||v||lower^3 bounds absolute signed curvature above. For modeled t>=0.3, reference lane 1.4, laneBias in [0,1], the inner-offset denominator bounds clamped body-projection progress coefficients. An upper reference metric times (1+maximum absolute legal-lane offset*curvatureUpper) bounds the signed physical lane metric; the new physical-gap lower proof also requires both offset margins 1-|offset|*curvatureUpper>0. The identity G(t)=G(0)+dFront-dRear+(tRear-tFront)*headingChangeFront, together with equal finite braking and the absolute heading bound, yields a conservative progress-gap lower bound. Positive stopping-end and physical-gap fast exits therefore prove safety without asserting monotone relative progress.',
 numericalClaim:'The local derivative/root search is checked on this finite deterministic state sample against 5ms times. It is not an interval proof of every future time, lane, speed, or Hermite-cell extremum. A negative early result may be an upper bound used only to reject feasibility, rather than the exact global minimum.',
 coefficientChecks,maximumCoefficientRatio,physicalMetricChecks,maximumPhysicalMetricRatio,reports};
const outputPath=path.resolve(__dirname,argument('--out','../docs/traffic-domain-review-v9.json'));
fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({output:outputPath,engineHash,totalCases:output.totalCases,coefficientChecks,
 maximumFullDomainOptimism:Math.max(...reports.map(r=>r.maximumFullDomainOptimism)),
 maximumPositiveFastPathOptimism:Math.max(...reports.map(r=>r.maximumPositiveFastPathOptimism))}));
