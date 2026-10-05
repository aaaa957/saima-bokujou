'use strict';
// Bounded read-only diagnosis. This file and its reports are outside the repo.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {performance}=require('node:perf_hooks'),inspector=require('node:inspector');
const ROOT='D:\\work4\\saima-bokujou',OUT=path.join(__dirname,'traffic-kyoto-prefix-profile-630-v11.json');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),normalize=s=>s.replace(/\r\n/g,'\n');
const sourceFile=path.join(ROOT,'docs/calibration-selected-training-rest-v11.json.source.js.gz');
const paramsFile=path.join(ROOT,'tests/fixtures/race-validation-v11-parameters/selected-nopeak-cost105.json');
const source=normalize(zlib.gunzipSync(fs.readFileSync(sourceFile)).toString()),parameters=JSON.parse(fs.readFileSync(paramsFile,'utf8'));
assert.equal(sha(source),'63068101ae7c0bf80db75094b9b497cde24bb88fe86f3df70fddee397974d4e8');
if(isMainThread){
  const metadata={purpose:'One bounded 120-frame prefix CPU diagnosis, not a complete race or numerical acceptance',sourceFile,sourceHash:sha(source),parametersFile:paramsFile,parametersHash:sha(fs.readFileSync(paramsFile)),parameters,maximumWorkerWallSeconds:60,workerMemoryMb:192,startedAt:new Date().toISOString(),events:[]};
  const worker=new Worker(__filename,{workerData:{source,parameters,deadlineMs:50000},resourceLimits:{maxOldGenerationSizeMb:192}});
  const save=()=>fs.writeFileSync(OUT,JSON.stringify(metadata,null,2)+'\n');save();
  const timer=setTimeout(()=>{metadata.watchdogTerminated=true;metadata.finishedAt=new Date().toISOString();save();worker.terminate();},60000);
  worker.on('message',m=>{metadata.events.push(m);if(m.result){metadata.result=m.result;metadata.finishedAt=new Date().toISOString();clearTimeout(timer);}save();console.log(JSON.stringify(m));});
  worker.on('error',e=>{metadata.error=e.stack;metadata.finishedAt=new Date().toISOString();clearTimeout(timer);save();});
  worker.on('exit',code=>{clearTimeout(timer);metadata.exitCode=code;metadata.sourceArchiveUnchanged=sha(normalize(zlib.gunzipSync(fs.readFileSync(sourceFile)).toString()))===metadata.sourceHash;metadata.parametersUnchanged=sha(fs.readFileSync(paramsFile))===metadata.parametersHash;save();console.log(JSON.stringify({out:OUT,exitCode:code,watchdogTerminated:!!metadata.watchdogTerminated}));});
}else{
  const {compileSource,references,makeJobs,observe}=require(path.join(ROOT,'tests/race-validation-v11.js'));
  const {fieldFor,DT}=require(path.join(ROOT,'tests/system-reality-v9.js'));
  const {execFileSync}=require('node:child_process');
  const generatorSource=normalize(execFileSync('git',['show','582ce9046dd8552d950d0296e8500a8234388eff:sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:8*1024*1024}));
  const job=makeJobs('calibration',references().races,1,'selected').find(j=>j.id==='241020');assert(job&&job.n===18&&job.length===3000);
  const counters=Object.fromEntries(['laneAdvance','forecast','factory','slack','certifyInterval','gapAt','slopeAt','distantProof','routeProof','nowRejected','stopRejected','witnessRejected','fullyCertified','pairCache'].map(k=>[k,0]));
  const wallStart=performance.now(),deadline=wallStart+workerData.deadlineMs;let currentPhase='compile',interrupted=false;
  globalThis.__kyotoProfile={count(k){counters[k]++;if(k==='laneAdvance'&&counters[k]%4096===0&&performance.now()>deadline){interrupted=true;throw new Error('BOUNDED_PREFIX_STOP');}}};
  let instrumented=workerData.source;
  function once(a,b){assert.equal(instrumented.split(a).length-1,1,a);instrumented=instrumented.replace(a,b);}
  const count=k=>'globalThis.__kyotoProfile.count('+JSON.stringify(k)+');';
  for(const [anchor,key] of [
    ['  function laneAdvance(s,physicalDistance,t,geo) {','laneAdvance'],
    ['    function projectActions(H,actions,options={}) {','forecast'],
    ['    function followingConstraintSolver(maximumSpeed) {','factory'],
    ['      function followingSlack(H,F,move,frontMove,withResponse=true) {','slack'],
    ['        function certifyInterval(left,right,depth) {','certifyInterval'],
    ['        function gapAt(time) {','gapAt'],
    ['          const slopeAt=time=>{','slopeAt']
  ])once(anchor,anchor+'\n'+count(key));
  once('if(paired.has(frontMove)) return paired.get(frontMove)-(withResponse?(1/60)*move.v*ownScale:0);','if(paired.has(frontMove)){'+count('pairCache')+'return paired.get(frontMove)-(withResponse?(1/60)*move.v*ownScale:0);}');
  once('if(now<-1e-7) return now;','if(now<-1e-7){'+count('nowRejected')+'return now;}');
  once('if(stop<-1e-7) return stop;','if(stop<-1e-7){'+count('stopRejected')+'return stop;}');
  once('            paired.set(frontMove,lowerBound);\n            return lowerBound-(withResponse?(1/60)*move.v*ownScale:0);','            '+count('distantProof')+'paired.set(frontMove,lowerBound);\n            return lowerBound-(withResponse?(1/60)*move.v*ownScale:0);');
  once('            paired.set(frontMove,lowerBound);return lowerBound-(withResponse?response:0);','            '+count('routeProof')+'paired.set(frontMove,lowerBound);return lowerBound-(withResponse?response:0);');
  once('if(witness<-1e-7)return witness;','if(witness<-1e-7){'+count('witnessRejected')+'return witness;}');
  once('        if(fullyCertified){','        if(fullyCertified){'+count('fullyCertified'));
  const result={job,generatorHash:sha(generatorSource),sourceHash:sha(workerData.source),instrumentedHash:sha(instrumented),instrumentation:'Counter-only function entries and a 50-second wall deadline checked every4096 lane inversions. Original expressions, RNG, controller and geometry unchanged before an intentional abort.',phases:[],fullRace:false,completedDisplayFrames:0,completedInternalTicks:0};
  const session=new inspector.Session();session.connect();
  const call=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(e,x)=>e?reject(e):resolve(x)));
  function compact(profile){
    const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();for(const n of profile.nodes)for(const c of n.children||[])parents.set(c,n.id);
    const self=new Map(),inclusive=new Map();for(const id of profile.samples||[]){self.set(id,(self.get(id)||0)+1);let at=id;while(nodes.has(at)){inclusive.set(at,(inclusive.get(at)||0)+1);at=parents.get(at);}}
    const n=profile.samples?.length||0;const row=(id,hits)=>{const f=nodes.get(id).callFrame;return {name:f.functionName||'(anonymous)',url:f.url,line:f.lineNumber+1,hits,percent:100*hits/n};};
    return {samples:n,elapsedMs:(profile.endTime-profile.startTime)/1000,topSelf:[...self].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([id,hits])=>row(id,hits)),topInclusive:[...inclusive].sort((a,b)=>b[1]-a[1]).slice(0,24).map(([id,hits])=>row(id,hits))};
  }
  async function phase(name,work){
    currentPhase=name;parentPort.postMessage({phase:name,status:'started'});await call('Profiler.start');const before={...counters},started=performance.now(),cpu=process.threadCpuUsage();let value,error=null;
    try{value=work();}catch(e){error=e.message;}
    const used=process.threadCpuUsage(cpu),wall=performance.now()-started,{profile}=await call('Profiler.stop');
    const file=OUT+'.'+name+'.cpuprofile.gz';fs.writeFileSync(file,zlib.gzipSync(JSON.stringify(profile)));
    const report={name,wallSeconds:wall/1000,threadCpuSeconds:(used.user+used.system)/1e6,counters:Object.fromEntries(Object.keys(counters).map(k=>[k,counters[k]-before[k]])),profile:file,...compact(profile),error};result.phases.push(report);parentPort.postMessage({phase:name,status:'complete',wallSeconds:report.wallSeconds,threadCpuSeconds:report.threadCpuSeconds,error});if(error)throw new Error(error);return value;
  }
  (async()=>{
    let r,obs;try{
      const S=compileSource(instrumented),B=compileSource(generatorSource);Object.assign(S.RACE_F,workerData.parameters);await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:1000});
      const proxy={mulberry32:S.mulberry32,makeField:(rng,opts)=>S.makeField(rng,{...opts,length:job.length,race:{length:job.length,surface:'草地',state:job.state,course:job.course,dir:job.dir,profile:'平坦'},playerIndex:-1,entryOverrides:{surface:'草地',special:'左右皆可','疲劳':0,'斗志':50,jockeyGrade:'优秀',bodyMass:480,carriedWeight:job.weight}})};
      const field=await phase('cohort',()=>fieldFor(job,proxy,S));result.inputHash=sha(JSON.stringify(field));result.cohortDiagnostics=field.cohort??null;
      r=await phase('create',()=>S.createRace(field,{length:job.length,course:job.course,dir:job.dir,surface:'草地',state:job.state,profile:'平坦',wind:0,rng:S.mulberry32(job.raceSeed)}));obs=observe(S,r);
      await phase('actual-prefix',()=>{for(let i=0;i<120&&!r.race.finished;i++){if(performance.now()>deadline){interrupted=true;throw new Error('BOUNDED_PREFIX_STOP');}obs.step();result.completedDisplayFrames++;}});
    }catch(e){result.error=e.stack;}
    result.interrupted=interrupted;result.lastPhase=currentPhase;result.elapsedWallSeconds=(performance.now()-wallStart)/1000;
    if(r){result.raceTime=r.race.t;result.finished=r.race.finished;result.horses=r.race.horses.map(h=>({id:h.id,s:h.s,t:h.t,v:h.v,targetV:h.targetV,mode:h.strategy?.mode}));}
    if(obs){result.prefix=obs.result();result.completedInternalTicks=result.prefix.internalTicks;}
    result.counterTotals={...counters};session.disconnect();delete globalThis.__kyotoProfile;parentPort.postMessage({result});
  })().catch(e=>{parentPort.postMessage({fatal:e.stack});process.exitCode=1;});
}
