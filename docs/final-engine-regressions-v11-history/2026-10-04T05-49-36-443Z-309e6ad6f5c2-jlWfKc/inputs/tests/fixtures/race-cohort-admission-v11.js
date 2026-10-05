'use strict';
const assert=require('node:assert/strict');
const changes=[{
 file:'sim.js',description:'Keep stronger payable candidates in grade/distance matching; the fast reference is not an admission ceiling',
 old:String.raw`      const forecast=raceEntryForecast(h,race),inside=forecast.feasible&&forecast.seconds>=fast-1e-7&&forecast.seconds<=slow+1e-7;
      const distance=forecast.seconds<fast?fast-forecast.seconds:forecast.seconds>slow?forecast.seconds-slow:0;`,
 new:String.raw`      const forecast=raceEntryForecast(h,race),inside=forecast.feasible&&forecast.seconds<=slow+1e-7;
      const distance=forecast.seconds>slow?forecast.seconds-slow:0;`
},{
 file:'sim.js',description:'Disclose matching versus caller qualification and the retained fast reference',
 old:String.raw`      predictionWindow:{fastSeconds:fast,slowSeconds:slow},candidates:candidates.length,requested,selected:selected.length,
      eligible:eligible.length,fallback,shortage:Math.max(0,requested-candidates.length),`,
 new:String.raw`      predictionWindow:{fastSeconds:fast,slowSeconds:slow},candidates:candidates.length,requested,selected:selected.length,
      eligibilityScope:'Caller filters decide age, wins/class and rest qualification; forecast only matches payable distance/grade readiness.',
      fastIsNotAdmissionCeiling:true,
      eligible:eligible.length,fallback,shortage:Math.max(0,requested-candidates.length),`
},{
 file:'sim.js',description:'Clarify uniform stronger-tail matching and fallback priority',
 old:"      selection:'Within shared grade/distance forecast window: uniform without replacement. Scarcity: nearest window, explicitly reported. No realized race simulation.',",
 new:"      selection:'Payable entrants no slower than shared grade/distance reference: uniform without replacement. Faster entrants remain admissible. Scarcity: nearest slow boundary, explicitly reported. Qualification is determined by caller filters; no realized race simulation.',"
},{
 file:'sim.js',description:'Honor an explicit zero wins maximum in maiden qualification',
 old:'      h.wins >= (o.winsMin || 0) && h.wins <= (o.winsMax || 99) &&',
 new:'      h.wins >= (o.winsMin || 0) && h.wins <= (o.winsMax !== undefined ? o.winsMax : 99) &&'
}];
function applyAdmissionPatch(source){for(const c of changes){
 const count=source.split(c.old).length-1;
 if(count){assert.equal(count,1,'Unique admission fragment: '+c.description);source=source.replace(c.old,c.new);}
 else assert.equal(source.split(c.new).length-1,1,'Known integrated admission fragment: '+c.description);
}return source;}
module.exports={changes,applyAdmissionPatch};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path'),{HASH}=require('../system-reality-v9'),root=path.resolve(__dirname,'../..'),
   current=fs.readFileSync(path.join(root,'sim.js'),'utf8'),before=HASH(current);
 // Only fixture files are written. The root agent applies production sequentially.
 const patch={version:1,productionInputHash:before,generatedAt:new Date().toISOString(),changes,
   notes:['Fast prediction is a representative reference, never a stronger-horse admission ceiling.',
    'Uniform matching keeps stronger payable entrants; fallback has no fast-side penalty.',
    'Upstream explicit zero wins maximum must remain zero. No stable horse attributes or RNG generation change.']};
 fs.writeFileSync(path.join(__dirname,'race-cohort-admission-v11.patch'),JSON.stringify(patch,null,2)+'\n');
 const filename=path.join(__dirname,'race-cohort-v11.patch'),base=JSON.parse(fs.readFileSync(filename,'utf8'));
 for(const c of changes){let present=false;
  for(const prior of base.changes.filter(x=>x.file===c.file)){
   if(prior.new.includes(c.old)){assert.equal(prior.new.split(c.old).length-1,1);prior.new=prior.new.replace(c.old,c.new);present=true;}
   else if(prior.new.includes(c.new))present=true;
  }
  if(!present){assert.equal(c.description,'Honor an explicit zero wins maximum in maiden qualification');base.changes.push(c);}
 }
 base.lastAdmissionUpdateAt=patch.generatedAt;
 fs.writeFileSync(filename,JSON.stringify(base,null,2)+'\n');
 assert.equal(HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8')),before);
 console.log(JSON.stringify({ready:'tests/fixtures/race-cohort-admission-v11.patch',changes:changes.length,productionInputHash:before,productionUnchanged:true}));
}
