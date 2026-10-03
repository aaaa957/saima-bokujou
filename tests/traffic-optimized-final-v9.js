#!/usr/bin/env node
'use strict';
// Exact paired-state regression for performance changes only. Archived sources
// remain isolated from production. A finished reference stage is saved before
// the optimized stage starts; unfinished stages never count as passed cases.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const zlib=require('node:zlib'),crypto=require('node:crypto'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const output=path.resolve(ROOT,option('--out','docs/traffic-optimized-final-v9.json'));
const checkpointDirectory=path.resolve(ROOT,option('--checkpoint-dir',path.join(path.dirname(output),'.traffic-optimized-final-v9-checkpoints')));
const hash=source=>crypto.createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const BEFORE_HASH='ac9dc7f3f8d9a6bf001ad6aef979021b3e7d59a9c5d5cdf36dd7884182f99d84';
const AFTER_HASH='3b837b46bf03ed86a19fdbe0ff83a03bb4fd2211ff9a4692b2f1a78e12f221ff';
// The only unchecksummed legacy input accepted is the exact seven-case report
// recovered before adding this checkpoint format. This prevents downgrade to
// the legacy format from bypassing new row/stage checksums.
const LEGACY_REPORT_HASH='57abd775f7866cca7f58fa79e3f7c9a04d3c1bda0429441617b90acdee404937';
const beforePath=path.join(ROOT,'docs/system-heading-source-ac9dc7-v9.js.gz');
const sourcePath=path.resolve(ROOT,option('--source-archive','docs/system-numeric-source-3b837b-v9.js.gz'));
const readSource=file=>{const b=fs.readFileSync(file);return(b[0]===0x1f&&b[1]===0x8b?zlib.gunzipSync(b):b).toString('utf8');};
const beforeSource=readSource(beforePath),afterSource=readSource(sourcePath);
const sourceArtifact={path:sourcePath,kind:args.includes('--source-archive')?'explicit-artifact':'frozen-numeric-artifact',contentHash:hash(afterSource)};
const KEYS=['s','t','v','stamina','guts','retention','targetV','targetT'];
const EXTENDED_FIELDS=['s','t','v','prevV','accel','stamina','guts','retention','aerobicOutput','cumulativeWork','targetV','targetT','control','action','blocked','blocker','statsSummary','trafficStep','finished','time','final600','sectionals'];
const configurations=[
  {length:1600,course:'東京芝A',n:16,seed:2026100207,seconds:10},
  {length:1600,course:'東京芝A',n:18,seed:2026100207,seconds:10},
  {length:2000,course:'東京芝A',n:16,seed:2026100207,seconds:10},
  {length:2000,course:'東京芝A',n:18,seed:2026100207,seconds:20},
  {length:1200,course:'中山芝外A',n:18,seed:2026100207,seconds:20,healthy:true},
  {length:3200,course:'京都芝外A',n:16,seed:3198001206,raceSeed:548067727,seconds:20,healthy:true},
  {length:1200,course:'标准',n:16,seed:3198315393,raceSeed:546640440,healthy:true},
  {length:3200,course:'京都芝外A',n:16,seed:3198001206,raceSeed:548067727,healthy:true},
];
const protocolIdentity={stage:'repaired-heading-exact-traffic',shortCases:6,wholeCases:2,configurations,keys:KEYS,extendedFrameFields:EXTENDED_FIELDS,extendedHashIncludesMotionLedger:true,hz:60,wholeLimitSeconds:610,beforeHash:BEFORE_HASH,engineHash:AFTER_HASH};
const protocolHash=digest(protocolIdentity),caseKey=config=>digest(config);
const atomicWrite=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,file);};
const finite=(value,label)=>{assert.equal(typeof value,'number',label+' must be numeric');assert(Number.isFinite(value),label+' must be finite');};
const positive=(value,label)=>{finite(value,label);assert(value>0,label+' must be positive');};
function finiteTree(value,label){
  if(typeof value==='number')assert(Number.isFinite(value),label+' contains a nonfinite number');
  else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value))finiteTree(item,label+'.'+key);
}
function validateResult(result,config,label){
  assert(result&&typeof result==='object',label+' missing');finiteTree(result,label);
  assert.match(result.extendedHash,/^[0-9a-f]{64}$/);assert(Number.isInteger(result.frames)&&result.frames>0&&result.frames<=Math.ceil(610*60)+1,label+' invalid frame count');
  for(const key of ['wallSeconds','cpuSeconds','median','p95','p99','max'])positive(result[key],label+'.'+key);
  assert(result.median<=result.p95&&result.p95<=result.p99&&result.p99<=result.max,label+' unordered timing percentiles');
  assert.equal(typeof result.finished,'boolean');
  if(config.seconds){assert.equal(result.finished,false,label+' prefix unexpectedly finished');assert.equal(result.frames,config.seconds*60,label+' prefix truncated');}
  else assert.equal(result.finished,true,label+' whole race incomplete');
  assert(result.traffic&&typeof result.traffic==='object');assert.equal(result.traffic.steps,result.frames);
  assert.equal(result.traffic.infeasibleSteps,0,label+' infeasible traffic');
  assert(Array.isArray(result.horseFinal)&&result.horseFinal.length===config.n,label+' missing horses');
  const ids=new Set();
  for(let i=0;i<config.n;i++){
    const horse=result.horseFinal[i];assert.equal(horse.id,'h'+(i+1),label+' horse identity/order');assert(!ids.has(horse.id));ids.add(horse.id);
    for(const key of ['targetV','targetT','reserve'])finite(horse[key],label+'.horse.'+key);
    assert(Array.isArray(horse.sectionals));let previous=0;
    for(let j=0;j<horse.sectionals.length;j++){
      const split=horse.sectionals[j];assert.equal(split.distance,200*(j+1));positive(split.time,label+'.sectional.time');positive(split.split,label+'.sectional.split');
      assert(split.time>previous);assert(Math.abs(split.split-(split.time-previous))<1e-10);previous=split.time;
      finite(split.stamina,label+'.sectional.stamina');finite(split.guts,label+'.sectional.guts');
    }
    if(config.seconds){assert.equal(horse.time,null);assert(horse.final600==null,'prefix cannot have a final600 result');assert(previous<=config.seconds+1/60);}
    else{positive(horse.time,label+'.horse.time');positive(horse.final600,label+'.horse.final600');assert(horse.final600<horse.time);assert.equal(horse.sectionals.length,config.length/200);assert.equal(previous,horse.time);}
  }
}
function validateRow(row){
  assert(row&&configurations.some(config=>canonical(config)===canonical(row.config)),'unknown case configuration');
  assert.equal(row.maxError,0);assert.equal(row.firstDifference,null);assert.equal(row.equalFrames,true);assert.equal(row.allFinalEqual,true);
  validateResult(row.before,row.config,'before');validateResult(row.after,row.config,'after');
  assert.equal(row.before.frames,row.after.frames);assert.equal(row.before.extendedHash,row.after.extendedHash,'extended frame hashes differ');
  assert.deepEqual(row.before.horseFinal,row.after.horseFinal,'final horse data differ');
}
function validateResume(report){
  assert.equal(report.beforeHash,BEFORE_HASH);assert.equal(report.engineHash,AFTER_HASH);assert.equal(report.sourceUnchanged,true);
  assert.deepEqual(report.compiledHashes,{before:BEFORE_HASH,after:AFTER_HASH});
  assert.equal(path.resolve(report.sourceArtifact.path),sourcePath);assert.equal(report.sourceArtifact.contentHash,AFTER_HASH);
  assert(['explicit-artifact','frozen-numeric-artifact'].includes(report.sourceArtifact.kind));
  assert.equal(path.resolve(report.referenceArtifact.path),beforePath);assert.equal(report.referenceArtifact.contentHash,BEFORE_HASH);
  assert.deepEqual(report.keys,KEYS);assert.deepEqual(report.extendedFrameFields,EXTENDED_FIELDS);
  assert(report.protocol&&report.protocol.stage==='repaired-heading-exact-traffic');assert.equal(report.protocol.shortCases,6);assert.equal(report.protocol.wholeCases,2);
  assert.deepEqual(report.protocol.sourceArtifact,report.sourceArtifact);
  const legacy=report.checkpointVersion===undefined;
  if(legacy){assert.equal(digest(report),LEGACY_REPORT_HASH,'unknown or modified unchecksummed legacy report');assert.deepEqual(Object.keys(report.protocol).sort(),['sourceArtifact','stage','shortCases','wholeCases'].sort(),'unexpected legacy protocol');}
  else{assert.equal(report.checkpointVersion,2);assert.equal(report.protocolHash,protocolHash);assert.deepEqual(report.protocol.identity,protocolIdentity);assert.equal(path.resolve(report.checkpointDirectory),checkpointDirectory);}
  assert(Array.isArray(report.rows)&&report.rows.length<=configurations.length);
  const seen=new Set();for(const row of report.rows){validateRow(row);const key=caseKey(row.config);assert(!seen.has(key),'duplicate completed case');seen.add(key);}
  assert.equal(report.complete,report.rows.length===configurations.length);assert.equal(report.allExactEqual,true);assert.equal(report.allStagesExactEqual,report.complete);
  if(!legacy){
    assert(Array.isArray(report.rowProofs)&&report.rowProofs.length===report.rows.length);
    for(let i=0;i<report.rows.length;i++)assert.deepEqual(report.rowProofs[i],{caseKey:caseKey(report.rows[i].config),rowHash:digest(report.rows[i]),beforeExtendedHash:report.rows[i].before.extendedHash,afterExtendedHash:report.rows[i].after.extendedHash});
    assert(Array.isArray(report.stageCheckpoints));const stages=new Set();
    for(const entry of report.stageCheckpoints){
      assert(configurations.some(config=>caseKey(config)===entry.caseKey));assert(['before','after'].includes(entry.stage));
      const stageIdentity=entry.caseKey+':'+entry.stage;assert(!stages.has(stageIdentity),'duplicate stage checkpoint');stages.add(stageIdentity);
      assert.equal(path.resolve(entry.path),stagePath(entry.caseKey,entry.stage));assert.match(entry.contentHash,/^[0-9a-f]{64}$/);
      const saved=validateStage(readStageFile(entry.path),entry.caseKey,entry.stage,entry.contentHash);
      const completed=report.rows.find(row=>caseKey(row.config)===entry.caseKey);if(completed)assert.deepEqual(saved.result,completed[entry.stage],'stage result differs from its completed row');
    }
  }
  return {legacy,rows:report.rows};
}
const stagePath=(key,stage)=>path.join(checkpointDirectory,key+'.'+stage+'.json.gz');
function readStageFile(file){return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));}
function validateStage(envelope,key,stage,expectedHash){
  assert.equal(envelope.contentHash,digest(envelope.payload),'stage content hash mismatch');if(expectedHash)assert.equal(envelope.contentHash,expectedHash);
  const p=envelope.payload;assert.equal(p.checkpointVersion,2);assert.equal(p.protocolHash,protocolHash);assert.equal(p.caseKey,key);assert.equal(p.stage,stage);
  assert.equal(p.sourceHash,stage==='before'?BEFORE_HASH:AFTER_HASH);assert.equal(p.referenceHash,BEFORE_HASH);assert.equal(p.engineHash,AFTER_HASH);
  assert.equal(caseKey(p.config),key);assert(configurations.some(config=>canonical(config)===canonical(p.config)),'stage unknown case');
  validateResult(p.result,p.config,stage);assert(Array.isArray(p.trace)&&p.trace.length===p.result.frames);assert.equal(p.traceHash,digest(p.trace));
  for(const frame of p.trace){assert(Array.isArray(frame)&&frame.length===p.config.n);for(const values of frame){assert(Array.isArray(values)&&values.length===KEYS.length);for(const value of values)finite(value,'stage trace');}}
  for(let i=0;i<p.config.n;i++){const last=p.trace.at(-1)[i],horse=p.result.horseFinal[i];assert.equal(last[3],horse.reserve);assert.equal(last[6],horse.targetV);assert.equal(last[7],horse.targetT);}
  return {trace:p.trace,result:p.result};
}
function api(source){const filename=path.join(ROOT,'sim.perf-snapshot.js'),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(source,filename);return loaded.exports;}
function run(S,fieldS,config,stage){
  const entries=fieldS.makeField(fieldS.mulberry32(config.seed),{n:config.n,level:70});
  for(const h of entries){h.surface='草地';h.special='左右皆可';
    if(config.healthy)Object.assign(h,{'疲劳':0,'斗志':50,jockeyGrade:'普通',bodyMass:480,carriedWeight:57});
    if(config.equal)for(const key of Object.keys(h.stats))h.stats[key]=70;
  }
  const r=S.createRace(JSON.parse(JSON.stringify(entries)),{length:config.length,course:config.course,
    dir:config.course==='東京芝A'?'左回':undefined,profile:'平坦',surface:'草地',state:'良',
    rng:S.mulberry32(config.raceSeed??((config.seed^0x9e3779b9)>>>0))});
  const trace=[],durations=[],extendedHash=crypto.createHash('sha256'),wallStart=performance.now(),cpuStart=process.cpuUsage();let lastProgress=wallStart;
  while(!r.race.finished&&r.race.t<(config.seconds||610)){
    const start=performance.now();r.step(1/60);durations.push(performance.now()-start);
    trace.push(r.race.horses.map(h=>KEYS.map(key=>{assert(Number.isFinite(h[key]));return h[key];})));
    extendedHash.update(JSON.stringify(r.race.horses.map(h=>({s:h.s,t:h.t,v:h.v,prevV:h.prevV,accel:h.accel,stamina:h.stamina,guts:h.guts,retention:h.retention,aerobicOutput:h.aerobicOutput,cumulativeWork:h.cumulativeWork,targetV:h.targetV,targetT:h.targetT,control:h.control,action:h.action,blocked:h.blocked,blocker:h.blocker?.id??null,statsSummary:h.statsSummary,motionLedger:h.motionLedger,trafficStep:h.trafficStep,finished:h.finished,time:h.time,final600:h.final3f,sectionals:h.sectionals}))));
    const now=performance.now();if(now-lastProgress>=15000){const cpu=process.cpuUsage(cpuStart);console.log(JSON.stringify({event:'progress',stage,config,frames:durations.length,raceSeconds:r.race.t,finishedHorses:r.race.horses.filter(h=>h.finished).length,wallSeconds:(now-wallStart)/1000,cpuSeconds:(cpu.user+cpu.system)/1e6}));lastProgress=now;}
  }
  const wallSeconds=(performance.now()-wallStart)/1000,cpu=process.cpuUsage(cpuStart);
  durations.sort((a,b)=>a-b);
  return {trace,result:{extendedHash:extendedHash.digest('hex'),wallSeconds,cpuSeconds:(cpu.user+cpu.system)/1e6,frames:durations.length,
    median:durations[Math.floor(durations.length*.5)],p95:durations[Math.floor(durations.length*.95)],
    p99:durations[Math.floor(durations.length*.99)],max:durations.at(-1),finished:r.race.finished,
    traffic:r.race.traffic,horseFinal:r.race.horses.map(h=>({id:h.id,time:h.time,final600:h.final3f,
      sectionals:h.sectionals,targetV:h.targetV,targetT:h.targetT,reserve:h.stamina}))}};
}
function main(){
  assert.equal(hash(beforeSource),BEFORE_HASH);assert.equal(hash(afterSource),AFTER_HASH);
  if(args.includes('--check-source')){console.log(JSON.stringify({sourceArtifact,engineHash:AFTER_HASH,beforeHash:BEFORE_HASH,protocolHash}));return;}
  let rows=[],stageCheckpoints=[],priorFileHash=null,legacyMigrated=false;
  if(args.includes('--resume')||args.includes('--check-resume')){
    const bytes=fs.readFileSync(output),prior=JSON.parse(bytes.toString('utf8')),verified=validateResume(prior);
    rows=verified.rows;legacyMigrated=verified.legacy;priorFileHash=crypto.createHash('sha256').update(bytes).digest('hex');stageCheckpoints=prior.stageCheckpoints||[];
    console.log(JSON.stringify({event:'resume-verified',completedCases:rows.length,pendingCases:configurations.length-rows.length,verifiedStages:stageCheckpoints.length,legacyMigrated,priorFileHash,engineHash:AFTER_HASH,beforeHash:BEFORE_HASH}));
    if(args.includes('--check-resume'))return;
  }
  const startedAt=new Date().toISOString();
  const sourceUnchanged=()=>hash(readSource(sourcePath))===AFTER_HASH&&hash(readSource(beforePath))===BEFORE_HASH;
  const saveReport=()=>{
    assert(sourceUnchanged(),'source archives changed during execution');
    rows.sort((a,b)=>configurations.findIndex(config=>caseKey(config)===caseKey(a.config))-configurations.findIndex(config=>caseKey(config)===caseKey(b.config)));
    const complete=rows.length===configurations.length;
    const report={note:'Compare the repaired-heading baseline with the same geometry plus conservative traffic certificates and exact caches. Six short scenarios and two complete races. All horse motion, commands, accounting, traffic flags and sectionals must match exactly; conservative race.traffic slack diagnostics may differ. Source archives compile once; runtimes depend on hardware and concurrent jobs, not browser FPS.',
      beforeHash:BEFORE_HASH,engineHash:AFTER_HASH,sourceArtifact,protocol:{sourceArtifact,stage:'repaired-heading-exact-traffic',shortCases:6,wholeCases:2,identity:protocolIdentity},
      sourceUnchanged:true,referenceArtifact:{path:beforePath,contentHash:BEFORE_HASH},compiledHashes:{before:BEFORE_HASH,after:AFTER_HASH},extendedFrameFields:EXTENDED_FIELDS,keys:KEYS,
      rows,complete,allExactEqual:rows.every(x=>x.maxError===0&&x.equalFrames&&x.allFinalEqual),allStagesExactEqual:complete&&rows.every(x=>x.maxError===0&&x.equalFrames&&x.allFinalEqual),
      checkpointVersion:2,protocolHash,checkpointDirectory,rowProofs:rows.map(row=>({caseKey:caseKey(row.config),rowHash:digest(row),beforeExtendedHash:row.before.extendedHash,afterExtendedHash:row.after.extendedHash})),stageCheckpoints,
      resumption:{startedAt,priorFileHash,legacyMigrated,execution:'single-process sequential stages; case timings retain their actual original runs; unfinished stages are excluded'}};
    atomicWrite(output,JSON.stringify(report,null,2));
  };
  saveReport(); // Register the validated seven legacy rows before costly work.
  const beforeS=api(beforeSource),afterS=api(afterSource);
  function stageRun(config,stage){
    const key=caseKey(config),file=stagePath(key,stage),entry=stageCheckpoints.find(item=>item.caseKey===key&&item.stage===stage);
    if(entry){const saved=validateStage(readStageFile(file),key,stage,entry.contentHash);console.log(JSON.stringify({event:'stage-resumed',stage,config,frames:saved.result.frames,cpuSeconds:saved.result.cpuSeconds}));return saved;}
    // A crash between the two atomic writes can leave a finished stage artifact
    // without its report entry. Validate and register that orphan before reuse.
    if(args.includes('--resume')&&fs.existsSync(file)){
      const envelope=readStageFile(file),saved=validateStage(envelope,key,stage);stageCheckpoints.push({caseKey:key,stage,path:file,contentHash:envelope.contentHash});saveReport();
      console.log(JSON.stringify({event:'stage-orphan-recovered',stage,config,frames:saved.result.frames}));return saved;
    }
    const data=run(stage==='before'?beforeS:afterS,beforeS,config,stage);validateResult(data.result,config,stage);
    const payload={checkpointVersion:2,protocolHash,caseKey:key,stage,sourceHash:stage==='before'?BEFORE_HASH:AFTER_HASH,referenceHash:BEFORE_HASH,engineHash:AFTER_HASH,config,trace:data.trace,traceHash:digest(data.trace),result:data.result};
    const contentHash=digest(payload),envelope={contentHash,payload};
    atomicWrite(file,zlib.gzipSync(Buffer.from(JSON.stringify(envelope))));stageCheckpoints.push({caseKey:key,stage,path:file,contentHash});saveReport();
    console.log(JSON.stringify({event:'stage-complete',stage,config,frames:data.result.frames,cpuSeconds:data.result.cpuSeconds,wallSeconds:data.result.wallSeconds,finished:data.result.finished,checkpointHash:contentHash}));return data;
  }
  for(const config of configurations){
    if(rows.some(row=>caseKey(row.config)===caseKey(config)))continue;
    console.log(JSON.stringify({event:'start',config}));const before=stageRun(config,'before'),after=stageRun(config,'after');
    let maxError=0,firstDifference=null;
    for(let i=0;i<Math.min(before.trace.length,after.trace.length);i++)for(let j=0;j<config.n;j++)for(let k=0;k<KEYS.length;k++){
      const error=Math.abs(before.trace[i][j][k]-after.trace[i][j][k]);
      if(error>maxError){maxError=error;if(!firstDifference)firstDifference={frame:i,horse:j,key:KEYS[k],before:before.trace[i][j][k],after:after.trace[i][j][k]};}
    }
    const row={config,maxError,firstDifference,equalFrames:before.trace.length===after.trace.length,allFinalEqual:JSON.stringify(before.result.horseFinal)===JSON.stringify(after.result.horseFinal),before:before.result,after:after.result};
    validateRow(row);rows.push(row);saveReport();
    console.log(JSON.stringify({event:'result',config,maxError,allFinalEqual:row.allFinalEqual,before:row.before.wallSeconds,after:row.after.wallSeconds,cpuBefore:row.before.cpuSeconds,cpuAfter:row.after.cpuSeconds,p95Before:row.before.p95,p95After:row.after.p95,maxBefore:row.before.max,maxAfter:row.after.max}));
  }
}
if(require.main===module)main();
module.exports={validateResume,validateRow,validateStage,validateResult,configurations,caseKey,digest,protocolHash,protocolIdentity,KEYS,EXTENDED_FIELDS,BEFORE_HASH,AFTER_HASH};
