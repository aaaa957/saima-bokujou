#!/usr/bin/env node
'use strict';
// Three predeclared mechanical/cost candidates; four calibration events each. No reserved-year
// outputs or retrospective dropping of failed jobs enter this small screen.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads'),{HASH,BASE,q,DT}=require('./system-reality-v9');
const {references,makeJobs,runJob,compare,METRICS}=require('./race-validation-v11');
const ROOT=path.resolve(__dirname,'..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const NAMES=['fast80-nopeak','air2-fast80-nopeak-cost105','air2-fast80-nopeak-cost110'];
if(require.main===module&&!isMainThread){for(const job of workerData.jobs){try{parentPort.postMessage({row:runJob(job,workerData.source,workerData.generatorSource,workerData.parameters[job.gridVariant])});}
  catch(e){parentPort.postMessage({job,jobKey:sha(JSON.stringify(job)),error:String(e.stack)});}}}
else if(require.main===module){
  const args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);return i<0?value:args[i+1];};
  const resuming=args.includes('--resume')||args.includes('--check-resume');
  assert(arg('--source')&&arg('--expected-source'),'Explicit immutable source and --expected-source required after controller freeze');
  const sourcePath=path.resolve(ROOT,arg('--source')),read=()=>{const b=fs.readFileSync(sourcePath);return (b[0]===0x1f&&b[1]===0x8b?require('node:zlib').gunzipSync(b):b).toString('utf8');},source=read();
  const expected=arg('--expected-source');assert.equal(HASH(source),expected,'Calibration source not the agreed frozen candidate');
  const names=arg('--variants',NAMES.join(',')).split(','),cohort=arg('--cohort','fixed-v8');assert(names.length>0&&names.every(n=>NAMES.includes(n))&&new Set(names).size===names.length);assert(['fixed-v8','selected'].includes(cohort));
  const generatorSource=execFileSync('git',['show',BASE+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6}),ref=references();
  const cases=makeJobs('calibration',ref.races,1,cohort).filter(j=>[1200,2400].includes(j.length));assert.equal(cases.length,4);
  const parameters=Object.fromEntries(names.map(name=>[name,JSON.parse(fs.readFileSync(path.join(ROOT,'tests/fixtures/race-validation-v11-parameters',name+'.json'),'utf8'))]));
  const manifestPath='tests/fixtures/race-validation-v11-parameters/manifest-mechanical.json',manifestBytes=fs.readFileSync(path.join(ROOT,manifestPath)),manifest=JSON.parse(manifestBytes);
  for(const name of names)assert.deepEqual(parameters[name],manifest.variants.find(v=>v.name===name)?.parameters,'Parameter axis differs from predeclared manifest '+name);
  const jobs=names.flatMap(name=>cases.map(job=>({...job,gridVariant:name}))),declared=new Map(jobs.map(j=>[sha(JSON.stringify(j)),j])),covered=new Set();
  const workers=Number(arg('--workers','1'));assert(Number.isInteger(workers)&&workers>=1&&workers<=2);
  const output=path.resolve(ROOT,arg('--out','docs/calibration-mechanical-v11.json')),driver=fs.readFileSync(path.join(__dirname,'race-validation-v11.js'),'utf8'),orchestrator=fs.readFileSync(__filename,'utf8');
  const protocol={sourceNormalizedSha256:HASH(source),sourceArtifact:path.relative(ROOT,sourcePath),scopeNote:arg('--scope-note','Global initial-response mechanics separated from the full-race peak velocity ceiling. Equal-v18 air-cost reallocation plus 5/10% total cost constrain sustained pace. Three additional predeclared arms after two 1200 training comparisons showed improved start but excessive sustained speed; total nine arms. The newer coarse-first controller prunes follow candidates before final 60Hz commitment checks: this is an explicit strategy change, not a relaxation of physical or target accuracy gates. Cross-controller contrasts against the old six arms cannot be attributed solely to parameters. No distance-specific coefficients or reserved-year tuning.'),generatorCommit:BASE,generatorNormalizedSha256:HASH(generatorSource),driverNormalizedSha256:HASH(driver),orchestratorNormalizedSha256:HASH(orchestrator),workers,
    variants:names,parameters,jobs,referenceHashes:ref.hashes,cohort,dt:DT,workerOldGenerationLimitMb:192,parameterAxisProvenance:{file:manifestPath,sha256:sha(manifestBytes),sourceAtAxisDeclaration:manifest.sourceNormalizedSha256,scope:'All three global parameter axes were predeclared before dispatch and remain unchanged. The source tested by this grid is sourceNormalizedSha256. A newer coarse-first follow controller is an explicit strategy change, so earlier six-arm outputs are immutable exploratory evidence rather than a pure parameter baseline for these three arms.'},scope:'Four 2023/2024 official calibration events (1200/2400), one seed each, explicitly named candidate variants and cohort arm. Runs are repeated simulation of four real events; not independent real replication. No reserved2020 or internal-year selection.',
    selection:'Report all broad-speed gate failures and all 12 residuals. Compare event-wise paired changes. Pareto and normalized joint loss are a small-sample screen, not proof of reality fit or a reserved-year result.'};
  const protocolHash=HASH(JSON.stringify(protocol));let report={protocol,protocolHash,startedAt:new Date().toISOString(),samples:[],errors:[],arms:[],integrity:{complete:false},closed:false},previousWall=0;
  if(resuming){
    const raw=fs.readFileSync(output,'utf8'),saved=JSON.parse(raw);assert.equal(saved.protocolHash,protocolHash,'Resume grid source/driver/orchestrator/parameters/jobs/reference mismatch');
    assert.equal(HASH(JSON.stringify(saved.protocol)),protocolHash,'Saved grid protocol hash mismatch');
    for(const [suffix,value] of [['source.js',source],['driver.js',driver],['orchestrator.js',orchestrator]])assert.equal(HASH(require('node:zlib').gunzipSync(fs.readFileSync(output+'.'+suffix+'.gz')).toString('utf8')),HASH(value),'Resume grid archive differs: '+suffix);
    for(const row of saved.samples){assert(declared.has(row.jobKey)&&!covered.has(row.jobKey),'Foreign/duplicate saved grid row');for(const [key,value] of Object.entries(declared.get(row.jobKey)))assert.deepEqual(row[key],value,'Saved grid identity mismatch '+key);assert.deepEqual(row.engineering,require('./race-validation-v11').engineering(row,row.kind));covered.add(row.jobKey);}
    for(const failure of saved.errors)if(failure.jobKey){assert(declared.has(failure.jobKey)&&!covered.has(failure.jobKey),'Foreign/duplicate saved grid failure');covered.add(failure.jobKey);}
    assert(Number.isFinite(saved.wallSeconds)&&saved.wallSeconds>=0);previousWall=saved.wallSeconds;
    report={...saved,closed:false,developmentAttempts:[...(saved.developmentAttempts||[]),{resumedAt:new Date().toISOString(),checkpointSha256:sha(raw),completed:covered.size,previousWallSeconds:previousWall}]};
  }
  if(args.includes('--check-source')||args.includes('--check-resume')){console.log(JSON.stringify({source:HASH(source),protocolHash,totalJobs:jobs.length,covered:covered.size,pending:jobs.length-covered.size}));process.exit(0);}
  if(!resuming){fs.mkdirSync(path.dirname(output),{recursive:true});for(const [suffix,value] of [['source.js',source],['driver.js',driver],['orchestrator.js',orchestrator]])fs.writeFileSync(output+'.'+suffix+'.gz',require('node:zlib').gzipSync(value));}
  const pending=jobs.filter(job=>!covered.has(sha(JSON.stringify(job)))),count=Math.min(workers,pending.length),start=Date.now();let ended=0;
  function save(){
    report.wallSeconds=previousWall+(Date.now()-start)/1000;
    report.arms=names.map(name=>{const rows=report.samples.filter(r=>r.gridVariant===name),comparisons=compare(rows,ref.races);return {name,completed:rows.length,comparisons,
      metrics:Object.fromEntries(METRICS.map(k=>[k,{medianError:q(comparisons.map(c=>c.metrics[k].error)),meanAbsoluteError:comparisons.length?comparisons.reduce((s,c)=>s+Math.abs(c.metrics[k].error),0)/comparisons.length:null}])),
      gateFailures:comparisons.flatMap(c=>Object.entries(c.gates).filter(([,pass])=>!pass).map(([gate])=>({id:c.id,gate}))),engineeringFailures:rows.filter(r=>!r.engineering.passed).map(r=>({id:r.id,failedChecks:r.engineering.failedChecks}))};});
    report.paired=names.filter(n=>n!=='current').map(name=>({name,rows:cases.map(job=>{const base=report.samples.find(s=>s.gridVariant==='current'&&s.id===job.id),row=report.samples.find(s=>s.gridVariant===name&&s.id===job.id);
      return {id:job.id,length:job.length,complete:!!row&&!!base,...(row&&base?{sameInputField:row.inputHash===base.inputHash,differences:Object.fromEntries(METRICS.map(k=>[k,row[k]-base[k]])),absoluteResidualChange:Object.fromEntries(METRICS.map(k=>{const reality=ref.races.find(r=>r.id===job.id).metrics[k];return [k,Math.abs(row[k]-reality)-Math.abs(base[k]-reality)];}))}:{})};})}));
    report.integrity={complete:report.closed&&covered.size===jobs.length,covered:covered.size,total:jobs.length,passedEngineering:report.errors.length===0&&report.samples.every(r=>r.engineering.passed),
      failures:report.samples.filter(r=>!r.engineering.passed).map(r=>({variant:r.gridVariant,id:r.id,checks:r.engineering.failedChecks})),missingJobKeys:[...declared.keys()].filter(k=>!covered.has(k)),fullRaceExecutions:report.samples.length,partialExecutions:0,
      maxMotionError:Math.max(0,...report.samples.map(r=>r.maxMotionError)),maxWorkError:Math.max(0,...report.samples.map(r=>r.maxWorkError)),maxReserveError:Math.max(0,...report.samples.map(r=>r.maxReserveError)),maxUnpaid:Math.max(0,...report.samples.map(r=>r.maxUnpaid)),bodyOverlapRuns:report.samples.filter(r=>r.bodyOverlapFrames>0).length};
    const tmp=output+'.tmp';fs.writeFileSync(tmp,JSON.stringify(report)+'\n');fs.renameSync(tmp,output);
  }
  save();
  if(!count){report.closed=true;report.sourceFileStillSameAtEnd=HASH(read())===HASH(source);save();console.log(JSON.stringify({output,source:HASH(source),wallSeconds:report.wallSeconds,integrity:report.integrity}));if(!report.integrity.complete||!report.integrity.passedEngineering)process.exitCode=1;}
  for(let i=0;i<count;i++){
    const worker=new Worker(__filename,{resourceLimits:{maxOldGenerationSizeMb:192},workerData:{source,generatorSource,parameters,jobs:pending.filter((_,j)=>j%count===i)}});
    worker.on('message',m=>{const key=m.row?.jobKey??m.jobKey;if(!declared.has(key)||covered.has(key))report.errors.push({error:'Foreign/duplicate worker result',received:m});else{covered.add(key);if(m.error)report.errors.push(m);else report.samples.push(m.row);}save();
      console.log(JSON.stringify({done:covered.size,total:jobs.length,variant:m.row?.gridVariant??m.job?.gridVariant,id:m.row?.id??m.job?.id,wallSeconds:report.wallSeconds,engineering:m.row?.engineering,error:m.error??null}));});
    worker.on('error',e=>report.errors.push({worker:i,error:String(e.stack)}));worker.on('exit',code=>{if(code)report.errors.push({worker:i,error:'Worker exit '+code});if(++ended===count){report.closed=true;report.sourceFileStillSameAtEnd=HASH(read())===HASH(source);save();console.log(JSON.stringify({output,source:HASH(source),wallSeconds:report.wallSeconds,integrity:report.integrity}));if(!report.integrity.complete||!report.integrity.passedEngineering)process.exitCode=1;}});
  }
}
