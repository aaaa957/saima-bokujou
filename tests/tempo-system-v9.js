#!/usr/bin/env node
'use strict';
// Diagnose original rider commands without changing the engine or fitting a
// parameter. Solo playback preserves wall-clock commands, not new AI choices.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),{execFileSync}=require('node:child_process');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {api,fieldFor,HASH,BASE,DIST,DT,q,distribution}=require('./system-reality-v9');
const {NUMERIC_HASH}=require('./helpers/v9-numeric-snapshot');
const ROOT=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x));
const SOURCES=['docs/current-engine-reality-sources-2026-10-02.json','docs/system-external-reference-2022.json'];
const LABELS=['time','distance','speed','targetV','reserveFraction','retention','blocked','mode'];
function options(job,S){return {length:job.length,course:job.course,dir:job.dir,surface:'草地',state:'良',profile:'平坦',wind:0,rng:S.mulberry32(job.raceSeed)};}
function cv(a){if(!a.length)return null;const m=a.reduce((s,x)=>s+x,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length)/m;}
function aggregate(horses,leader){
  const times=horses.map(h=>h.time),finals=horses.map(h=>h.final600),winner=Math.min(...times);
  const splits=leader||horses.map(h=>h.sectionals).reduce((all,p)=>{p.forEach((s,i)=>all[i]=Math.min(all[i]??Infinity,s.time));return all;},[])
    .map((t,i,all)=>t-(all[i-1]||0));
  return {winnerTime:winner,tailSeconds:Math.max(...times)-winner,within1:times.filter(t=>t-winner<=1+1e-9).length/horses.length,
    within2:times.filter(t=>t-winner<=2+1e-9).length/horses.length,final600Span:Math.max(...finals)-Math.min(...finals),
    first200:splits[0],post200Cv:cv(splits.slice(1).map(s=>Math.round(s*10)/10)),last200Difference:splits.at(-1)-splits.at(-2),leaderSectionals200:splits};
}
function serialise(H,trace){
  const t=trace||{};return {id:H.id,gate:H.gate,time:H.time,place:H.place,final600:H.final3f,first200:H.sectionals.find(s=>s.distance===200)?.time,
    last200:H.sectionals.at(-1)?.split,reserveFraction:H.stamina/H.staminaMax,retention:H.retention,
    blockedSeconds:H.statsSummary.blockedSeconds,draftSeconds:H.statsSummary.draftSeconds,
    energyUsed:H.statsSummary.energyUsed,aerobicUsed:H.statsSummary.aerobicUsed,unpaidWork:H.statsSummary.unpaidWork,
    workBalanceError:Math.abs(H.statsSummary.workUsed-H.statsSummary.energyUsed-H.statsSummary.aerobicUsed),
    reserveBalanceError:Math.abs(H.stamina-(H.staminaMax-H.statsSummary.energyUsed+H.statsSummary.recovered)),
    peakSpeed:H.statsSummary.peakSpeed,sectionals:H.sectionals.map(x=>({distance:x.distance,time:x.time,split:x.split})),
    physiology:clone(H.h.physiology),physiologicalParameters:{aerobic:H.aerobic,capacity:H.staminaMax,reservePower:H.reservePower,tau:H.aerobicTau},
    ...(trace?{commands:t.commands,samples:t.samples,modeSeconds:t.modeSeconds,finishFrame:t.finishFrame,
      targetVAfter200:{min:t.minTarget,max:t.maxTarget,cv:Math.sqrt(Math.max(0,t.targetSquare/t.targetCount-(t.targetSum/t.targetCount)**2))/(t.targetSum/t.targetCount)},
      targetVsActualAfter200:{meanTarget:t.targetSum/t.targetCount,meanActual:t.actualSum/t.targetCount},
      endHalfTargets:{firstHalfMean:t.earlySum/Math.max(1,t.earlyCount),secondHalfMean:t.lateSum/Math.max(1,t.lateCount)}}:{})};
}
function runCrowd(job,S,B,trace=true){
  const field=fieldFor(job,B,S),r=S.createRace(field,options(job,S)),horses=r.race.horses;
  const initial=horses.map(H=>({id:H.id,startDelay:H.startDelay,t:H.t,targetT:H.targetT,gate:H.gate,aiBias:H.aiBias}));
  const traces=new Map(horses.map(H=>[H.id,{commands:[],samples:[],modeSeconds:{},minTarget:Infinity,maxTarget:-Infinity,
    targetCount:0,targetSum:0,targetSquare:0,actualSum:0,earlySum:0,lateSum:0,earlyCount:0,lateCount:0}]));
  let frame=0;
  while(!r.race.finished&&r.race.t<610){
    const active=horses.filter(H=>!H.place&&!H.dnf);r.step(DT);
    for(const H of active)if(trace){
      const t=traces.get(H.id),mode=H.strategy?.mode||'unobserved',prev=t.commands.at(-1);
      if(!prev||prev[1]!==H.targetV||prev[2]!==H.targetT||prev[3]!==mode)t.commands.push([frame,H.targetV,H.targetT,mode]);
      t.modeSeconds[mode]=(t.modeSeconds[mode]||0)+DT;
      if(frame%60===0||H.place)t.samples.push([r.race.t,H.s,H.v,H.targetV,H.stamina/H.staminaMax,H.retention,H.blocked?1:0,mode]);
      if(H.place)t.finishFrame=frame;
      if(H.s>=200){t.minTarget=Math.min(t.minTarget,H.targetV);t.maxTarget=Math.max(t.maxTarget,H.targetV);
        t.targetCount++;t.targetSum+=H.targetV;t.targetSquare+=H.targetV**2;t.actualSum+=H.v;}
      if(H.s>=200&&H.s<job.length/2){t.earlySum+=H.targetV;t.earlyCount++;}
      if(H.s>=job.length/2){t.lateSum+=H.targetV;t.lateCount++;}
    }frame++;
  }
  if(!r.race.finished||r.race.order.length!==job.n||r.race.dnf.length)throw new Error('Crowd did not finish '+JSON.stringify(job));
  const records=horses.map(H=>serialise(H,trace?traces.get(H.id):null));
  return {field,initial,horses:records,metrics:aggregate(records,r.race.sectionals.map(x=>x.split)),frames:frame};
}
function replaySolo(job,crowd,index,S){
  const original=crowd.horses[index],start=crowd.initial[index];
  const r=S.createRace([clone(crowd.field[index])],options(job,S)),H=r.race.horses[0];
  Object.assign(H,{t:start.t,targetT:start.targetT,gate:start.gate,startDelay:start.startDelay,aiBias:start.aiBias});
  const commands=original.commands;let cursor=0,frame=0,extended=0;
  while(!r.race.finished&&r.race.t<610){
    while(cursor+1<commands.length&&commands[cursor+1][0]<=frame)cursor++;
    H.control={targetV:commands[cursor][1],targetT:commands[cursor][2]};
    if(frame>original.finishFrame)extended++;
    r.step(DT);frame++;
  }
  if(!H.place||!Number.isFinite(H.time)||H.dnf)throw new Error('Solo replay did not finish '+JSON.stringify({...job,id:H.id}));
  const row=serialise(H,null);row.frames=frame;row.extendedSeconds=extended*DT;
  row.crowdMinusSoloTime=original.time-row.time;row.crowdMinusSoloFinal600=original.final600-row.final600;
  return row;
}
function work(job,S,B,progress=()=>{}){
  const crowd=runCrowd(job,S,B);progress('crowd-complete');
  const solo=crowd.horses.map((_,i)=>replaySolo(job,crowd,i,S));progress('solo16-complete');
  const neutral=runCrowd({...job,neutral:true},S,B,false),soloMetrics=aggregate(solo);
  const differences={};for(const k of Object.keys(crowd.metrics))if(typeof crowd.metrics[k]==='number')differences[k]={
    crowdMinusSolo:crowd.metrics[k]-soloMetrics[k],normalMinusNeutral:crowd.metrics[k]-neutral.metrics[k]};
  return {job,crowd:{initial:crowd.initial,metrics:crowd.metrics,horses:crowd.horses},
    solo:{metrics:soloMetrics,horses:solo},neutral:{metrics:neutral.metrics,horses:neutral.horses},differences};
}
function summary(rows){
  const arms={};for(const arm of ['crowd','solo','neutral']){arms[arm]={};for(const k of Object.keys(rows[0][arm].metrics))if(typeof rows[0][arm].metrics[k]==='number')arms[arm][k]=distribution(rows.map(r=>r[arm].metrics[k]));}
  const paired={};for(const key of Object.keys(rows[0].differences))paired[key]={crowdMinusSolo:distribution(rows.map(r=>r.differences[key].crowdMinusSolo)),
    normalMinusNeutral:distribution(rows.map(r=>r.differences[key].normalMinusNeutral))};
  const horses=rows.flatMap(r=>r.crowd.horses);return {raceCount:rows.length,arms,paired,
    targetVAfter200Cv:distribution(horses.map(h=>h.targetVAfter200.cv)),targetRangeAfter200:distribution(horses.map(h=>h.targetVAfter200.max-h.targetVAfter200.min)),
    actualMinusTargetAfter200:distribution(horses.map(h=>h.targetVsActualAfter200.meanActual-h.targetVsActualAfter200.meanTarget)),
    secondHalfMinusFirstHalfTarget:distribution(horses.map(h=>h.endHalfTargets.secondHalfMean-h.endHalfTargets.firstHalfMean)),
    blockedSeconds:distribution(horses.map(h=>h.blockedSeconds)),draftSeconds:distribution(horses.map(h=>h.draftSeconds)),
    reserveAtFinish:distribution(horses.map(h=>h.reserveFraction)),retentionAtFinish:distribution(horses.map(h=>h.retention)),
    individualCrowdMinusSoloTime:distribution(rows.flatMap(r=>r.solo.horses).map(h=>h.crowdMinusSoloTime)),
    individualCrowdMinusSoloFinal600:distribution(rows.flatMap(r=>r.solo.horses).map(h=>h.crowdMinusSoloFinal600)),
    modeSeconds:horses.reduce((all,h)=>{for(const [k,v] of Object.entries(h.modeSeconds))all[k]=(all[k]||0)+v;return all;},{})};
}
// A completed checkpoint row is reusable only when its full job and stored
// measurement schema still match. Never turn an error or a partial arm into a
// completed intervention merely because its distance/replicate is present.
function validateRow(row,jobs){
  assert(row&&typeof row==='object','Expected a tempo row');
  assert.deepEqual(Object.keys(row).sort(),['crowd','differences','job','neutral','solo']);
  const job=jobs.find(j=>j.length===row.job?.length&&j.replicate===row.job?.replicate);
  assert(job,'Unknown checkpoint job');assert.deepEqual(row.job,job,'Checkpoint job changed');
  const numberKeys=['gate','time','place','final600','first200','last200','reserveFraction','retention',
    'blockedSeconds','draftSeconds','energyUsed','aerobicUsed','unpaidWork','workBalanceError','reserveBalanceError','peakSpeed'];
  const axes=['version','endurance','power','economy','kinetics','durability'];
  const sections=job.length/200;
  for(const arm of ['crowd','solo','neutral']){
    const group=row[arm];assert(group&&Array.isArray(group.horses)&&group.horses.length===job.n,'Incomplete '+arm+' arm');
    assert.equal(new Set(group.horses.map(h=>h.id)).size,job.n,'Duplicate '+arm+' horse');
    if(arm!=='solo')assert.deepEqual(group.horses.map(h=>h.place).sort((a,b)=>a-b),Array.from({length:job.n},(_,i)=>i+1));
    for(const h of group.horses){
      assert(typeof h.id==='string'&&h.id.length>0,'Invalid horse ID');
      assert(numberKeys.every(k=>Number.isFinite(h[k])),'Nonfinite horse result');assert(h.time>0&&h.final600>0&&h.first200>0,'Invalid horse time');
      assert(Number.isInteger(h.gate)&&h.gate>=1&&h.gate<=job.n,'Invalid gate');
      if(arm==='solo')assert.equal(h.place,1,'Solo did not finish first');
      assert(Array.isArray(h.sectionals)&&h.sectionals.length===sections,'Incomplete sectionals');
      for(let i=0;i<sections;i++){const s=h.sectionals[i];assert.equal(s.distance,(i+1)*200);assert(Number.isFinite(s.time)&&Number.isFinite(s.split)&&s.split>0);
        assert.equal(s.time-(h.sectionals[i-1]?.time||0),s.split,'Inconsistent individual split');}
      assert.equal(h.sectionals.at(-1).time,h.time,'Finish time differs from final marker');
      assert(h.physiology&&axes.every(k=>Number.isFinite(h.physiology[k]))&&h.physiology.version===1,'Missing physiology');
      assert(axes.slice(1).every(k=>Math.abs(h.physiology[k])<=1),'Invalid physiology axis');
      assert(h.physiologicalParameters&&['aerobic','capacity','reservePower','tau'].every(k=>Number.isFinite(h.physiologicalParameters[k])&&h.physiologicalParameters[k]>0),'Missing physiological parameters');
      assert(h.workBalanceError<1e-6&&h.reserveBalanceError<1e-6&&h.unpaidWork<1e-6,'Checkpoint work ledger failed');
      if(arm==='crowd'){
        assert(Number.isInteger(h.finishFrame)&&h.finishFrame>=0,'Missing finish frame');
        assert(Array.isArray(h.commands)&&h.commands.length>0&&h.commands[0][0]===0,'Missing original commands');
        for(let i=0;i<h.commands.length;i++){const c=h.commands[i];assert(Array.isArray(c)&&c.length===4&&Number.isInteger(c[0])&&c[0]>=0&&c[0]<=h.finishFrame&&Number.isFinite(c[1])&&Number.isFinite(c[2])&&typeof c[3]==='string');
          if(i)assert(c[0]>h.commands[i-1][0],'Command frames must increase');}
        assert(Array.isArray(h.samples)&&h.samples.length>0,'Missing original states');
        for(const s of h.samples)assert(Array.isArray(s)&&s.length===LABELS.length&&s.slice(0,7).every(Number.isFinite)&&typeof s[7]==='string','Invalid original state');
        assert(h.modeSeconds&&Object.values(h.modeSeconds).every(v=>Number.isFinite(v)&&v>=0));
        assert(h.targetVAfter200&&['min','max','cv'].every(k=>Number.isFinite(h.targetVAfter200[k])));
        assert(h.targetVsActualAfter200&&['meanTarget','meanActual'].every(k=>Number.isFinite(h.targetVsActualAfter200[k])));
        assert(h.endHalfTargets&&['firstHalfMean','secondHalfMean'].every(k=>Number.isFinite(h.endHalfTargets[k])));
      }else if(arm==='solo')assert(['frames','extendedSeconds','crowdMinusSoloTime','crowdMinusSoloFinal600'].every(k=>Number.isFinite(h[k])),'Missing replay result');
    }
    assert.deepEqual(group.metrics,aggregate(group.horses),'Stored '+arm+' metrics differ from individual sectionals');
  }
  assert(Array.isArray(row.crowd.initial)&&row.crowd.initial.length===job.n,'Missing crowd initial states');
  for(let i=0;i<job.n;i++){
    const start=row.crowd.initial[i],h=row.crowd.horses[i],solo=row.solo.horses[i],neutral=row.neutral.horses[i];
    assert.equal(start.id,h.id);assert.equal(solo.id,h.id);assert.equal(neutral.id,h.id);
    assert(['startDelay','t','targetT','gate','aiBias'].every(k=>Number.isFinite(start[k])),'Invalid initial state');
    assert.equal(start.gate,h.gate);assert.equal(solo.gate,h.gate);assert.equal(neutral.gate,h.gate);
    assert.equal(solo.crowdMinusSoloTime,h.time-solo.time);assert.equal(solo.crowdMinusSoloFinal600,h.final600-solo.final600);
    assert.deepEqual(solo.physiology,h.physiology);assert.deepEqual(solo.physiologicalParameters,h.physiologicalParameters);
  }
  const differences={};for(const k of Object.keys(row.crowd.metrics))if(typeof row.crowd.metrics[k]==='number')differences[k]={
    crowdMinusSolo:row.crowd.metrics[k]-row.solo.metrics[k],normalMinusNeutral:row.crowd.metrics[k]-row.neutral.metrics[k]};
  assert.deepEqual(row.differences,differences,'Stored intervention difference changed');
  return job.length+':'+job.replicate;
}
if(!isMainThread&&require.main===module){
  try{const S=api(workerData.source),B=api(workerData.baseline);for(const job of workerData.jobs)parentPort.postMessage({row:work(job,S,B,
    stage=>parentPort.postMessage({progress:{length:job.length,replicate:job.replicate,stage}}))});}
  catch(error){parentPort.postMessage({error:error.stack});process.exitCode=1;}
}else if(require.main===module){
  const args=process.argv.slice(2),arg=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
  const sourcePath=path.resolve(ROOT,arg('--source-archive','sim.js'));
  const readSource=()=>{const b=fs.readFileSync(sourcePath);return(b[0]===0x1f&&b[1]===0x8b?zlib.gunzipSync(b):b).toString('utf8');};
  const source=readSource(),sourceArtifact={path:sourcePath,kind:args.includes('--source-archive')?'explicit-artifact':'workspace',contentHash:HASH(source)};
  if(args.includes('--check-source')){console.log(JSON.stringify({sourceArtifact,engineHash:HASH(source)}));process.exit(0);}
  assert.equal(HASH(source),NUMERIC_HASH,'Tempo requires the registered frozen v9 numerical source');
  const baseline=execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6});
  const sourceHashes=Object.fromEntries(SOURCES.map(p=>[p,HASH(fs.readFileSync(path.join(ROOT,p),'utf8'))]));
  const cases=[['中山芝外A','右回'],['東京芝A','左回'],['東京芝A','左回'],['東京芝A','左回'],['京都芝外A','右回'],['京都芝外A','右回']];
  const jobs=DIST.flatMap((length,i)=>Array.from({length:2},(_,k)=>{const seed=(2026100207+i*100003+k*7919)>>>0;
    return {length,course:cases[i][0],dir:cases[i][1],n:16,seed,raceSeed:(seed^0x9e3779b9)>>>0,external:true,context:'tempo-diagnostic',weight:58,replicate:k};}));
  const report={engineHash:HASH(source),baselineHash:HASH(baseline),sourceHashes,startedAt:new Date().toISOString(),protocol:{
    n:16,level:86,distances:DIST,replicates:2,dt:DT,expected:{crowd:12,solo:192,neutral:12},
    field:'Identical published v8-generated stats/behavior/plan/state across arms, separate generation/race streams; 58kg/480kg/healthy/elite-good rider/良/zero wind.',
    commands:'Compressed events [60Hz frame index, targetV, targetT, mode], recorded after each original step and applied before the same replay step.',
    samples:{frequencySeconds:1,columns:LABELS},
    solo:'One horse replays original wall-clock commands, same physiology/course/lateral start/gate/startDelay/aiBias, no AI. Combines removal of traffic and drafting; not a complete rider-strategy counterfactual.',
    neutral:'V9 latent heterogeneity only; current ability mapping and adaptive AI retained. Not a v8 physiology rollback and not the same control commands.',
    reference:'Source files frozen for context; these synthetic 16-horse jobs are mechanism interventions rather than six actual race reconstructions.',
    extension:'If solo survives beyond original race duration, holds the final command; reported separately.',
    metrics:'Solo synthetic leader splits computed from earliest individual crossing time at each marker; may switch horse, matching leader-marker convention.'},samples:[],errors:[]};
  const out=path.resolve(ROOT,arg('--out','docs/tempo-system-v9.json')),start=Date.now();
  const workers=Number(arg('--workers','2'));assert(Number.isInteger(workers)&&workers>0&&workers<=jobs.length,'--workers must be an integer from 1 to 12');
  const seen=new Set();
  if(args.includes('--resume')){
    const saved=JSON.parse(fs.readFileSync(out,'utf8'));
    assert.equal(saved.engineHash,report.engineHash,'Resume source changed');assert.equal(saved.baselineHash,report.baselineHash,'Resume baseline changed');
    assert.deepEqual(saved.sourceHashes,sourceHashes,'Resume reference files changed');
    const oldProtocol={...saved.protocol},newProtocol={...report.protocol};delete oldProtocol.sourceArtifact;delete newProtocol.sourceArtifact;
    assert.deepEqual(oldProtocol,newProtocol,'Resume protocol changed');
    assert(Array.isArray(saved.errors)&&saved.errors.length===0,'Resume refuses failed jobs; resolve the failure first');
    assert(Array.isArray(saved.samples)&&saved.samples.length<=jobs.length,'Invalid checkpoint samples');
    for(const row of saved.samples){const key=validateRow(row,jobs);assert(!seen.has(key),'Duplicate checkpoint job');seen.add(key);}
    assert(saved.integrity&&saved.integrity.counts,'Missing checkpoint integrity');
    assert.deepEqual(saved.integrity.counts,{crowd:saved.samples.length,solo:saved.samples.length*16,neutral:saved.samples.length},'Checkpoint counts differ');
    assert(saved.integrity.sourceUnchanged!==false&&saved.integrity.referenceUnchanged!==false&&saved.integrity.allFinite!==false,'Checkpoint integrity failed');
    if(saved.integrity.complete){
      assert.equal(saved.samples.length,jobs.length,'Completed report lacks jobs');
      assert(saved.integrity.sourceUnchanged&&saved.integrity.referenceUnchanged&&saved.integrity.allFinite,'Completed report integrity did not pass');
      assert.deepEqual(saved.summary,summary(saved.samples),'Completed summary differs from rows');
      assert.deepEqual(saved.byDistance,DIST.map(length=>({length,...summary(saved.samples.filter(r=>r.job.length===length))})),'Completed distance summaries differ');
      assert(['maxWorkError','maxReserveError','maxUnpaid'].every(k=>Number.isFinite(saved.integrity[k])&&saved.integrity[k]<1e-6),'Completed ledger did not pass');
      console.log('All 12 jobs already complete and validated; report left unchanged.');process.exit(0);
    }
    report.samples=saved.samples;report.startedAt=saved.startedAt;
    report.resumedAt=new Date().toISOString();report.resume={completedRows:saved.samples.length,checkpointHash:HASH(fs.readFileSync(out,'utf8')),
      previousElapsedSeconds:Number.isFinite(saved.elapsedSeconds)?saved.elapsedSeconds:null,
      timing:'elapsedSeconds is this execution segment; an older interrupted checkpoint may not record its active CPU/wall duration.'};
    console.log('Resuming '+seen.size+'/12 completed jobs; all saved jobs and measurements validated.');
  }
  report.protocol.sourceArtifact=sourceArtifact;
  const remaining=jobs.filter(j=>!seen.has(j.length+':'+j.replicate)),count=Math.min(workers,remaining.length);let ended=0;
  const write=()=>{const temporary=out+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(report)+'\n');fs.renameSync(temporary,out);};
  const finish=()=>{
    report.samples.sort((a,b)=>a.job.length-b.job.length||a.job.replicate-b.job.replicate);
    if(report.samples.length)report.summary=summary(report.samples);
    report.byDistance=DIST.map(length=>({length,...(report.samples.some(r=>r.job.length===length)?summary(report.samples.filter(r=>r.job.length===length)):{raceCount:0})}));
    const horses=report.samples.flatMap(r=>[...r.crowd.horses,...r.solo.horses,...r.neutral.horses]);
    report.integrity={complete:report.samples.length===12&&report.errors.length===0,
      counts:{crowd:report.samples.length,solo:report.samples.reduce((a,r)=>a+r.solo.horses.length,0),neutral:report.samples.length},
      sourceUnchanged:HASH(readSource())===report.engineHash,
      referenceUnchanged:SOURCES.every(p=>HASH(fs.readFileSync(path.join(ROOT,p),'utf8'))===sourceHashes[p]),
      allFinite:horses.every(h=>[h.time,h.final600,h.reserveFraction,h.retention].every(Number.isFinite)),
      maxWorkError:Math.max(0,...horses.map(h=>h.workBalanceError)),maxReserveError:Math.max(0,...horses.map(h=>h.reserveBalanceError)),maxUnpaid:Math.max(0,...horses.map(h=>h.unpaidWork))};
    report.elapsedSeconds=(Date.now()-start)/1000;write();
    console.log(JSON.stringify({output:out,engineHash:report.engineHash,integrity:report.integrity,summary:report.summary},null,2));
    if(!report.integrity.complete||!report.integrity.sourceUnchanged||!report.integrity.referenceUnchanged||!report.integrity.allFinite||report.integrity.maxUnpaid>1e-6)process.exitCode=1;
  };
  if(!count)finish();
  for(let i=0;i<count;i++){
    const worker=new Worker(__filename,{workerData:{source,baseline,jobs:remaining.filter((_,j)=>j%count===i)}});
    worker.on('message',m=>{if(m.error){report.errors.push(m.error);console.error(m.error);}else if(m.progress){
      console.log('Progress '+m.progress.length+'m seed'+m.progress.replicate+' '+m.progress.stage+' '+((Date.now()-start)/1000).toFixed(1)+'s');
    }else{try{const key=validateRow(m.row,jobs);assert(!seen.has(key),'Duplicate worker job');seen.add(key);}catch(error){
      report.errors.push(error.stack);console.error(error);worker.terminate();return;}
      report.samples.push(m.row);report.integrity={complete:false,counts:{crowd:report.samples.length,
      solo:report.samples.length*16,neutral:report.samples.length},checkpoint:true};
      report.elapsedSeconds=(Date.now()-start)/1000;write();
      console.log('Measured '+report.samples.length+'/12 crowd+replays '+((Date.now()-start)/1000).toFixed(1)+'s');}});
    worker.on('error',e=>{report.errors.push(e.stack);console.error(e);});worker.on('exit',code=>{
      if(code)report.errors.push('worker exit '+code);if(++ended!==count)return;
      finish();
    });
  }
}
module.exports={runCrowd,replaySolo,aggregate,summary,validateRow};
