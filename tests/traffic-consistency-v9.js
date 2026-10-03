#!/usr/bin/env node
'use strict';
// Mechanism regressions plus every-internal-step conservation/traffic observations.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const engineFile=path.resolve(__dirname,'../sim.js');
const engineHash=()=>crypto.createHash('sha256').update(fs.readFileSync(engineFile,'utf8').replace(/\r\n/g,'\n')).digest('hex');
const loadedEngineHash=engineHash();
const S=require('../sim'),DT=1/60;
const lengthOf=h=>2.25+0.55*h.adj['体格']/100;
const widthOf=h=>0.65+0.15*h.adj['体格']/100;
function field(seed,n=16,equal=false) {
  const f=S.makeField(S.mulberry32(seed),{n,level:70});
  for(const h of f) {
    h.surface='草地';h.special='左右皆可';h['疲劳']=0;h['斗志']=50;
    h.jockeyGrade='普通';h.bodyMass=480;h.carriedWeight=57;
    if(equal) for(const key of Object.keys(h.stats)) h.stats[key]=70;
  }
  return f;
}
function raceFor(seed,n=16,equal=false,opts={}) {
  return S.createRace(field(seed,n,equal),{length:1200,course:'标准',profile:'平坦',
    surface:'草地',state:'良',rng:S.mulberry32((seed^0x9e3779b9)>>>0),...opts});
}
function controlledPair() {
  const r=raceFor(73,2,true),[a,b]=r.race.horses;
  for(const h of [a,b]) {h.s=100;h.t=3;h.v=18;h.startDelay=0;h.control={targetV:18,targetT:3};}
  return {r,a,b};
}
function mechanismChecks() {
  const cases=[];
  {
    const {r,a,b}=controlledPair();b.t=3.87;a.control.targetT=4;b.control.targetT=2;
    r.step(DT);
    assert(a.trafficStep.lateralDenied&&b.trafficStep.lateralDenied);
    assert.equal(a.t,3);assert.equal(b.t,3.87);
    assert(a.accel>=-S.RACE_F.braking-1e-8&&b.accel>=-S.RACE_F.braking-1e-8);
    cases.push({name:'simultaneous-opposing-lateral',denied:[a.id,b.id],speeds:[a.v,b.v]});
  }
  {
    const {r,a,b}=controlledPair();a.s=100;b.s=110;a.t=3.86;b.t=3;a.v=20;b.v=18;
    a.control={targetV:20,targetT:3};r.step(DT);
    assert(a.trafficStep.lateralDenied);assert.equal(a.t,3.86);
    cases.push({name:'cut-in-with-insufficient-stopping-reserve',denied:a.id,speed:a.v});
  }
  {
    const {r,a,b}=controlledPair();a.s=100;b.s=120;a.t=3.86;b.t=3;a.control.targetT=3;
    r.step(DT);assert(!a.trafficStep.lateralDenied);assert(a.t<3.86);
    cases.push({name:'safe-cut-in-remains-available',lateral:a.t-3.86});
  }
  {
    const {r,a,b}=controlledPair();a.s=100;b.s=108;a.t=b.t=3;
    a.control.targetV=22;b.control.targetV=0;
    let minimum=0,minimumGap=Infinity;
    for(let i=0;i<120;i++) {
      r.step(DT);minimum=Math.min(minimum,a.accel,b.accel);
      minimumGap=Math.min(minimumGap,b.s-a.s-(lengthOf(a)+lengthOf(b))/2);
      assert(minimum>=-S.RACE_F.braking-1e-7);assert(minimumGap>=0.20-1e-6);
    }
    cases.push({name:'front-braking-and-follower-response',minAcceleration:minimum,minBodyGap:minimumGap});
  }
  {
    const {r,a,b}=controlledPair();a.t=b.t=3;
    assert.throws(()=>r.step(DT),/步前身体已重叠/);
    assert.equal(a.v,18);assert.equal(b.v,18);
    cases.push({name:'invalid-injected-overlap-is-explicit',diagnostic:r.race.traffic.lastInfeasible});
  }
  {
    const {r,a,b}=controlledPair();a.s=100;b.s=104;a.t=b.t=3;a.v=20;b.v=10;
    assert.throws(()=>r.step(DT),/既有跟车间距不满足有限制动可行域/);
    assert.equal(a.v,20);assert.equal(b.v,10);
    cases.push({name:'invalid-injected-stopping-state-is-explicit',diagnostic:r.race.traffic.lastInfeasible});
  }
  {
    const {r,a,b}=controlledPair();a.t=0.40;b.t=3;a.control.targetT=-5;
    const oldT=a.t;r.step(DT);
    assert(Math.abs(a.t-oldT)<=S.RACE_F.lateralSpeed*DT+1e-8);
    assert(a.t>=widthOf(a)/2);
    cases.push({name:'legal-rail-edge-corrects-by-bounded-steering',deltaT:a.t-oldT});
  }
  {
    const {r,a}=controlledPair();a.t=0.2;
    assert.throws(()=>r.step(DT),/步前位置或速度超出合法运动范围/);
    assert.equal(a.t,0.2);cases.push({name:'invalid-rail-state-is-explicit'});
  }
  {
    const {r,a,b}=controlledPair();a.s=100;b.s=104;a.t=b.t=3;
    a.control.targetV=21;b.control.targetV=17;
    const intervals=[0.01,1/30,1/120,0.031,0.007,0.050,1/240,0.022];
    for(let i=0;i<96;i++) r.step(intervals[i%intervals.length]);
    assert.equal(r.race.traffic.infeasibleSteps,0);
    assert(r.race.traffic.minAcceleration>=-S.RACE_F.braking-1e-7);
    assert(b.s-a.s>=(lengthOf(a)+lengthOf(b))/2+0.20-1e-6);
    cases.push({name:'small-to-large-and-irregular-public-step',intervals,
      minimumAcceleration:r.race.traffic.minAcceleration,minimumSlack:r.race.traffic.minFollowingSlack});
  }
  {
    const {r,a,b}=controlledPair();a.s=100;b.s=103.0;a.t=b.t=3;a.control.targetV=21;b.control.targetV=0;
    for(const dt of [0.01,1/30,0.007,1/60,0.031]) r.step(dt);
    assert.equal(r.race.traffic.infeasibleSteps,0);assert(r.race.traffic.marginRecoverySteps>0);
    assert(r.race.traffic.minAcceleration>=-S.RACE_F.braking-1e-7);
    assert(r.race.traffic.minFollowingSlack>=-1e-7);
    cases.push({name:'physically-feasible-short-headway-restores-response-margin',recoverySteps:r.race.traffic.marginRecoverySteps,
      minimumAcceleration:r.race.traffic.minAcceleration,minimumPhysicalSlack:r.race.traffic.minFollowingSlack});
  }
  {
    const entries=field(73,2,true);
    for(const h of entries) h.stats['体格']=(2.8058654-2.45)*100/0.55;
    const r=S.createRace(entries,{length:2000,course:'标准',profile:'平坦',surface:'草地',state:'良',rng:()=>0.5});
    const [rear,front]=r.race.horses;
    for(const h of [rear,front]) {h.t=17;h.startDelay=0;}
    rear.s=457.25867822;rear.v=19;rear.control={targetV:19,targetT:17};
    front.s=460.30315678;front.v=19.5;front.control={targetV:19.5,targetT:17};
    assert(front.s-rear.s>(lengthOf(rear)+lengthOf(front))/2+0.20);
    assert.throws(()=>r.step(DT),/既有跟车间距不满足有限制动可行域/);
    assert.equal(rear.v,19);assert.equal(front.v,19.5);
    cases.push({name:'bend-interior-closest-approach-rejects-coarse-grid-false-safety',diagnostic:r.race.traffic.lastInfeasible});
  }
  {
    const {r,a,b}=controlledPair();a.s=b.s=100;a.t=3;b.t=6;a.v=b.v=0;
    a.startDelay=DT/2;a.control={targetV:18,targetT:4};b.control={targetV:0,targetT:6};
    r.step(DT);
    const physical=S.laneArcDistance(100,100+a.trafficStep.deltaS,3+a.trafficStep.deltaT/2,r.race.geo);
    const travelled=Math.hypot(physical,a.trafficStep.deltaT),expected=a.v/2*(DT/2);
    assert(Math.abs(travelled-expected)<1e-9);
    cases.push({name:'partial-gate-reaction-uses-one-active-vector-duration',activeDt:DT/2,
      physicalArc:physical,lateral:a.trafficStep.deltaT,vectorError:Math.abs(travelled-expected)});
  }
  assert.throws(()=>raceFor(1,30),/赛道宽度不足/);
  return cases;
}
function measure(config) {
  const entries=config.native?S.makeField(S.mulberry32(config.seed),{n:config.n,strongIndex:2,playerIndex:2,level:70}):
    config.nativeOfficial?S.makeField(S.mulberry32(config.seed),{n:config.n,level:70}):field(config.seed,config.n,config.equal);
  if(config.nativeOfficial) for(const h of entries) {h.surface='草地';h.special='左右皆可';}
  const rc=S.createRace(entries,{length:config.length,course:config.course,profile:config.native?'缓坂':'平坦',surface:'草地',state:'良',
    rng:S.mulberry32(config.raceSeed??((config.seed^0x9e3779b9)>>>0))}),R=rc.race;
  let steps=0,minAcceleration=0,maxAcceleration=0,maxWorkError=0,maxReserveError=0,maxUnpaid=0;
  let minBodyGap=Infinity,maxLateralSpeed=0,maxKinematicError=0;
  while(!R.finished&&R.t<610) {
    const active=R.horses.filter(h=>!h.place&&!h.dnf),old=new Map(active.map(h=>[h,{s:h.s,t:h.t,v:h.v,stamina:h.stamina,
      energy:h.statsSummary.energyUsed,recovered:h.statsSummary.recovered}]));
    rc.step(DT);steps++;
    const positions=new Map();
    for(const h of active) {
      const b=old.get(h),d=h.trafficStep,after={s:b.s+d.deltaS,t:b.t+d.deltaT};positions.set(h,after);
      minAcceleration=Math.min(minAcceleration,h.accel);maxAcceleration=Math.max(maxAcceleration,h.accel);
      assert(h.accel>=-S.RACE_F.braking-1e-7,'unbounded deceleration '+h.id);
      maxLateralSpeed=Math.max(maxLateralSpeed,Math.abs(d.deltaT)/DT);
      assert(Math.abs(d.deltaT)/DT<=S.RACE_F.lateralSpeed+1e-8);
      const effective= Math.max(0,Math.min(1,(R.t-h.startDelay)/DT));
      const travel=(b.v+h.v)/2,activeDt=DT*effective,side=activeDt?d.deltaT/activeDt:0;
      const expected=Math.sqrt(Math.max(0,travel*travel-side*side))*activeDt;
      const actual=S.laneArcDistance(b.s,after.s,(b.t+after.t)/2,R.geo);
      maxKinematicError=Math.max(maxKinematicError,Math.abs(actual-expected));
      assert(Math.abs(actual-expected)<1e-7,'physical path is not integrated from actual bounded speed');
      const stats=h.statsSummary;
      maxWorkError=Math.max(maxWorkError,Math.abs(stats.workUsed-stats.aerobicUsed-stats.energyUsed));
      maxReserveError=Math.max(maxReserveError,Math.abs(h.stamina-(b.stamina-(stats.energyUsed-b.energy)+(stats.recovered-b.recovered))));
      maxUnpaid=Math.max(maxUnpaid,stats.unpaidWork);
      assert(Number.isFinite(h.v)&&h.v>=0&&h.stamina>=0&&h.stamina<=h.staminaMax+1e-8);
    }
    for(let i=0;i<active.length;i++) for(let j=i+1;j<active.length;j++) {
      const a=active[i],b=active[j],ao=old.get(a),bo=old.get(b),an=positions.get(a),bn=positions.get(b);
      // Independent fine interpolation checks the entire small linear path, including mid-step.
      for(const u of [0,0.25,0.5,0.75,1]) {
        const as=ao.s+(an.s-ao.s)*u,bs=bo.s+(bn.s-bo.s)*u,at=ao.t+(an.t-ao.t)*u,bt=bo.t+(bn.t-bo.t)*u;
        const scale=Math.max(1,S.laneProgressCoef(as,at,R.geo),S.laneProgressCoef(bs,bt,R.geo));
        const bodyLong=(lengthOf(a)+lengthOf(b))/2*scale,bodyWide=(widthOf(a)+widthOf(b))/2;
        if(Math.abs(at-bt)<bodyWide+0.1-1e-8) {
          const gap=Math.abs(as-bs)-bodyLong;minBodyGap=Math.min(minBodyGap,gap);
          assert(gap>=0.20*scale-1e-6,'body overlap '+a.id+'/'+b.id);
        }
      }
    }
  }
  assert(R.finished&&R.order.length===config.n&&R.dnf.length===0);
  assert.equal(R.traffic.infeasibleSteps,0);
  assert(maxWorkError<1e-6&&maxReserveError<1e-6&&maxUnpaid<1e-6);
  return {...config,steps,winnerTime:R.winnerTime,lastTime:R.order.at(-1).time,minAcceleration,maxAcceleration,
    minBodyGap:Number.isFinite(minBodyGap)?minBodyGap:null,maxLateralSpeed,maxKinematicError,maxWorkError,maxReserveError,maxUnpaid,
    traffic:R.traffic,finishTimes:R.horses.map(h=>h.time)};
}
const mechanisms=mechanismChecks(),configs=[
  {seed:3198315393,raceSeed:546640440,n:16,length:1200,course:'标准',equal:false,label:'previous-healthy-pathology'},
  {seed:3198943767,raceSeed:547060654,n:16,length:1200,course:'标准',equal:true,label:'previous-equal-pathology'},
  {seed:50289,raceSeed:((50289+3)^0x9e3779b9)>>>0,n:8,length:2000,course:'标准',native:true,label:'page-native-temporary-closing-at-bend'},
  {seed:3198001206,raceSeed:548067727,n:16,length:3200,course:'标准',equal:false,label:'matrix-healthy-braking-trajectory'},
  {seed:3214042812,raceSeed:564469509,n:16,length:2400,course:'東京芝A',nativeOfficial:true,label:'matrix-native-official-braking-trajectory'},
];
if(!process.argv.includes('--quick')) for(const length of [1200,1600,2000,2400,3000,3200]) for(const n of [8,18]) for(const seed of [137,719])
  configs.push({seed,n,length,course:length===1200?'中山芝外A':length>=3000?'京都芝外A':'東京芝A',equal:false,label:'course-field-regression'});
