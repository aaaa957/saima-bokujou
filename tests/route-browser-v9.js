#!/usr/bin/env node
'use strict';
// Optional pixel review using an existing browser and Playwright installation.
// NODE_PATH can point to the desktop's bundled packages; no npm install needed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/screenshots/v9-routes');fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};});
  await page.goto('file:///'+path.join(root,'index.html').replace(/\\/g,'/'));
  for(const [course,length] of [['東京',1600],['東京',2000],['中山',1200],['京都',3200]]){
    await page.evaluate(({course,length})=>{
      switchMode('single');document.getElementById('cfgLength').value=length;document.getElementById('cfgCourse').value=course;updateCourseInfo();startRace();
      paused=true;race.race.horses.forEach((h,i)=>{h.s=i*.01;});cam=null;renderRace(1000);
    },{course,length});
    await page.locator('#raceCanvas').screenshot({path:path.join(out,course+'-'+length+'-start.png')});
    await page.evaluate(length=>{race.race.horses.forEach((h,i)=>{h.s=length*.75-i*5;h.v=17;});cam=null;renderRace(2000);},length);
    await page.locator('#raceCanvas').screenshot({path:path.join(out,course+'-'+length+'-bend.png')});
    const marks=await page.evaluate(()=>cam.lastView.mini.markers.length);assert.equal(marks,8);
  }
  await browser.close();assert.deepEqual(errors,[]);console.log('PASS real Edge canvas: 8 screenshots, no page errors, all 8 map markers');
})().catch(e=>{console.error(e);process.exitCode=1;});
