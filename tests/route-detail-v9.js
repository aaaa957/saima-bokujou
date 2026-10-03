#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const S=require('../sim');
let checks=0,maxReferenceError=0,maxLaneError=0,maxTangentError=0,maxArcIntegralError=0,maxInverseError=0,maxAdvanceCompositionError=0;
function near(a,b,tol,label){assert.ok(Math.abs(a-b)<=tol,`${label}: ${a} / ${b}`);checks++;}
function arc(g,from,to,lane,step=0.2){let length=0,a=S.trackPoint(from,lane,g,g.direction);const n=Math.ceil((to-from)/step);for(let i=1;i<=n;i++){const b=S.trackPoint(from+(to-from)*i/n,lane,g,g.direction);length+=Math.hypot(b.x-a.x,b.y-a.y);a=b;}return length;}
const keys=Object.keys(S.COURSES).filter(k=>S.COURSES[k].lap);
for(const key of keys){
  const def=S.COURSES[key],g=S.trackGeometry(2400,key,key.endsWith('泥')?'泥地':'草地'),loop=g.displaySegments[0];
  assert.equal(g.width,S.COURSE_WIDTHS[key][0]);assert.equal(g.widthRange[1],S.COURSE_WIDTHS[key][1]);checks+=2;
  for(const lane of [0.8,g.referenceLane,g.width-0.8]){
    const a=S.trackPoint(loop.from,lane,g,g.direction),b=S.trackPoint(loop.to,lane,g,g.direction);
    near(Math.hypot(a.x-b.x,a.y-b.y),0,1e-8,key+' closed rail');
  }
  const measured=arc(g,loop.from,loop.to,g.referenceLane),referenceError=Math.abs(measured-g.lap);maxReferenceError=Math.max(maxReferenceError,referenceError);
  near(measured,g.lap,0.035,key+' reference physical arc length');
  const inside=arc(g,loop.from,loop.to,1),outside=arc(g,loop.from,loop.to,12),laneError=Math.abs(outside-inside-2*Math.PI*11);maxLaneError=Math.max(maxLaneError,laneError);
  near(outside-inside,2*Math.PI*11,0.04,key+' offset arc length');
  near(S.laneProgressCoef(333,g.referenceLane,g),1,0.00025,key+' reference arc parameter metric');
  let curvature=0,netHeight=0;
  for(let q=0;q<g.lap;q+=0.5){const dq=Math.min(0.5,g.lap-q),s=loop.from+q+dq/2;curvature+=S.kAt(s,g)*dq;netHeight+=S.gradientAt(s,g,0)*dq;
    const k=S.kAt(s,g);assert.ok(Number.isFinite(k)&&k>=0);checks++;
    if(k>0.001)assert.ok(S.laneCurvatureAt(s,12,g)<S.laneCurvatureAt(s,1,g));
  }
  near(curvature,2*Math.PI,0.003,key+' continuous full turn');near(netHeight,0,0.012,key+' periodic grade integral');
  const profile=g.elevationProfile;for(let i=1;i<profile.length;i++){assert.ok(profile[i][0]>profile[i-1][0],key+' height node ordering');checks++;}
  near(Math.max(...profile.map(p=>p[1]))-Math.min(...profile.map(p=>p[1])),def.elevation,1e-9,key+' official elevation range');
  for(let j=0;j<30;j++){const at=loop.from+(j+0.37)*g.lap/30;
    for(const lane of [1,12]){const e=0.01,a=S.trackPoint(at-e,lane,g,g.direction),b=S.trackPoint(at+e,lane,g,g.direction),metric=Math.hypot(b.x-a.x,b.y-a.y)/(2*e);
      near(metric*S.laneProgressCoef(at,lane,g),1,0.00025,key+' physical distance / progress consistency');
    }
  }
  for(const q of g.route.loop.turns){const at=q-g.startOffset+g.lap;
    const before=S.trackTangent(at-0.01,3,g,g.direction),after=S.trackTangent(at+0.01,3,g,g.direction),err=Math.hypot(after.x-before.x,after.y-before.y);maxTangentError=Math.max(maxTangentError,err);
    near(err,0,0.0025,key+' tangent continuity');near(S.kAt(at,g),0,0.00012,key+' zero curvature at straight junction');
  }
  for(const s of [2400-g.finishStraight+1,2399])near(S.kAt(s,g),0,1e-12,key+' final straight');
}
const starts=[['中山',1200,260],['東京',1600,542],['東京',2000,100],['東京',2400,350],['京都',3000,200],['京都',3200,400]];
for(const [venue,distance,firstTurn] of starts){
  const g=S.trackGeometry(distance,venue,'草地'),first=g.boundaries.find(b=>b.kind==='bendStart');near(first.s,firstTurn,1e-8,venue+distance+' sourced first turn');
  for(let s=0;s<firstTurn-0.8;s+=2)near(S.kAt(s,g),0,1e-12,venue+distance+' straight run to first turn');
  const covered=arc(g,0,distance,g.referenceLane);near(covered,distance,0.055,venue+distance+' race physical distance');
  if(g.route.chute){const join=g.route.startLength,a=S.trackPoint(join-1e-5,4,g,g.direction),b=S.trackPoint(join+1e-5,4,g,g.direction),t0=S.trackTangent(join-0.01,4,g,g.direction),t1=S.trackTangent(join+0.01,4,g,g.direction);
    near(Math.hypot(a.x-b.x,a.y-b.y),0,0.00003,venue+distance+' chute join position');near(Math.hypot(t0.x-t1.x,t0.y-t1.y),0,0.00005,venue+distance+' chute join tangent');
    near(S.kAt(join-0.01,g),S.kAt(join+0.01,g),0.000005,venue+distance+' chute join curvature');
  }
}
const tokyo=S.trackGeometry(2400,'東京','草地'),nakayama=S.trackGeometry(1200,'中山','草地');
near(S.elevationAt(2400-300,tokyo,0)-S.elevationAt(2400-460,tokyo,0),2,1e-9,'Tokyo 160m finish rise');
near(S.elevationAt(1200-70,nakayama,0)-S.elevationAt(1200-180,nakayama,0),2.2,1e-9,'Nakayama 110m finish rise');
near(S.elevationAt(0,nakayama,0)-S.elevationAt(1200-310,nakayama,0),4.4,1e-9,'Nakayama sprint descent');
const abstract=S.trackGeometry(3200,'标准');assert.equal(abstract.route,null);assert.equal(abstract.width,20);checks+=2;
// The geometry helper integrates the coordinates that are actually rendered. It must
// not approximate a step using only its starting or midpoint radius.
const helperGeometries=[...keys.map(k=>S.trackGeometry(2400,k,k.endsWith('泥')?'泥地':'草地')),
  S.trackGeometry(1600,'東京','草地'),S.trackGeometry(2000,'東京','草地'),
  S.trackGeometry(1600,'京都','草地'),S.trackGeometry(1800,'京都','草地'),
  abstract,S.trackGeometry(1600,'长直道'),S.trackGeometry(1200,'小回り')];
