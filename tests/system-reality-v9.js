#!/usr/bin/env node
'use strict';
// Paired system evaluation. A single immutable source snapshot is sent to each
// worker; generation always uses published v8, keeping opponents/traits fixed.
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto'), Module=require('node:module');
const {execFileSync}=require('node:child_process');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const ROOT=path.resolve(__dirname,'..'), BASE='582ce9046dd8552d950d0296e8500a8234388eff';
const DIST=[1200,1600,2000,2400,3000,3200], DT=1/60;
const HASH=t=>crypto.createHash('sha256').update(t.replace(/\r\n/g,'\n')).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
function api(source){const filename=path.join(ROOT,'sim.snapshot.js'),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(source,filename);return loaded.exports;}
function q(a,p=.5){a=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const k=(a.length-1)*p,i=Math.floor(k);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(k-i);}
function distribution(a){return {n:a.filter(Number.isFinite).length,median:q(a),p90:q(a,.9),min:q(a,0),max:q(a,1)};}
function cv(a){if(!a.length)return null;const m=a.reduce((s,x)=>s+x,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length)/m;}
function category(rank,n){return rank===1?'逃':rank<=Math.ceil(n*.375)?'先':rank<=Math.ceil(n*.625)?'差':'追';}
function fieldFor(job,B,S){
  const h=B.makeField(B.mulberry32(job.seed),{n:job.n,level:job.external?86:70});
  for(const x of h){x.surface='草地';x.special='左右皆可';
    if(job.external||job.context!=='native-official')Object.assign(x,{'疲劳':0,'斗志':50,jockeyGrade:job.external?'优秀':'普通',bodyMass:480,carriedWeight:job.weight??57});
    if(job.context==='equal-ability-flat')for(const k of Object.keys(x.stats))x.stats[k]=70;
    if(job.neutral&&S.neutralPhysiology)x.physiology=S.neutralPhysiology();
  }return clone(h);
}
function measure(job,S,B,trace=false){
  const field=fieldFor(job,B,S),r=S.createRace(field,{length:job.length,course:job.course,dir:job.dir,surface:'草地',state:job.state||'良',profile:'平坦',wind:0,rng:S.mulberry32(job.raceSeed)});
  const horses=r.race.horses, mins=new Map(horses.map(h=>[h.id,0])),maxs=new Map(horses.map(h=>[h.id,0])),commands=new Map(horses.map(h=>[h.id,[]]));
  const checkpoint=job.length-r.race.geo.finishStraight;
  let snapshot=null,half=null,frames=0,maxWorkError=0,maxReserveError=0,maxUnpaid=0,bodyOverlapFrames=0,maxOverlap=0,finite=true,maxMotionError=0;
  const history=[];
  while(!r.race.finished&&r.race.t<610){
    const before=horses.map(h=>({s:h.s,t:h.t,v:h.v,place:h.place}));r.step(DT);frames++;
    const active=horses.filter(h=>!h.place&&!h.dnf),ordered=horses.slice().sort((a,b)=>b.s-a.s);
    if(!snapshot&&ordered[0].s>=checkpoint)snapshot=ordered.map((h,i)=>({id:h.id,rank:i+1,style:category(i+1,job.n)}));
    if(!half&&ordered[0].s>=job.length/2)half=ordered.map(h=>h.id);
    for(let i=0;i<horses.length;i++){
      const h=horses[i],old=before[i],st=h.statsSummary;
      if(!old.place){mins.set(h.id,Math.min(mins.get(h.id),h.accel));maxs.set(h.id,Math.max(maxs.get(h.id),h.accel));}
      maxWorkError=Math.max(maxWorkError,Math.abs(st.workUsed-st.aerobicUsed-st.energyUsed));
      maxReserveError=Math.max(maxReserveError,Math.abs(h.stamina-(h.staminaMax-st.energyUsed+st.recovered)));maxUnpaid=Math.max(maxUnpaid,st.unpaidWork);
      finite=finite&&[h.s,h.t,h.v,h.stamina,h.guts,h.retention].every(Number.isFinite);
      if(!old.place&&(!h.place||h.trafficStep)){const movedS=old.s+(h.trafficStep?.deltaS??(h.s-old.s)),movedT=old.t+(h.trafficStep?.deltaT??(h.t-old.t)),meanLane=(movedT+old.t)/2;
        const forward=S.laneArcDistance?S.laneArcDistance(old.s,movedS,meanLane,r.race.geo):(movedS-old.s)/S.laneProgressCoef((movedS+old.s)/2,meanLane,r.race.geo);
        const distance=Math.hypot(forward,movedT-old.t);
        const motionDt=Math.max(0,Math.min(DT,r.race.t-h.startDelay));
        maxMotionError=Math.max(maxMotionError,Math.abs(distance-(old.v+h.v)*motionDt/2));}
      if(trace&&!old.place)commands.get(h.id).push({targetV:h.targetV,targetT:h.targetT});
    }
    // Body intersection (excluding safety buffer), in the engine's longitudinal
    // and lateral route coordinates. It is an engineering diagnostic, not GPS.
    let overlap=false;
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      const a=active[i],b=active[j],len=(2.25+.55*a.adj['体格']/100+2.25+.55*b.adj['体格']/100)/2;
      const width=S.horseWid?(S.horseWid(a)+S.horseWid(b))/2:((HASH_SOURCE_IS_BASE?1:.65)+(HASH_SOURCE_IS_BASE?.3:.15)*(a.adj['体格']+b.adj['体格'])/200);
      const lateral=width-Math.abs(a.t-b.t),longitudinal=len-Math.abs(a.s-b.s);
      if(lateral>1e-6&&longitudinal>1e-6){overlap=true;maxOverlap=Math.max(maxOverlap,Math.min(lateral,longitudinal));}
    }
    if(overlap)bodyOverlapFrames++;
    if(trace&&frames%30===0)history.push({time:r.race.t,leader:ordered[0].id,horses:horses.filter(h=>!h.place).map(h=>({id:h.id,s:h.s,v:h.v,targetV:h.targetV,reserve:h.stamina/h.staminaMax,retention:h.retention,mode:h.strategy?.mode,blocked:h.blocked}))});
  }
  const order=r.race.order,w=order[0],splits=r.race.sectionals.map(x=>x.split),times=horses.map(h=>h.time),endings=horses.map(h=>h.final3f);
  const records=horses.map(h=>({id:h.id,gate:h.gate,place:h.place,time:h.time,final600:h.final3f,first200:h.sectionals.find(s=>s.distance===200)?.time,
    straightRank:snapshot?.find(x=>x.id===h.id)?.rank,straightStyle:snapshot?.find(x=>x.id===h.id)?.style,observedStyle:h.observedStyle||h.style,
    gapLengths:h.gapAtWin/2.4,blockedSeconds:h.statsSummary.blockedSeconds,draftSeconds:h.statsSummary.draftSeconds,
    minAcceleration:mins.get(h.id),maxAcceleration:maxs.get(h.id),peakSpeed:h.statsSummary.peakSpeed,
    reserve:h.stamina/h.staminaMax,retention:h.retention,physiology:h.h.physiology,physiologicalParameters:{aerobic:h.aerobic,capacity:h.staminaMax,reservePower:h.reservePower,tau:h.aerobicTau},
    stats:h.adj,behavior:h.behavior,traffic:h.statsSummary.traffic??null,sectionals:h.sectionals.map(s=>({distance:s.distance,time:s.time,split:s.split}))}));
  return {...job,finished:r.race.finished&&order.length===job.n&&r.race.dnf.length===0,finite,maxWorkError,maxReserveError,maxUnpaid,maxMotionError,
    bodyOverlapFrames,maxOverlap,frames,minAcceleration:Math.min(...mins.values()),maxAcceleration:Math.max(...maxs.values()),
    winnerTime:w?.time,winnerFinal600:w?.final3f,marginSeconds:order[1]?.time-w?.time,marginLengths:order[1]?.gapAtWin/2.4,
    tailSeconds:Math.max(...times)-w?.time,within1:times.filter(t=>t-w.time<=1+1e-9).length/job.n,within2:times.filter(t=>t-w.time<=2+1e-9).length/job.n,
    final600Span:Math.max(...endings)-Math.min(...endings),first200:splits[0],post200Cv:cv(splits.slice(1).map(x=>Math.round(x*10)/10)),
    last200Difference:splits.at(-1)-splits.at(-2),halfLeaderWon:half?.[0]===w?.id,
    leaderSectionals:splits,horses:records,traffic:r.race.traffic?clone(r.race.traffic):null,
    geo:{course:r.race.geo.course,width:r.race.geo.width??20,finishStraight:r.race.geo.finishStraight,simplification:r.race.geo.simplification},
    ...(trace?{history,commands:Object.fromEntries(commands),inputField:field}: {})};
}
let HASH_SOURCE_IS_BASE=false;
function summary(races){const out={races:races.length,starts:races.reduce((a,r)=>a+r.n,0)};
  for(const k of ['winnerTime','winnerFinal600','marginSeconds','marginLengths','tailSeconds','within1','within2','final600Span','first200','post200Cv','last200Difference','minAcceleration','maxMotionError'])out[k]=distribution(races.map(r=>r[k]));
  out.styles=['逃','先','差','追'].map(style=>{const h=races.flatMap(r=>r.horses).filter(h=>h.observedStyle===style),wins=h.filter(h=>h.place===1).length;return {style,starts:h.length,wins,perStart:h.length?wins/h.length:null};});return out;}
