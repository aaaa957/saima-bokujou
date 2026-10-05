#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {HASH}=require('./system-reality-v9'),{runJob}=require('./race-validation-v11');
const {readArchive}=require('./helpers/read-archive-v11'),args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);return i<0?value:args[i+1];};
const root=path.resolve(__dirname,'..'),input=readArchive(path.resolve(root,arg('--input','docs/calibration-screen-v11-headway.json.gz'))),file=input.file,grid=JSON.parse(input.text);
const oldSource=zlib.gunzipSync(fs.readFileSync(path.join(root,grid.protocol.sourceArtifact))).toString('utf8').replace(/\r\n/g,'\n');
assert.equal(HASH(oldSource),grid.protocol.sourceNormalizedSha256,'Grid archived source matches protocol');
const job=grid.protocol.jobs.find(j=>j.id==='231001'&&j.gridVariant==='current');assert(job,'Predeclared current 231001 job');
const rows=grid.samples||grid.rows;assert(Array.isArray(rows),'Grid complete samples');
const golden=rows.find(s=>s.id===job.id&&s.gridVariant===job.gridVariant&&s.replicate===job.replicate);assert(golden&&golden.finished&&golden.engineering?.passed,'Completed engineering-valid golden row');
const liveAtStart=HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8')),source=readArchive(path.resolve(root,arg('--source','sim.js'))).text.replace(/\r\n/g,'\n');
assert.equal(HASH(source),'d0fea99e162584783b93e64a25ceb47685ab90894140de5c63aea548f3d6b956','CPU optimization frozen source');
const generator=execFileSync('git',['show',grid.protocol.generatorCommit+':sim.js'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}).replace(/\r\n/g,'\n');
assert.equal(HASH(generator),grid.protocol.generatorNormalizedSha256,'Fixed v8 generator source hash');
if(args.includes('--check-source')){console.log(JSON.stringify({sourceHash:HASH(source),goldenSourceHash:HASH(oldSource),generatorHash:HASH(generator),goldenReport:path.relative(root,file).replace(/\\/g,'/'),job,steppedRaceExecutions:0}));process.exit(0);}
const out=path.resolve(root,arg('--out','docs/traffic-cpu-full-replay-v11.json')),strip=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['wallSeconds','threadCpuSeconds'].includes(key)));
const report={startedAt:new Date().toISOString(),sourceHash:HASH(source),goldenSourceHash:HASH(oldSource),generatorHash:HASH(generator),driverHash:HASH(fs.readFileSync(path.join(__dirname,'race-validation-v11.js'),'utf8')),goldenReport:path.relative(root,file).replace(/\\/g,'/'),job,parameters:grid.protocol.parameters.current,scope:'One new complete race replay compared with an already completed current-parameter grid row. The old row is reused and is not counted as a new execution. All physics, horse telemetry, traces, gates, and numerical metrics remain in the exact comparison.',newFullRaceExecutions:1,reusedFullRaceExecutions:1,excludedExecutionTimingFields:['wallSeconds','threadCpuSeconds'],goldenExactDataHash:HASH(JSON.stringify(strip(golden))),pass:false};
fs.writeFileSync(out+'.source.js.gz',zlib.gzipSync(source));
try{const replay=runJob(job,source,generator,grid.protocol.parameters.current);report.replayWallSeconds=replay.wallSeconds;report.replayThreadCpuSeconds=replay.threadCpuSeconds;report.replayExactDataHash=HASH(JSON.stringify(strip(replay)));report.engineering=replay.engineering;report.frames=replay.frames;report.internalTicks=replay.internalTicks;report.finished=replay.finished;
 fs.writeFileSync(out+'.replay-row.json.gz',zlib.gzipSync(JSON.stringify(replay)));assert.deepEqual(strip(replay),strip(golden),'Exact entire row excluding two execution clocks');report.pass=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
report.finishedAt=new Date().toISOString();report.productionUnchanged=HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===liveAtStart;
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