const races=[];
for(const c of configs) {const result=measure(c);races.push(result);console.log(JSON.stringify({label:c.label,length:c.length,n:c.n,seed:c.seed,
  winnerTime:result.winnerTime,minAcceleration:result.minAcceleration,infeasible:result.traffic.infeasibleSteps}));}
const report={engineHash:loadedEngineHash,sourceUnchangedDuringRun:loadedEngineHash===engineHash(),method:'Every public step 1/60s; body and trapezoid observations use un-clipped internal deltaS at finish; generated fields/race streams separate.',
  geometryWidth:'JRA A-course lower-width proxies; 20m abstract course. Single-row gate pitch >=0.95m.',
  bodyEnvelope:'Width 0.65+0.15*size/100 m is a kinematic proxy bounded by manufacturer 0.95m starting-stall clear width, not measured horse shoulder width. Independent clearance 0.10m lateral and 0.20m longitudinal.',
  sources:['https://www.tekide.com/fr/boites-de-depart/93-boites-de-depart.html','https://simtrack.com.au/starting-gates/'],
  mechanisms,races,summary:{raceCount:races.length,internalSteps:races.reduce((s,r)=>s+r.steps,0),
    minimumAcceleration:Math.min(...races.map(r=>r.minAcceleration)),maximumKinematicError:Math.max(...races.map(r=>r.maxKinematicError)),
    maximumWorkError:Math.max(...races.map(r=>r.maxWorkError)),maximumReserveError:Math.max(...races.map(r=>r.maxReserveError)),
    maximumUnpaid:Math.max(...races.map(r=>r.maxUnpaid)),infeasibleSteps:races.reduce((s,r)=>s+r.traffic.infeasibleSteps,0)}};
const output=path.resolve(__dirname,process.argv.includes('--quick')?'../docs/traffic-consistency-v9-smoke-2026-10-02.json':'../docs/traffic-consistency-v9-2026-10-02.json');
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,summary:report.summary}));
