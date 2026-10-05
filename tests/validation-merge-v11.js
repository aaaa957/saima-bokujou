#!/usr/bin/env node
'use strict';
// Zero-engine-step rejection proof: a reusable batch cannot be counted twice.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),input=fs.existsSync(path.join(ROOT,'docs/calibration-selected-nopeak-v11.json'))?'docs/calibration-selected-nopeak-v11.json':'docs/calibration-selected-nopeak-v11.json.gz',output='docs/validation-merge-v11-must-not-exist.json';
const before=fs.readFileSync(path.join(ROOT,input));assert(!fs.existsSync(path.join(ROOT,output)));let error;
try{execFileSync(process.execPath,[path.join(__dirname,'merge-training-v11.js'),'--input',input,'--input',input,'--out',output],{cwd:ROOT,encoding:'utf8',stdio:'pipe'});}catch(e){error=String(e.stderr);}
assert(error&&error.includes('Duplicate jobKey/event identity must not be counted twice'),'Expected duplicate rejection, not a successful doubled report');
assert(!fs.existsSync(path.join(ROOT,output)),'Rejected reduction created an output');assert.equal(sha(fs.readFileSync(path.join(ROOT,input))),sha(before),'Read-only reduction changed original report');
const report={at:new Date().toISOString(),engineSteps:0,newFullRaceExecutions:0,input,inputByteSha256:sha(before),passed:true,rejection:'Duplicate jobKey/event identity must not be counted twice',inputUnchanged:true,noRejectedOutput:true};
fs.writeFileSync(path.join(ROOT,'docs/validation-merge-v11.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