function validateSavedRow(row,key){
  if(typeof row.finished!=='boolean'||typeof row.finite!=='boolean'||!Array.isArray(row.horses)||row.horses.length!==row.n||!Number.isInteger(row.frames)||row.frames<1)throw new Error('Resume incomplete row: '+key);
  for(const k of ['maxWorkError','maxReserveError','maxUnpaid','maxMotionError','bodyOverlapFrames','maxOverlap','minAcceleration','maxAcceleration','winnerTime','winnerFinal600','tailSeconds','within1','within2','final600Span','first200','post200Cv','last200Difference'])if(!Number.isFinite(row[k]))throw new Error('Resume invalid result '+k+': '+key);
  const sectionalCount=row.length/200,ids=new Set(),places=new Set();
  if(!Number.isInteger(sectionalCount)||!Array.isArray(row.leaderSectionals)||row.leaderSectionals.length!==sectionalCount||row.leaderSectionals.some(x=>!Number.isFinite(x)||x<=0))throw new Error('Resume invalid leader sectionals: '+key);
  for(const h of row.horses){
    if(!h||typeof h.id!=='string'||!h.id||ids.has(h.id))throw new Error('Resume invalid horse IDs: '+key);
    ids.add(h.id);
    if(row.finished&&(!Number.isInteger(h.place)||h.place<1||h.place>row.n||places.has(h.place)))throw new Error('Resume invalid finishing places: '+key);
    places.add(h.place);
    for(const k of ['time','final600','first200','reserve','retention'])if(!Number.isFinite(h[k]))throw new Error('Resume invalid horse result '+k+': '+key);
    if(!Array.isArray(h.sectionals)||h.sectionals.length!==sectionalCount)throw new Error('Resume invalid horse sectionals: '+key);
    let previousTime=0;
    for(let i=0;i<sectionalCount;i++){
      const s=h.sectionals[i];
      if(!s||s.distance!==(i+1)*200||!Number.isFinite(s.time)||!Number.isFinite(s.split)||s.time<=previousTime||s.split<=0||Math.abs(s.split-(s.time-previousTime))>1e-8)throw new Error('Resume invalid horse sectional values: '+key);
      previousTime=s.time;
    }
    if(Math.abs(h.sectionals[0].time-h.first200)>1e-8||Math.abs(previousTime-h.time)>1e-8)throw new Error('Resume inconsistent horse sectional endpoints: '+key);
  }
}
if(require.main===module&&!isMainThread){
  try{const S=api(workerData.source),B=api(workerData.baseline);HASH_SOURCE_IS_BASE=HASH(workerData.source)===HASH(workerData.baseline);
    for(const job of workerData.jobs){try{parentPort.postMessage({row:measure(job,S,B,workerData.trace)});}
      catch(e){parentPort.postMessage({error:e.stack,job});process.exitCode=1;}}
  }catch(e){parentPort.postMessage({error:e.stack});process.exitCode=1;}
}else if(require.main===module){
  const args=process.argv.slice(2),arg=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
  const mode=arg('--mode','current'),scope=arg('--scope','full'),seeds=Number(arg('--seeds','12')),workers=Number(arg('--workers','2'));
  if(!['baseline','current'].includes(mode)||!Number.isInteger(seeds)||seeds<1||!Number.isInteger(workers)||workers<1)throw new Error('Invalid mode, seeds or workers');
  const baseline=execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6});
  const sourceArchive=arg('--source-archive',null);
  if(args.includes('--source-archive')&&!sourceArchive)throw new Error('--source-archive requires a path');
  const sourcePath=path.resolve(ROOT,sourceArchive||'sim.js');
  const readSource=()=>{const raw=fs.readFileSync(sourcePath);return (raw[0]===0x1f&&raw[1]===0x8b?require('node:zlib').gunzipSync(raw):raw).toString('utf8');};
  const source=mode==='baseline'?baseline:readSource();
  if(args.includes('--check-source')){console.log(JSON.stringify({engineHash:HASH(source),sourceArtifact:mode==='baseline'?'git:'+BASE+':sim.js':sourcePath}));process.exit(0);}
  const output=path.resolve(ROOT,arg('--out','docs/system-reality-v2026.10.02.3.json'));
  const refs=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/race-reality-reference.json'),'utf8'));
  const fullRefs=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/current-engine-reality-sources-2026-10-02.json'),'utf8'));
  const cases=[['中山芝外A','右回'],['東京芝A','左回'],['東京芝A','左回'],['東京芝A','左回'],['京都芝外A','右回'],['京都芝外A','右回']];
  const jobs=[];
  if(scope==='full'||scope==='external'||scope==='smoke')for(const r of refs.samples){
    if(scope==='smoke'&&r.split!=='holdout')continue;
    for(let k=0;k<(scope==='smoke'?1:3);k++){const seed=(2026100207+DIST.indexOf(r.length)*100003+k*7919)>>>0;
      jobs.push({context:'external',external:true,id:r.id,n:fullRefs.races.find(x=>x.id===r.id).fieldSize,length:r.length,course:r.venue,dir:r.direction,state:r.state,
        weight:r.winner.carriedWeightKg??58,seed,raceSeed:(seed^0x9e3779b9)>>>0,replicate:k});}}
  if(scope==='external2022')for(const r of JSON.parse(fs.readFileSync(path.join(ROOT,'docs/system-external-reference-2022.json'),'utf8')).races){
    for(let k=0;k<3;k++){const seed=(2022100207+DIST.indexOf(r.length)*100003+k*7919)>>>0;
      jobs.push({context:'external2022',external:true,id:r.id,n:r.fieldSize,length:r.length,course:r.course,dir:r.direction,state:r.state,
        weight:r.winner.carriedWeightKg??58,seed,raceSeed:(seed^0x9e3779b9)>>>0,replicate:k});}}
  if(scope==='full'||scope==='population')for(const context of ['native-official','healthy-flat','equal-ability-flat'])for(const n of context==='native-official'?[8,16]:[16])for(let i=0;i<6;i++)for(let k=0;k<(context==='native-official'?seeds:Math.floor(seeds/2));k++){
    const seed=(3197100203+k*104729+(context==='native-official'?n*1000003:901003))>>>0;
    jobs.push({context,n,length:DIST[i],course:context==='native-official'?cases[i][0]:'标准',dir:context==='native-official'?cases[i][1]:'左回',seed,raceSeed:(seed^0x9e3779b9)>>>0,replicate:k});}
  if(scope==='diagnostic')for(const neutral of [false,true])for(let i=0;i<6;i++)for(let k=0;k<3;k++){
    const seed=(2026100207+i*100003+k*7919)>>>0;jobs.push({context:neutral?'neutral-profile':'normal-profile',external:true,neutral,n:16,length:DIST[i],course:cases[i][0],dir:cases[i][1],seed,raceSeed:(seed^0x9e3779b9)>>>0,weight:58,replicate:k});}
  if(!jobs.length)throw new Error('No declared jobs');
  let report={protocol:{baselineCommit:BASE,sourceArtifact:mode==='baseline'?'git:'+BASE+':sim.js':path.relative(ROOT,sourcePath),mode,scope,seeds,totalRaces:jobs.length,dt:DT,fieldGeneration:'Frozen v8 for both arms; identical abilities/behaviors/plans/state; RNG streams separated.',reference:scope==='external2022'?'6 newly frozen 2022 G1 races, synthetic level86; 3 seeds per case, not 18 independent real races. Every horse gets winner weight; not individual reconstruction.':'18 already-viewed G1 races, synthetic level86 and winner weight for every horse; not individual reconstruction or independent holdout.',neutral:'V9 latent-profile heterogeneity intervention only; does not restore all v8 physiology.',acceleration:'Every internal60Hz step observed.'},engineHash:HASH(source),baselineHash:HASH(baseline),startedAt:new Date().toISOString(),samples:[],errors:[]};
  const jobKeys=[...new Set(jobs.flatMap(j=>Object.keys(j)))].sort(),jobKey=j=>JSON.stringify(jobKeys.map(k=>[k,j[k]??null]));
  const declared=new Map(jobs.map(j=>[jobKey(j),j]));
  if(declared.size!==jobs.length)throw new Error('Duplicate declared job');
  const completed=new Set();let previousElapsed=0;
  if(args.includes('--resume')){
    const checkpointText=fs.readFileSync(output,'utf8'),saved=JSON.parse(checkpointText);
    if(saved.engineHash!==report.engineHash||saved.baselineHash!==report.baselineHash)throw new Error('Resume source/baseline hash mismatch');
    for(const k of Object.keys(report.protocol))if(k!=='sourceArtifact'&&saved.protocol?.[k]!==report.protocol[k])throw new Error('Resume protocol mismatch: '+k);
    if(saved.integrity?.sourceUnchanged!==true||!Array.isArray(saved.samples)||!Array.isArray(saved.errors)||saved.errors.length)throw new Error('Resume requires a valid, source-unchanged checkpoint with no errors');
    for(const row of saved.samples){
      const key=jobKey(row);
      if(!declared.has(key)||completed.has(key))throw new Error('Resume foreign or duplicate job: '+key);
      validateSavedRow(row,key);
      completed.add(key);
    }
    if(!Number.isFinite(saved.elapsedSeconds)||saved.elapsedSeconds<0)throw new Error('Resume invalid elapsed time');
    previousElapsed=saved.elapsedSeconds;
    const resume={resumedAt:new Date().toISOString(),checkpointHash:HASH(checkpointText),completedJobs:completed.size,previousElapsedSeconds:previousElapsed,sourceArtifact:report.protocol.sourceArtifact,workers};
    report={...saved,protocol:report.protocol,initialExecution:saved.initialExecution||{startedAt:saved.startedAt,sourceArtifact:saved.protocol.sourceArtifact||'sim.js (legacy checkpoint; exact engine hash verified)',engineHash:saved.engineHash,workers:null,elapsedScope:'Active wall time through checkpoint; CPU seconds and original worker count were not recorded.'},executionRuns:[...(saved.executionRuns||[]),resume]};
    console.log('Resuming '+completed.size+'/'+jobs.length+' verified jobs; '+(jobs.length-completed.size)+' remain.');
  }
  const pending=jobs.filter(j=>!completed.has(jobKey(j)));
  if(args.includes('--check-resume')){
    if(!args.includes('--resume'))throw new Error('--check-resume requires --resume');
    console.log(JSON.stringify({engineHash:report.engineHash,completedJobs:completed.size,pendingJobs:pending.length,totalJobs:jobs.length,checkpointValid:true}));process.exit(0);
  }
  let done=completed.size,ended=0,failed=false;const started=Date.now(),count=Math.min(workers,pending.length);
  const writeCheckpoint=()=>{const temporary=output+'.tmp';fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n');fs.renameSync(temporary,output);};
  const finish=()=>{
      report.samples.sort((a,b)=>a.context.localeCompare(b.context)||a.n-b.n||a.length-b.length||String(a.id).localeCompare(String(b.id))||a.replicate-b.replicate);
      report.summaries=[...new Set(report.samples.map(r=>[r.context,r.n,r.length].join('|')))].map(key=>{const r=report.samples.filter(r=>[r.context,r.n,r.length].join('|')===key);return {context:r[0].context,n:r[0].n,length:r[0].length,...summary(r)};});
      report.integrity={complete:!failed&&done===jobs.length,allFinish:report.samples.every(r=>r.finished),allFinite:report.samples.every(r=>r.finite),
        maxWorkError:Math.max(...report.samples.map(r=>r.maxWorkError)),maxReserveError:Math.max(...report.samples.map(r=>r.maxReserveError)),maxUnpaid:Math.max(...report.samples.map(r=>r.maxUnpaid)),
        minAcceleration:Math.min(...report.samples.map(r=>r.minAcceleration)),bodyOverlapRaces:report.samples.filter(r=>r.bodyOverlapFrames>0).length,
        maxMotionError:Math.max(...report.samples.map(r=>r.maxMotionError)),
        minFollowingSlack:Math.min(...report.samples.map(r=>r.traffic?.minFollowingSlack).filter(Number.isFinite)),
        infeasibleSteps:report.samples.reduce((n,r)=>n+(r.traffic?.infeasibleSteps||0),0),
        sourceUnchanged:mode==='baseline'||HASH(readSource())===report.engineHash};
      report.elapsedSeconds=previousElapsed+(Date.now()-started)/1000;writeCheckpoint();console.log(JSON.stringify({output,integrity:report.integrity},null,2));
      if(!report.integrity.complete||!report.integrity.allFinish||!report.integrity.allFinite||!report.integrity.sourceUnchanged||report.integrity.maxUnpaid>1e-6)process.exitCode=1;
  };
  if(!count)finish();
  for(let i=0;i<count;i++){
    const worker=new Worker(__filename,{workerData:{source,baseline,jobs:pending.filter((_,j)=>j%count===i),trace:scope==='diagnostic'}});
    worker.on('message',m=>{
      if(m.error){failed=true;report.errors.push(m);console.error(JSON.stringify(m));return;}
      const key=jobKey(m.row);
      if(!declared.has(key)||completed.has(key)){failed=true;report.errors.push({error:'Worker returned foreign or duplicate job',job:m.row});return;}
      completed.add(key);report.samples.push(m.row);done++;
      console.log('Measured '+done+'/'+jobs.length+' '+m.row.context+' '+m.row.length+'m n='+m.row.n+' '+((Date.now()-started)/1000).toFixed(1)+'s');
      // Interrupted development runs remain explicitly incomplete and preserve
      // finished jobs; the final worker exit replaces this with full checks.
      report.integrity={complete:false,sourceUnchanged:mode==='baseline'||HASH(readSource())===report.engineHash};
      report.elapsedSeconds=previousElapsed+(Date.now()-started)/1000;
      writeCheckpoint();
    });
    worker.on('error',e=>{failed=true;report.errors.push({error:e.stack});console.error(e);});worker.on('exit',code=>{ended++;if(code){failed=true;report.errors.push({error:'Worker exited with code '+code});}if(ended===count)finish();});
  }
}
module.exports={api,measure,fieldFor,summary,q,distribution,HASH,BASE,DIST,DT};
