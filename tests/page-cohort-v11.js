#!/usr/bin/env node
'use strict';
// Focused actual browser entry/UI regression, not a Monte Carlo fit benchmark.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{HASH}=require('./system-reality-v9'),root=path.resolve(__dirname,'..');
const initialEngine=HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8')),initialPage=HASH(fs.readFileSync(path.join(root,'index.html'),'utf8'));
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),page=await context.newPage(),errors=[],cases=[];
 page.on('pageerror',error=>errors.push(error.message));
 async function test(name,fn){try{const result=await fn();cases.push({name,passed:true,result});console.log('PASS '+name);}catch(error){cases.push({name,passed:false,error:error.stack});console.error('FAIL '+name+' '+error.message);}}
 try{
  await page.goto('file:///'+path.join(root,'index.html').replace(/\\/g,'/')+'#single');
  await test('Single race generator matches the complete visible race conditions and preserves one player',async()=>{
   const r=await page.evaluate(()=>({options:singleRaceOptions(),cohort:field.cohort,ids:field.map(h=>h.id),players:field.filter(h=>h.player).map(h=>h.id)}));
   assert.deepEqual(r.cohort.race,r.options);assert.equal(r.players.length,1);assert.equal(new Set(r.ids).size,8);assert.equal(r.cohort.playerReserved,r.players[0]);return r;
  });
  await test('Changing an existing race distance preserves all edited horse identities, abilities and profiles',async()=>{
   const r=await page.evaluate(()=>{
    field[0].stats['速度']=91;field[0].behavior.forwardness=.87;field[0].physiology.power=.45;
    const before=JSON.stringify(field),oldLength=singleRaceOptions().length;
    document.getElementById('cfgLength').value=oldLength===1200?'2400':'1200';
    document.getElementById('cfgLength').dispatchEvent(new Event('change',{bubbles:true}));
    return {oldLength,newLength:singleRaceOptions().length,preserved:before===JSON.stringify(field),size:field.length};
   });assert(r.preserved);assert.notEqual(r.oldLength,r.newLength);assert.equal(r.size,8);return r;
  });
  await test('Reusing a generation seed at another distance preserves the chosen player phenotype',async()=>{
   const r=await page.evaluate(()=>{
    const take=()=>{const h=field.find(h=>h.player);return {id:h.id,stats:h.stats,physiology:h.physiology,behavior:h.behavior};};
    document.getElementById('cfgLength').value='1200';genField(618912);const short=structuredClone(take()),shortCohort=field.cohort;
    document.getElementById('cfgLength').value='2400';genField(618912);return {short,long:take(),shortLength:shortCohort.race.length,longLength:field.cohort.race.length};
   });assert.deepEqual(r.short,r.long);assert.equal(r.shortLength,1200);assert.equal(r.longLength,2400);return r;
  });
  await test('Monte Carlo field uses its actual distance and surface and contains only AI entrants',async()=>{
   const r=await page.evaluate(()=>{
    mc.L=2400;mc.surface='泥地';const f=mcField(90113),before=JSON.stringify(f),entries=f.cohort.entries;
    return {length:f.length,players:f.filter(h=>h.player).length,options:f.cohort.race,forecastsAgree:entries.every(e=>JSON.stringify(e.forecast)===JSON.stringify(S.raceEntryForecast(f.find(h=>h.id===e.id),f.cohort.race))),unchanged:before===JSON.stringify(f),ids:f.map(h=>h.id)};
   });assert.equal(r.length,8);assert.equal(r.players,0);assert.equal(r.options.length,2400);assert.equal(r.options.surface,'泥地');assert(r.forecastsAgree&&r.unchanged);assert.equal(new Set(r.ids).size,8);return r;
  });
  await test('New position and route planning modes have visible rider strategy labels',async()=>{
   const r=await page.evaluate(()=>Object.fromEntries(['start-position','route','wait-route','wait'].map(mode=>[mode,tacticLabel({gateOpen:true,startSettled:true,strategy:{mode}})])));
   assert.deepEqual(r,{'start-position':'起步抢位',route:'选择路线','wait-route':'留隙换道',wait:'等待通道'});return r;
  });
 }finally{await browser.close();}
 const report={generatedAt:new Date().toISOString(),engineHash:initialEngine,pageHash:initialPage,
  productionSourceUnchanged:HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===initialEngine,pageSourceUnchanged:HASH(fs.readFileSync(path.join(root,'index.html'),'utf8'))===initialPage,
  scope:'Five actual Microsoft Edge headless UI/generation checks; no actual race steps and no numerical-fit claim.',cases,pageErrors:errors,
  passed:cases.filter(x=>x.passed).length,failed:cases.filter(x=>!x.passed).length};
 const history=path.join(root,'docs/page-cohort-v11-history');fs.mkdirSync(history,{recursive:true});
 fs.writeFileSync(path.join(history,initialEngine+'-'+report.generatedAt.replace(/[:.]/g,'-')+'.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(root,'docs/page-cohort-v11.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,failed:report.failed,pageErrors:errors,engineHash:initialEngine,productionSourceUnchanged:report.productionSourceUnchanged,pageSourceUnchanged:report.pageSourceUnchanged}));
 if(report.failed||errors.length||!report.productionSourceUnchanged||!report.pageSourceUnchanged)process.exitCode=1;
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