for(const g of helperGeometries){
  const lanes=[0.7,g.referenceLane,g.width-0.7],seams=g.boundaries.map(x=>x.s);
  if(g.route)seams.push(...g.route.loop.turns.map(q=>q-g.startOffset+g.lap),g.route.startLength,
    2*g.route.loop.step-g.startOffset+g.lap,
    g.route.loop.home+2*g.route.loop.step-g.startOffset+g.lap);
  const origins=[-1.37,0,0.23,g.length-0.17,...seams.map(s=>s-0.29)];
  for(const lane of lanes){
    for(const origin of origins){
      for(const distance of [-0.77,0.013,0.63,12.7,250.3]){
        const to=S.laneAdvance(origin,distance,lane,g),actual=S.laneArcDistance(origin,to,lane,g),error=Math.abs(actual-distance);
        maxInverseError=Math.max(maxInverseError,error);near(actual,distance,0.0000002,g.course+' signed arc inverse');
        near(S.laneAdvance(to,-distance,lane,g),origin,0.0000003,g.course+' reverse inverse');
      }
      const a=0.413,b=0.733,to=S.laneAdvance(origin,a+b,lane,g),split=S.laneAdvance(S.laneAdvance(origin,a,lane,g),b,lane,g);
      maxAdvanceCompositionError=Math.max(maxAdvanceCompositionError,Math.abs(to-split));
      near(to,split,0.0000003,g.course+' split-step invariance');
      near(S.laneArcDistance(origin,origin+0.37,lane,g)+S.laneArcDistance(origin+0.37,origin+11.9,lane,g),
        S.laneArcDistance(origin,origin+11.9,lane,g),1e-9,g.course+' additive signed arc');
    }
    const loop=g.displaySegments[0],inner=S.laneArcDistance(loop.from,loop.to,0.7,g),outer=S.laneArcDistance(loop.from,loop.to,g.width-0.7,g);
    near(outer-inner,2*Math.PI*(g.width-1.4),1e-8,g.course+' parallel-curve integral over full lap');
    for(const origin of [0.13,g.length*0.43,...seams]){
      const start=origin-0.71,end=origin+0.83,expected=arc(g,start,end,lane,0.001),actual=S.laneArcDistance(start,end,lane,g),error=Math.abs(actual-expected);
      maxArcIntegralError=Math.max(maxArcIntegralError,error);near(actual,expected,0.000012,g.course+' integrated arc matches actual coordinate path');
    }
  }
  const breakpoints=S.laneArcBreakpoints(-2,g.length+2,g);
  for(let i=0;i<breakpoints.length;i++){assert.ok(breakpoints[i]>-2&&breakpoints[i]<g.length+2);checks++;if(i){assert.ok(breakpoints[i]>breakpoints[i-1]);checks++;}}
  for(const boundary of g.boundaries)assert.ok(breakpoints.some(s=>Math.abs(s-boundary.s)<1e-8),g.course+' exact traffic geometry event '+boundary.s);
  checks+=g.boundaries.length;
  const corner=g.boundaries.find(b=>b.kind==='bendStart');
  if(corner){
    const lane=g.width-0.7,start=corner.s-0.37,total=1.91,one=S.laneAdvance(start,total,lane,g);let small=start;
    for(let i=0;i<191;i++)small=S.laneAdvance(small,0.01,lane,g);
    near(one,small,0.000001,g.course+' repeated tiny steps cross bend consistently');
  }
}
// This is the original hard stadium jump that exposes an endpoint/midpoint-only
// integration error in two braking horses on an outer lane.
const standard=S.trackGeometry(2000,'标准'),corner=standard.boundaries.find(b=>b.kind==='bendStart').s;
const lane=17,begin=corner-0.31,after=S.laneAdvance(begin,0.71,lane,standard);
near(after,corner+0.4*S.laneProgressCoef(corner+0.01,lane,standard),1e-10,'abstract straight-to-bend exact physical split');
assert.ok(S.laneArcBreakpoints(corner-1,corner+1,standard).includes(corner));checks++;
assert.throws(()=>S.laneAdvance(0,Infinity,2,standard));assert.throws(()=>S.laneArcDistance(NaN,1,2,standard));checks+=2;
console.log(JSON.stringify({officialLayouts:keys.length,helperLayouts:helperGeometries.length,checks,maxReferenceArcErrorMetres:maxReferenceError,maxOffsetArcErrorMetres:maxLaneError,maxJunctionTangentDelta:maxTangentError,
  maxIntegratedArcCoordinateErrorMetres:maxArcIntegralError,maxArcInverseErrorMetres:maxInverseError,maxSplitStepProgressErrorMetres:maxAdvanceCompositionError}));
