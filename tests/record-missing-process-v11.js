#!/usr/bin/env node
'use strict';
// Preserve a checkpoint and unknown execution progress before restarting an
// interrupted screen whose original process is no longer present.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),prefix='docs/calibration-mechanical-v11.json',target='docs/calibration-mechanical-v11-missing-process-resume.json',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=[prefix,prefix+'.source.js.gz',prefix+'.driver.js.gz',prefix+'.orchestrator.js.gz'],bytes=files.map(f=>fs.readFileSync(path.join(ROOT,f))),report=JSON.parse(bytes[0]);
assert(!fs.existsSync(path.join(ROOT,target)),'Existing interruption record must not be overwritten');
assert.equal(report.protocol.sourceNormalizedSha256,'63068101ae7c0bf80db75094b9b497cde24bb88fe86f3df70fddee397974d4e8');
assert.equal(report.protocolHash,'32c787f42b5a7b470432c3f24812ea9248bb304a2c6e86a83d68fc04278af7e8');
assert.equal(report.protocol.jobs.length,12);assert.equal(report.samples.length,11);assert.equal(report.errors.length,0);assert.equal(report.closed,false);
const evidence={observedAt:new Date().toISOString(),reason:'At continuation, the persisted screen contains 11 of 12 complete rows. Win32_Process inspection found no calibration or race-validation Node process, and polling former session 35133 returned Unknown process id. The disappearance time and cause were not observed. Resume the exact declared source/protocol/driver/orchestrator to complete the pending job; retain all existing rows.',formerSession:35133,completed:11,pending:1,checkpointWallSeconds:report.wallSeconds,uncompletedAttemptProgress:'Unknown. The interrupted attempt may have advanced before its process disappeared. It is neither zero execution nor a completed full race.',files:files.map((file,i)=>({file,byteSha256:sha(bytes[i])}))};
fs.writeFileSync(path.join(ROOT,prefix+'.missing-process-checkpoint'),bytes[0]);
report.developmentAttempts=[...(report.developmentAttempts||[]),{processMissingObservedAt:evidence.observedAt,formerSession:evidence.formerSession,covered:11,pending:1,reason:evidence.reason,uncompletedAttemptProgress:evidence.uncompletedAttemptProgress,record:target}];
fs.writeFileSync(path.join(ROOT,prefix),JSON.stringify(report)+'\n');evidence.annotatedCheckpointByteSha256=sha(fs.readFileSync(path.join(ROOT,prefix)));
fs.writeFileSync(path.join(ROOT,target),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
