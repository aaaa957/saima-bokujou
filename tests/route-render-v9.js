#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),{createPage}=require('./helpers/page-runtime');
let renders=0;
for(const [course,length] of [['東京',1600],['東京',2000],['東京',2400],['中山',1200],['京都',3200]]){
  const page=createPage();page.click('btnModeSingle');page.set('cfgLength',length);page.set('cfgCourse',course);page.click('btnStart');
  for(const phase of [0,.2,.5,.8,.999]){
    page.evaluate(`race.race.horses.forEach((h,i)=>{h.s=${length*phase}+i*.001;h.t=i%2?race.race.geo.width-.7:.7;});cam=null;renderRace(1000);`);
    const r=page.json('({mini:cam.lastView.mini,width:race.race.geo.width,hasChute:!!race.race.geo.route.chute,outline:race.race.geo.miniOutline})');
    assert(r.width>=24);assert(r.outline.paths.some(p=>p.closed));
    assert.equal(r.outline.paths.some(p=>!p.closed),r.hasChute);
    assert.equal(r.mini.markers.length,8);
    const m=r.mini,o=r.outline,halfW=(o.maxX-o.minX)*m.mmScale/2,halfH=(o.maxY-o.minY)*m.mmScale/2;
    for(const marker of m.markers){
      assert(Number.isFinite(marker.x)&&Number.isFinite(marker.y));
      assert(marker.x-marker.markerR>=m.mmCx-halfW-4-1e-6&&marker.x+marker.markerR<=m.mmCx+halfW+4+1e-6,'complete symbol fits horizontal map panel');
      assert(marker.y-marker.markerR>=m.mmCy-halfH-4-1e-6&&marker.y+marker.markerR<=m.mmCy+halfH+4+1e-6,'complete symbol fits vertical map panel');
    }
    renders++;
  }
}
console.log('PASS official route rendering: '+renders+' snapshots, actual widths, loop/chute outlines and complete map symbols');
