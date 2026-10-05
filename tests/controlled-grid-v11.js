#!/usr/bin/env node
'use strict';
// Exploratory mechanical grid selected after the initial candidate smoke, not a
// preregistered real-race trial. No natural-AI or reserved-year outcomes here.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {api,HASH,BASE,DT,q}=require('./system-reality-v9'),{controlledField,observe,engineering}=require('./race-validation-v11');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);return i<0?value:args[i+1];};
const sourcePath=path.resolve(ROOT,arg('--source','sim.js')),bytes=fs.readFileSync(sourcePath),source=(bytes[0]===0x1f&&bytes[1]===0x8b?require('node:zlib').gunzipSync(bytes):bytes).toString('utf8');
const output=path.resolve(ROOT,arg('--out','docs/controlled-grid-v11.json')),S0=api(source),F=S0.RACE_F,clone=x=>JSON.parse(JSON.stringify(x));
const B=api(execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6}));
const fast=(response,peak)=>({maxAccel:F.maxAccel*1.25,runningAccel:F.runningAccel*1.25,responseTime:F.responseTime*response,peakExtra:F.peakExtra+peak});
const air=alpha=>({airK:F.airK*alpha,resistanceK:F.resistanceK-F.airK*(alpha-1)*18});
const variants=[
  ['current',{}],['fast85',fast(.85,0)],['fast80-peak08',fast(.8,.8)],['fast80-peak12',fast(.8,1.2)],
  ['air2-anchor18',air(2)],['air4-anchor18',air(4)],['air2-fast80-peak08',{...air(2),...fast(.8,.8)}],
  ['air4-fast80-peak12',{...air(4),...fast(.8,1.2)}],
  ['air2-fast80-peak12-cost105',{...fast(.8,1.2),airK:air(2).airK*1.05,resistanceK:air(2).resistanceK*1.05}],
  ['air4-fast85-peak08-cost105',{...fast(.85,.8),airK:air(4).airK*1.05,resistanceK:air(4).resistanceK*1.05}],
].map(([name,parameters])=>({name,parameters}));
const jobs=[1200,2400,3200].flatMap(length=>[70,86].map(level=>({kind:'start',context:'controlled-parameter-grid',n:1,length,course:'标准',dir:'左回',state:'良',level,intent:.5,command:'maximum',seed:(2026101103+length*13)>>>0,raceSeed:(2026101103+length*13)^0x9e3779b9})));
const anchor1='        let nextV=Math.max(0,H.v+a*dt*startFraction);',anchor2='        motion.set(H,paidProposal(nextV));H.pot=desired;';
assert.equal(source.split(anchor1).length,2,'Unique actual-motion acceleration anchor');assert.equal(source.split(anchor2).length,2,'Unique actual paid-proposal anchor');
const instrumented=source.replace(anchor1,anchor1+`
        if(H._v11Trace) {
          const speedCap=H.maxV*fatigue,powerCap=speedAtPower(H,maxPower,!!wake);
          const curveCap=curvature>0?Math.sqrt(Math.max(1,(RACE_F.curveLateral+(H.adj['力量']-70)*0.008)/curvature))*bendCoefFor(H.h.special,dir):Infinity;
          H._v11Limits={s:before.s,v:before.v,desired,targetV:H.targetV,speedCap,powerCap,curveCap,
            maxA,response,kineticBudget,requestA:(desired-H.v)/response,chosenA:a,maxPower,aerobic,
            startFraction,candidateV:nextV,blocked:!!front,drafting:!!wake};
        }`).replace(anchor2,anchor2+`
        if(H._v11Trace)H._v11Limits.paidV=motion.get(H).v;`);
