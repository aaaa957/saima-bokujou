#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const S=require('../sim');
const references=require('../docs/race-reality-reference.json');
let checks=0;
function close(a,b,msg,tol=1e-8){assert.ok(Math.abs(a-b)<tol,msg+': '+a+' / '+b);checks++;}
const courses=[
  ['東京',2400,'草地',2083.1,525.9,2.7],['東京',2000,'草地',2083.1,525.9,2.7],
  ['東京',1600,'泥地',1899,501.6,2.5],['中山',2000,'草地',1667.1,310,5.3],
  ['中山',1200,'草地',1839.7,310,5.3],['中山',1600,'草地',1839.7,310,5.3],
  ['中山',1800,'泥地',1493,308,4.5],['京都',2000,'草地',1782.8,328.4,3.1],
  ['京都',3000,'草地',1894.3,403.7,4.3],['京都',3200,'草地',1894.3,403.7,4.3],
  ['京都',1800,'泥地',1607.6,329.1,3],['阪神',2000,'草地',1689,356.5,1.9],
  ['阪神',2400,'草地',2089,473.6,2.4],['阪神',1800,'泥地',1517.6,352.7,1.6],
  ['新潟',1200,'草地',1623,358.7,0.8],['新潟',2000,'草地',2223,658.7,2.2],
  ['新潟',1800,'泥地',1472.5,353.9,0.6],
];
for(const [venue,length,surface,lap,straight,height] of courses){
  const g=S.trackGeometry(length,venue,surface);
  close(g.lap,lap,venue+' lap');close(g.finishStraight,straight,venue+' finish straight');
  close(2*g.S+2*g.B,lap,venue+' reference-lane geometry');
  assert.equal(g.distanceSupported,true);assert.match(g.source,/^https:\/\/www\.jra\.go\.jp\//);
  const p=g.elevationProfile;
  close(Math.max(...p.map(v=>v[1]))-Math.min(...p.map(v=>v[1])),height,venue+' height');
  close(p[0][1],p.at(-1)[1],venue+' periodic elevation');
  let integral=0;
  for(let i=1;i<p.length;i++){
    assert.ok(p[i][0]>p[i-1][0],venue+' sorted elevation nodes');
    const q=(p[i][0]+p[i-1][0])/2;
    integral+=S.gradientAt(q-g.startOffset,g,0)*(p[i][0]-p[i-1][0]);
  }
  close(integral,0,venue+' zero net ascent per lap');
  for(const direction of ['左回','右回']){
    const loopStart=g.route?g.route.loopRaceStart:0;
    const a=S.trackPoint(loopStart,g.referenceLane,g,direction),b=S.trackPoint(loopStart+lap,g.referenceLane,g,direction);
    close(a.x,b.x,venue+' closed x');close(a.y,b.y,venue+' closed y');
    assert.equal(S.kAt(length-straight+1,g),0,venue+' final straight');
    for(const at of g.boundaries){
      const before=S.trackPoint(at.s-1e-6,3,g,direction),after=S.trackPoint(at.s+1e-6,3,g,direction);
      assert.ok(Math.hypot(before.x-after.x,before.y-after.y)<1e-4,venue+' continuous path at turn');
    }
  }
  let onBend=null;
  for(let s=0;s<length;s+=5)if(S.kAt(s,g)>0.001){onBend=s;break;}
  assert.ok(onBend!==null,venue+' route contains a bend');
  // The interpolated reference curve has a near-unit, measured arc parameter;
  // exact position/arc consistency is checked independently in route-detail-v9.
  close(S.laneProgressCoef(onBend,g.referenceLane,g),1,venue+' reference lane',0.00025);
  assert.ok(S.laneProgressCoef(onBend,12,g)<S.laneProgressCoef(onBend,3,g),venue+' outside arc longer');
}
const tokyo=S.trackGeometry(2400,'東京','草地'),nakayama=S.trackGeometry(2000,'中山','草地');
close(S.gradientAt(2400-400,tokyo,0),2/160,'Tokyo finish hill');
close(S.gradientAt(2000-120,nakayama,0),2.2/110,'Nakayama finish hill');
assert.equal(S.trackGeometry(3200,'東京','草地').distanceSupported,false);
assert.equal(S.trackGeometry(2400,'中山','草地').distanceSupported,false);
assert.match(S.trackGeometry(3200,'中山','草地').simplification,/混合内外圈/);
assert.equal(S.trackGeometry(3200,'标准').source,null);
assert.equal(references.samples.length,18);
assert.equal(references.samples.filter(r=>r.split==='calibration').length,12);
assert.equal(references.samples.filter(r=>r.split==='holdout').length,6);
for(const r of references.samples){
  assert.match(r.source.url,/^https:\/\/japanracing\.jp\//);
  assert.equal(r.raceSectionals200m.length,r.length/200);
  close(r.raceSectionals200m.reduce((a,b)=>a+b,0),r.winner.finishTime,r.id+' sectional sum',0.11);
  close(r.first600,r.raceSectionals200m.slice(0,3).reduce((a,b)=>a+b,0),r.id+' first600');
  close(r.raceFinal600,r.raceSectionals200m.slice(-3).reduce((a,b)=>a+b,0),r.id+' race final600',0.11);
  assert.ok(r.winner.final600>25 && r.winner.final600<45);
  assert.ok(S.trackGeometry(r.length,r.venue,r.surface).distanceSupported);
}
const exceptional=references.samples.find(r=>r.id==='231126');
assert.ok(Math.abs(exceptional.winner.final600-exceptional.raceFinal600)>2,'leader splits must not impersonate the winner');
console.log('Course reality: '+courses.length+' official-dimension variants, '+references.samples.length+' sourced races, '+checks+' numerical assertions passed.');
