#!/usr/bin/env node
'use strict';
// An immutable-source wrapper for the small entry/persistence regressions. This
// intentionally excludes tests/market.js and all default Monte Carlo batches.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {HASH}=require('./system-reality-v9'),root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const initialEngine=HASH(read('sim.js')),initialPage=HASH(read('index.html')),startedAt=new Date().toISOString();
const names=['cohort-selection-v11.js','cohort-admission-v11.js','cohort-player-entry-v11.js','behavior-intent-review-v11.js',
 'roster-physiology-entry-v9.js','career-save.js','physiology-save.js','bet-validation.js','market-integration.js'];
if(process.argv.includes('--browser'))names.push('page-cohort-v11.js','page-race-failure-v9.js');
const cases=[];
for(const name of names){
 const started=Date.now(),beforeEngine=HASH(read('sim.js')),beforePage=HASH(read('index.html')),
  result=spawnSync(process.execPath,[path.join(__dirname,name)],{cwd:root,encoding:'utf8',env:process.env,timeout:300000,maxBuffer:2*1024*1024}),
  afterEngine=HASH(read('sim.js')),afterPage=HASH(read('index.html')),
  immutable=beforeEngine===initialEngine&&afterEngine===initialEngine&&beforePage===initialPage&&afterPage===initialPage;
 const record={name,wallSeconds:(Date.now()-started)/1000,exitCode:result.status,signal:result.signal,error:result.error?.message||null,
  testedDriverHash:HASH(fs.readFileSync(path.join(__dirname,name),'utf8')),beforeEngine,afterEngine,beforePage,afterPage,sourceImmutable:immutable,
  stdout:result.stdout||'',stderr:result.stderr||'',passed:result.status===0&&!result.error&&immutable};
 cases.push(record);console.log((record.passed?'PASS ':'FAIL ')+name+' ('+record.wallSeconds.toFixed(1)+'s)');
}
const report={startedAt,generatedAt:new Date().toISOString(),engineHash:initialEngine,pageHash:initialPage,
 scope:'Qualification, persistent profiles, saved careers, tickets, public market quotes and optional actual browser callbacks. No completed-race population-fit benchmark.',
 completedRaceFitExecutions:0,browser:process.argv.includes('--browser'),cases,
 passed:cases.filter(c=>c.passed).length,failed:cases.filter(c=>!c.passed).length,
 sourceImmutable:cases.every(c=>c.sourceImmutable)};
const history=path.join(root,'docs/entry-regressions-v11-history');fs.mkdirSync(history,{recursive:true});
fs.writeFileSync(path.join(history,initialEngine+'-'+startedAt.replace(/[:.]/g,'-')+'.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(root,'docs/entry-regressions-v11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,engineHash:initialEngine,pageHash:initialPage,sourceImmutable:report.sourceImmutable}));
if(report.failed||!report.sourceImmutable)process.exitCode=1;