const digestReplacer=(key,value)=>['_v11Trace','_v11Limits'].includes(key)?undefined:value;
function run(job,variant,diagnostic=true,digest=false){
  const S=api(diagnostic?instrumented:source);Object.assign(S.RACE_F,variant.parameters);
  const field=controlledField(S,B,job),inputHash=HASH(JSON.stringify(field)),r=S.createRace(field,{length:job.length,course:'标准',dir:'左回',surface:'草地',profile:'平坦',state:'良',wind:0,rng:S.mulberry32(job.raceSeed)}),H=r.race.horses[0];
  Object.assign(H,{gate:1,t:1.8,targetT:1.8,startDelay:.2,aiBias:0,control:{targetV:30,targetT:1.8}});if(diagnostic)H._v11Trace=true;
  const initial={gate:H.gate,lane:H.t,startDelay:H.startDelay,adj:clone(H.adj),base:H.base,maxV:H.maxV,aerobic:H.aerobic,reservePower:H.reservePower,capacity:H.staminaMax,tau:H.aerobicTau};
  const obs=observe(S,r),trace=[],frames={pre200:0,after200:0},bindings={pre200:{gate:0,response:0,mechanical:0,powerAcceleration:0,paidProposalPower:0,speed:0,powerSpeed:0,request:0,curve:0},after200:{gate:0,response:0,mechanical:0,powerAcceleration:0,paidProposalPower:0,speed:0,powerSpeed:0,request:0,curve:0}};
  const hash=digest?crypto.createHash('sha256'):null;let frame=0;
  while(H.s<600&&!H.place&&r.race.t<610){obs.step();frame++;
    if(hash)hash.update(JSON.stringify(r.race,digestReplacer));
    if(diagnostic){const x=H._v11Limits,zone=x.s<200?'pre200':'after200',c=bindings[zone];frames[zone]++;
      if(!x.startFraction)c.gate++;else{if(Math.abs(x.chosenA-x.requestA)<1e-7)c.response++;if(Math.abs(x.chosenA-x.maxA)<1e-7)c.mechanical++;if(Math.abs(x.chosenA-x.kineticBudget)<1e-7)c.powerAcceleration++;}
      if(x.paidV<x.candidateV-1e-8)c.paidProposalPower++;
      for(const [name,value] of [['speed',x.speedCap],['powerSpeed',x.powerCap],['request',x.targetV],['curve',x.curveCap]])if(Number.isFinite(value)&&Math.abs(value-x.desired)<1e-7)c[name]++;
      if(frame%60===1||H.s>=600)trace.push({time:r.race.t,...x,actualV:H.v,actualPower:H.power,reserve:H.stamina/H.staminaMax,retention:H.retention});
    }
  }
  const costCurve=[12,16,18,20,22].map(v=>{const exposed=H.powerFor(v,0,false,job.length-5),sheltered=H.powerFor(v,0,true,job.length-5),air=S.RACE_F.airK*v**3*H.massRatio;
    return {v,exposed,sheltered,saving:exposed-sheltered,air,airFraction:air/exposed};});
  const row={...job,variant:variant.name,parameters:variant.parameters,initial,inputHash,...obs.result(),completed:H.s>=600||!!H.place,finished:!!H.place,fullRace:false,
    first200:H.sectionals[0]?.time,first400:H.sectionals[1]?.time,first600:H.sectionals[2]?.time,bindings,bindingFrames:frames,bindingTrace:trace,costCurve,
    reserveFraction:H.stamina/H.staminaMax,endRetention:H.retention,endV:H.v,digest:hash?.digest('hex')??null};
  row.engineering=engineering(row,'start');return row;
}
const report={protocol:{sourceNormalizedSha256:HASH(source),sourceArtifact:path.relative(ROOT,sourcePath),generatorCommit:BASE,dt:DT,variants,jobs,
  scope:'Exploratory 10-point finite grid after initial v11 smoke; 6 fixed maximum-request solo starts per point, to600 only. No natural rider, real race or reserved2020 evaluation.',
  airAnchor:'At neutral70, flat straight wind0, v18, resistanceK_new=old-(airK_new-old)*18. Entire 12..22 curve reported; at86 economy differs, so equal18 anchor is approximate there.',
  boundDefinition:'Counts of equal active mathematical bounds, not causal shares. Speed/acceleration bounds can tie; paidProposalPower records clipping after the initial acceleration choice.',
  immutableSource:true},startedAt:new Date().toISOString(),samples:[],errors:[],observerProof:null};
const start=Date.now(),write=()=>{report.wallSeconds=(Date.now()-start)/1000;fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report)+'\n');};
fs.writeFileSync(output+'.source.js.gz',require('node:zlib').gzipSync(source));
try{const plain=run(jobs[0],variants[0],false,true),traced=run(jobs[0],variants[0],true,true);report.observerProof={plainDigest:plain.digest,tracedDigest:traced.digest,framesEach:plain.frames,passed:plain.digest===traced.digest&&plain.frames===traced.frames,actualPartialExecutions:2,actualFullExecutions:0};assert(report.observerProof.passed,'Instrumentation changed trajectory');}
catch(e){report.errors.push({phase:'instrumentation-proof',error:String(e.stack)});write();process.exitCode=1;}
if(report.observerProof?.passed)for(const variant of variants)for(const job of jobs){try{const row=run(job,variant);report.samples.push(row);console.log(JSON.stringify({done:report.samples.length,total:variants.length*jobs.length,variant:variant.name,length:job.length,level:job.level,first200:row.first200,powerAccelerationFraction:row.bindings.pre200.powerAcceleration/row.bindingFrames.pre200,engineering:row.engineering.passed}));}
  catch(e){report.errors.push({variant:variant.name,job,error:String(e.stack)});}write();}
report.paired=variants.filter(v=>v.name!=='current').map(v=>({variant:v.name,rows:jobs.map(job=>{const pick=name=>report.samples.find(s=>s.variant===name&&s.length===job.length&&s.level===job.level),base=pick('current'),row=pick(v.name);
  return {length:job.length,level:job.level,complete:!!base&&!!row,...(base&&row?{sameInputField:row.inputHash===base.inputHash,first200:row.first200-base.first200,first400:row.first400-base.first400,first600:row.first600-base.first600,
    reserveFraction:row.reserveFraction-base.reserveFraction,powerAccelEarlyFraction:row.bindings.pre200.powerAcceleration/row.bindingFrames.pre200,paidPowerEarlyFraction:row.bindings.pre200.paidProposalPower/row.bindingFrames.pre200,speedPeak:row.initial.maxV}: {})};})}));
report.integrity={complete:report.samples.length+report.errors.filter(e=>e.job).length===variants.length*jobs.length,passed:report.errors.length===0&&report.samples.every(s=>s.engineering.passed)&&report.observerProof?.passed,
  partialExecutions:report.samples.length+(report.observerProof?.actualPartialExecutions??0),fullExecutions:0,sourceFileStillSameAtEnd:HASH((()=>{const b=fs.readFileSync(sourcePath);return (b[0]===0x1f&&b[1]===0x8b?require('node:zlib').gunzipSync(b):b).toString('utf8');})())===HASH(source),failures:report.samples.filter(s=>!s.engineering.passed).map(s=>({variant:s.variant,length:s.length,level:s.level,checks:s.engineering.failedChecks}))};
write();console.log(JSON.stringify({output,source:HASH(source),wallSeconds:report.wallSeconds,integrity:report.integrity}));if(!report.integrity.passed)process.exitCode=1;
