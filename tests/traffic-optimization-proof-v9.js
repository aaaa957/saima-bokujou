#!/usr/bin/env node
'use strict';
// Targeted regressions against the final repaired-heading numerical snapshot.
// Production source is not rewritten.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const zlib=require('node:zlib'),Module=require('node:module');
const registry=require('./helpers/v9-numeric-snapshot');
const ROOT=path.resolve(__dirname,'..'),filename=path.join(ROOT,'sim.proof-snapshot.js');
const proposal={BASE_HASH:'ac9dc7f3f8d9a6bf001ad6aef979021b3e7d59a9c5d5cdf36dd7884182f99d84',OPTIMIZED_HASH:registry.NUMERIC_HASH,
  archivePath:path.join(ROOT,'docs/system-heading-source-ac9dc7-v9.js.gz')};
const baseline=zlib.gunzipSync(fs.readFileSync(proposal.archivePath)).toString('utf8');
const candidate=registry.source();
const marker='      // 横移提案同步审核；两匹相向并道不得分别对照旧位置获得许可。';
function compile(source,fullReference=false,exposeBounds=false) {
  if(fullReference) {
    const from=source.indexOf('        const ownScale=',source.indexOf('      function followingSlack('));
    const to=source.indexOf('        const own=brakingTrajectory(move)',from);
    assert(from>=0&&to>from);
    source=source.slice(0,from)+'        const ownScale=laneProgressCoef(move.s,move.t,geo);\n        const response=(1/60)*move.v*ownScale;\n        const paired=new WeakMap();\n'+source.slice(to);
    source=source.replaceAll('if(withResponse&&closest-response<-1e-7)','if(false&&closest-response<-1e-7)');
  }
  assert.equal(source.split(marker).length,2);
  source=source.replace(marker,'      race.__trafficProof={followingSlack};\n'+marker);
  if(exposeBounds)source=source.replace('    laneArcDistance, laneAdvance, laneArcBreakpoints,','    __routeCellRangeBounds:routeCellRangeBounds, laneArcDistance, laneAdvance, laneArcBreakpoints,');
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(ROOT);loaded._compile(source,filename);return loaded.exports;
}
function closure(S) {
  const field=S.makeField(S.mulberry32(1),{n:2,level:70});
  const race=S.createRace(field,{length:3200,course:'京都芝外A',profile:'平坦',surface:'草地',state:'良',rng:S.mulberry32(77)});
  const [rear,front]=race.race.horses;
  for(const h of [rear,front]){h.v=30;h.aerobic=100000;h.aerobicOutput=100000;h.startDelay=0;h.control={targetV:30,targetT:h.t};}
  rear.s=-100;front.s=400;race.step(1/60);return {S,rear,front,race};
}
const before=closure(compile(baseline,true)),after=closure(compile(candidate,false,true));
const move={s:2439.442042261362,t:20.743864823458715,v:24.594258279073983};
const frontMove={s:2445.5443668222056,t:4.080691074253991,v:24.624965896829963};
const full=before.race.race.__trafficProof.followingSlack(before.rear,before.front,{...move},{...frontMove},false);
const response=move.v*after.S.laneProgressCoef(move.s,move.t,after.race.race.geo)/60;
const responseFirst=after.race.race.__trafficProof.followingSlack(after.rear,after.front,{...move},{...frontMove},true);
const physical=after.race.race.__trafficProof.followingSlack(after.rear,after.front,{...move},{...frontMove},false);
assert(responseFirst>=0&&responseFirst<=full-response+1e-6,'A future positive heading gain cannot be prepaid at the left endpoint');
assert(physical>=0&&physical<=full+1e-6);
// Clockwise Hermite cell: signed metric curvature is negative, while the
// engine body-projection curvature intentionally clamps negative values to zero.
const curvature=-.02,step=.5;
function point(s){const a=curvature*s;return{x:Math.sin(a)/curvature,y:(1-Math.cos(a))/curvature,tx:Math.cos(a),ty:Math.sin(a),k:curvature};}
const owner={samples:[point(0),point(step)]},bound=after.S.__routeCellRangeBounds(owner,step,0,step);
assert(bound.signedMax<0,'Negative signed curvature must survive in physical metric bounds');
function component(p0,p1,v0,v1,acc0,acc1,f) {
  const A=p0,B=step*v0,C=.5*step*step*acc0,p=p1-A-B-C,v=step*v1-B-2*C,acc=step*step*acc1-2*C;
  const D=10*p-4*v+.5*acc,E=-15*p+7*v-acc,F=6*p-3*v+.5*acc;
  return{v:((((5*F*f+4*E)*f+3*D)*f+2*C)*f+B)/step,a:(((20*F*f+12*E)*f+6*D)*f+2*C)/(step*step)};
}
let negativeSignedPointChecks=0,negativeLaneChecks=0;
const [a,b]=owner.samples;
for(let i=0;i<=1000;i++) {
  const f=i/1000,x=component(a.x,b.x,a.tx,b.tx,-a.k*a.ty,-b.k*b.ty,f),y=component(a.y,b.y,a.ty,b.ty,a.k*a.tx,b.k*b.tx,f);
  const metric=Math.hypot(x.v,y.v),k=(x.v*y.a-y.v*x.a)/(metric*metric*metric);
  assert(k<0&&k>=bound.signedMin&&k<=bound.signedMax);assert(metric>=bound.minMetric&&metric<=bound.maxMetric);negativeSignedPointChecks++;
  for(const t of [.3,1.4,31]) {
    const d=t-1.4,actual=metric*(1+d*k),lower=bound.minMetric*Math.min(1+d*bound.signedMin,1+d*bound.signedMax),upper=bound.maxMetric*Math.max(1+d*bound.signedMin,1+d*bound.signedMax);
    assert(lower>0&&actual>=lower&&actual<=upper);
    const projectionLower=bound.minMetric*Math.min(1+d*Math.max(0,bound.signedMin),1+d*Math.max(0,bound.signedMax));
    assert(projectionLower<=metric*(1+d*Math.max(0,k)));negativeLaneChecks++;
  }
}
const report={baselineHash:proposal.BASE_HASH,engineHash:proposal.OPTIMIZED_HASH,productionFileModified:false,
  headingGainRegression:{move,frontMove,fullPhysicalSlack:full,response,responseFirst,physical,
    historicalFailedCandidateHash:'21e13ceddf9a041f295201d905ac8019dc85de5329584b21b8567b8892733a04',
    historicalFailedResponse:10.688591442284851,historicalFailedPhysical:11.05339219464113,
    cause:'Endpoint positive heading gain was used as a lower bound for the entire interval. The left endpoint earns zero heading change; the corrected bound includes zero.'},
  negativeCurvatureRegression:{curvature,step,bound,negativeSignedPointChecks,negativeLaneChecks},passed:true,
  scope:'Targeted certificate regressions plus a synthetic clockwise Hermite cell; this does not claim a measured course or exhaustive floating-point proof.'};
const outputIndex=process.argv.indexOf('--out');
if(outputIndex>=0)fs.writeFileSync(path.resolve(ROOT,process.argv[outputIndex+1]),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
