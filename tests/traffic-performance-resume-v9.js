#!/usr/bin/env node
'use strict';
// Check checkpoint rejection without rerunning an expensive race or writing to
// the production source/report. The active driver's source protocol is fixed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const driver=require('./traffic-optimized-final-v9');
const report=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/traffic-optimized-final-v9.json'),'utf8'));
const copy=value=>JSON.parse(JSON.stringify(value));let checks=0;
const accept=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const reject=(name,edit)=>accept(name,()=>{const changed=copy(report);edit(changed);assert.throws(()=>driver.validateResume(changed));});
accept('current completed cases and protocol',()=>driver.validateResume(report));
reject('wrong source hash',r=>r.engineHash='0'.repeat(64));
reject('wrong compiled reference',r=>r.compiledHashes.before='0'.repeat(64));
reject('wrong reference artifact',r=>r.referenceArtifact.contentHash='0'.repeat(64));
reject('changed source path',r=>r.sourceArtifact.path+='.foreign');
reject('wrong protocol',r=>r.protocol.identity.hz=30);
reject('wrong protocol hash',r=>r.protocolHash='0'.repeat(64));
reject('unknown case seed',r=>r.rows[0].config.seed++);
reject('duplicate case',r=>r.rows.push(copy(r.rows[0])));
reject('truncated prefix',r=>r.rows[0].before.frames--);
reject('different extended hash',r=>r.rows[0].after.extendedHash='0'.repeat(64));
reject('missing extended hash',r=>delete r.rows[0].before.extendedHash);
reject('nonfinite timing',r=>r.rows[0].before.cpuSeconds=NaN);
reject('incomplete whole race',r=>r.rows.find(row=>!row.config.seconds).before.finished=false);
reject('changed horse identity',r=>r.rows[0].before.horseFinal[0].id='foreign');
reject('changed final result',r=>r.rows[0].after.horseFinal[0].reserve++);
reject('modified matching results without row proof',r=>{r.rows[0].before.horseFinal[0].reserve++;r.rows[0].after.horseFinal[0].reserve++;});
reject('wrong row checksum',r=>r.rowProofs[0].rowHash='0'.repeat(64));
reject('downgrade cannot bypass checksums',r=>{delete r.checkpointVersion;delete r.protocol.identity;delete r.rowProofs;delete r.protocolHash;delete r.stageCheckpoints;delete r.resumption;delete r.checkpointDirectory;r.rows[0].before.horseFinal[0].reserve++;r.rows[0].after.horseFinal[0].reserve++;});
reject('wrong pass flag',r=>r.allExactEqual=false);
reject('incomplete rows labelled complete',r=>{if(r.rows.length===8){r.rows.pop();r.rowProofs.pop();}r.complete=true;});
const config=copy(report.rows[0].config),result=copy(report.rows[0].before),trace=Array.from({length:result.frames},()=>Array.from({length:config.n},()=>Array(8).fill(0)));
for(let i=0;i<config.n;i++){const horse=result.horseFinal[i];trace.at(-1)[i][3]=horse.reserve;trace.at(-1)[i][6]=horse.targetV;trace.at(-1)[i][7]=horse.targetT;}
const payload={checkpointVersion:2,protocolHash:driver.protocolHash,caseKey:driver.caseKey(config),stage:'before',sourceHash:driver.BEFORE_HASH,referenceHash:driver.BEFORE_HASH,engineHash:driver.AFTER_HASH,config,trace,traceHash:driver.digest(trace),result};
const stage={contentHash:driver.digest(payload),payload};
accept('complete stage payload integrity and dimensions',()=>driver.validateStage(stage,payload.caseKey,'before',stage.contentHash));
const rejectStage=(name,edit,recompute=false)=>accept(name,()=>{const changed=copy(stage);edit(changed.payload);if(recompute)changed.contentHash=driver.digest(changed.payload);assert.throws(()=>driver.validateStage(changed,payload.caseKey,'before'));});
rejectStage('changed stage trace checksum',p=>p.trace[0][0][0]=1);
rejectStage('wrong stage source',p=>p.sourceHash=driver.AFTER_HASH,true);
rejectStage('truncated stage trace',p=>{p.trace.pop();p.traceHash=driver.digest(p.trace);},true);
rejectStage('wrong stage identity',p=>p.stage='after',true);
rejectStage('nonfinite stage state',p=>{p.trace[0][0][0]=NaN;p.traceHash=driver.digest(p.trace);},true);
console.log(JSON.stringify({complete:true,checks,productionWritten:false,racesExecuted:0}));
