#!/usr/bin/env node
'use strict';
// A signed heading must remain continuous through an atan2 branch cut. These
// are arc/inverse invariants, not assertions copied from an unwrapping formula.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {api,HASH}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),option=(k,d)=>{const i=args.indexOf(k);if(i<0)return d;if(!args[i+1])throw new Error(k+' requires a value');return args[i+1];};
const sourcePath=path.resolve(ROOT,option('--source-archive','sim.js'));
const readSource=p=>{const b=fs.readFileSync(p);return(b[0]===0x1f&&b[1]===0x8b?zlib.gunzipSync(b):b).toString('utf8');};
const source=readSource(sourcePath),snapshotPath=path.join(ROOT,'docs/system-numeric-source-44b09f-v9.js.gz'),archived=readSource(snapshotPath);
assert.equal(HASH(archived),'44b09fc4789ccacf6cf812251effc8f3367e9f4996aa7b597886bd83d85ab6f1','Historical reproduction source changed');
if(args.includes('--check-source')){console.log(JSON.stringify({engineHash:HASH(source),sourceArtifact:sourcePath,archivedHash:HASH(archived)}));process.exit(0);}
function instrument(source){const marker='    mulberry32, clamp, pick, weightedPick,';assert.equal(source.split(marker).length,2,'Private geometry instrumentation marker changed');
  return api(source.replace(marker,'    __junctionReview:{loopHeadingAt,routeArcState,abstractArcState},\n'+marker));}
