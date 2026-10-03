#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {source,verify}=require('./helpers/v9-numeric-snapshot');
const {api,measure,DIST,HASH}=require('./system-reality-v9');
const {S:B}=require('./helpers/frozen-v8');
const ROOT=path.resolve(__dirname,'..'),verification=verify();
assert(verification.lifecycleEntryChanges,'Run this after the legacy entry repair');
const lifecycleOutput=execFileSync(process.execPath,[path.join(__dirname,'roster-physiology-entry-v9.js')],{cwd:ROOT,encoding:'utf8'});
const lifecycle=JSON.parse(lifecycleOutput.trim().split(/\r?\n/).at(-1));
assert.deepEqual(lifecycle,{passed:4,failed:0,total:4});
const frozenSource=source(),releaseSource=fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'),A=api(frozenSource),C=api(releaseSource);
const courses=['中山芝外A','東京芝A','東京芝A','東京芝A','京都芝外A','京都芝外A'],rows=[];
for(let i=0;i<DIST.length;i++){
  const seed=(3197100203+i*104729)>>>0,job={context:'native-official',n:1,length:DIST[i],course:courses[i],dir:i===0||i>=4?'右回':'左回',seed,raceSeed:(seed^0x9e3779b9)>>>0,replicate:0};
  const a=measure(job,A,B),c=measure(job,C,B);
  assert(a.finished&&a.finite&&c.finished&&c.finite);
  assert.deepEqual(c,a,'Full per-horse numerical result changed at '+job.length+'m');
  rows.push({length:job.length,course:job.course,allFieldsExact:true,winnerTime:a.winnerTime,winnerFinal600:a.winnerFinal600,frames:a.frames});
  console.log('Exact numeric entry path: '+job.length+'m');
}
assert.equal(HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8')),verification.currentEngineHash,'Source changed during proof');
const report={...verification,lifecycleRegression:lifecycle,numericEntrySmoke:{cases:rows.length,distances:DIST,allExact:true,rows},
  scope:'Whole-source equality after reversing exactly two legacy entry lines and the final telemetry assignment gate proves physics, solver and query/cache execution unchanged. Six numerical-entry solo checks compare all reported fields. The entry behavior is covered by four regressions; the telemetry repair has its own full-race and query/cache sequence audit.',
  fullMatricesReranOnReleaseSource:false};
fs.writeFileSync(path.join(ROOT,'docs/source-snapshot-equivalence-v9.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