const EPS=[.1,.01,.001,.0001,.00001,.000001,.0000001,.00000001,.000000001,.0000000001,.00000000001,.000000000001];
const DENSE_EPS=Array.from({length:241},(_,i)=>10**(-13+i/24));
function review(engine){
  const layouts=Object.keys(engine.COURSES).map(course=>[course,2000]);layouts.push(['東京芝A',1600],['京都芝外A',1600],['京都芝外A',1800],['京都芝外A',3200]);
  const failures=[],summary={layouts:layouts.length,loopLayouts:0,abstractLayouts:0,chuteLayouts:0,headingChecks:0,denseHeadingChecks:0,arcChecks:0,inverseChecks:0,maxHeadingDifference:0,maxInverseError:0};
  function check(condition,detail){if(!condition)failures.push(detail);}
  function arcPair(g,from,to,detail){
    const stateAt=g.route?engine.__junctionReview.routeArcState:engine.__junctionReview.abstractArcState;
    const a=stateAt(from,g),b=stateAt(to,g),span=to-from;
    const angle=b.angle-a.angle,maxAngle=span*g.maxReferenceCurvature*g.maxReferenceMetric+1e-9;
    summary.headingChecks++;summary.maxHeadingDifference=Math.max(summary.maxHeadingDifference,Math.abs(angle));
    check(Math.abs(angle)<=maxAngle,{kind:'heading-discontinuity',...detail,from,to,angleDifference:angle,maximumAllowed:maxAngle,a,b});
    for(const lane of [.3,g.referenceLane,g.width-.3]){
      const offset=Math.abs(lane-g.referenceLane),upper=g.maxReferenceMetric*(1+offset*g.maxReferenceCurvature),lower=g.minReferenceMetric*(1-offset*g.maxReferenceCurvature);
      const distance=engine.laneArcDistance(from,to,lane,g);summary.arcChecks++;
      check(Number.isFinite(distance)&&distance>=Math.max(0,span*lower)-1e-7&&distance<=span*upper+1e-7,
        {kind:'physical-arc-discontinuity',...detail,from,to,lane,distance,minimumAllowed:Math.max(0,span*lower)-1e-7,maximumAllowed:span*upper+1e-7});
    }
  }
  for(const [course,length] of layouts){
    const g=engine.trackGeometry(length,course,'草地');if(g.route)summary.loopLayouts++;else summary.abstractLayouts++;
    const loop=g.route?.loop||{home:g.S,bend1:g.B,back:g.S,lap:g.lap},junctions=[['lap-start',0],['first-bend-start',loop.home],['first-bend-end',loop.home+loop.bend1],['last-bend-start',loop.home+loop.bend1+loop.back],['lap-end',loop.lap]];
    for(const [junction,q] of junctions){
      let center=q-g.startOffset;while(center-.1<(g.route?.startLength||0)+1)center+=g.lap;
      for(const epsilon of EPS){
        arcPair(g,center-epsilon,center+epsilon,{course,length,junction,epsilon});
        for(const at of [q-epsilon,q+epsilon]){
          if(!g.route)continue;
          const value=engine.__junctionReview.loopHeadingAt(at,loop),first=at>loop.home&&at<loop.home+loop.bend1,last=at>loop.home+loop.bend1+loop.back&&at<loop.lap;
          if(first||last){summary.headingChecks++;check(Number.isFinite(value)&&value>=(first?0:Math.PI)-1e-9&&value<=(first?Math.PI:2*Math.PI)+1e-9,
            {kind:'heading-outside-geometric-bend',course,length,junction,epsilon,q:at,value,expectedRange:first?[0,Math.PI]:[Math.PI,2*Math.PI]});}
        }
      }
      if(g.route)for(const epsilon of DENSE_EPS)for(const side of [-1,1]){
        const at=q+side*epsilon,first=at>loop.home&&at<loop.home+loop.bend1,last=at>loop.home+loop.bend1+loop.back&&at<loop.lap;
        if(!first&&!last)continue;
        const value=engine.__junctionReview.loopHeadingAt(at,loop);summary.denseHeadingChecks++;
        check(Number.isFinite(value)&&value>=(first?0:Math.PI)-1e-9&&value<=(first?Math.PI:2*Math.PI)+1e-9,
          {kind:'dense-heading-outside-geometric-bend',course,length,junction,epsilon,actualEpsilon:Math.abs(at-q),q:at,value,expectedRange:first?[0,Math.PI]:[Math.PI,2*Math.PI]});
      }
      // Query the true physical inverse near both sides, including the
      // microscopic branch window and distances large enough to cross it.
      for(const before of [-1e-4,-1e-7,-1e-8,-1e-9,1e-9,1e-8,1e-7,1e-4])for(const lane of [.3,g.referenceLane,g.width-.3])for(const distance of [.0001,.01,.1]){
        const from=center+before,at=engine.laneAdvance(from,distance,lane,g),actual=engine.laneArcDistance(from,at,lane,g),error=Math.abs(actual-distance);
        summary.inverseChecks++;summary.maxInverseError=Math.max(summary.maxInverseError,error);
        const lower=g.minReferenceMetric*(1-Math.abs(lane-g.referenceLane)*g.maxReferenceCurvature);
        check(Number.isFinite(at)&&at>=from&&error<2e-6&&(!(lower>0)||at-from<=distance/lower+1e-6),
          {kind:'physical-inverse-failure',course,length,junction,before,lane,requested:distance,from,at,actual,error});
      }
    }
    if(g.route?.chute){summary.chuteLayouts++;for(const [junction,center] of [['chute-start',0],['chute-merge',g.route.startLength]])for(const epsilon of EPS)arcPair(g,center-epsilon,center+epsilon,{course,length,junction,epsilon});}
  }
  summary.failureCount=failures.length;summary.byCourse=failures.reduce((a,f)=>(a[f.course]=(a[f.course]||0)+1,a),{});
  return{summary,failures};
}
const historical=review(instrument(archived)),current=review(instrument(source));
assert(historical.failures.some(f=>f.kind==='physical-arc-discontinuity'&&Math.abs(f.distance)>100),'Regression did not reproduce the historical2π/100m arc fault');
const report={engineHash:HASH(source),sourceArtifact:path.relative(ROOT,sourcePath),archivedHash:HASH(archived),protocol:{epsilonsMeters:EPS,denseHeadingEpsilonsMeters:DENSE_EPS,units:'Radians and route/physical meters',
  method:'Instrument immutable compiled modules in memory. Check continuous unwrapped heading, bounded small forward arc, and laneAdvance inverse near all geometric bend/straight/lap joins plus chute extensions/merges. Geometric angle ranges and metric/curvature envelopes are independent of the chosen unwrap implementation.',
  inverseToleranceMeters:2e-6,arcAbsoluteToleranceMeters:1e-7,angleAbsoluteToleranceRadians:1e-9,
  limitation:'Finite boundary and epsilon sampling; historical geometric layouts are synthetic proxies. This does not assert bit-exact gameplay before/after the required bug fix or a universal floating-point proof.'},
  historicalReproduction:historical,current,sourceUnchanged:HASH(readSource(sourcePath))===HASH(source)};
const output=path.resolve(ROOT,option('--out','docs/route-heading-junction-v9.json'));fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,engineHash:report.engineHash,historical:historical.summary,current:current.summary,sourceUnchanged:report.sourceUnchanged},null,2));
if(!report.sourceUnchanged||current.failures.length)process.exitCode=1;
