'use strict';
const assert=require('node:assert/strict');
// Root applies these exact public-entry fixes sequentially. No production file
// is written when this module is imported or invoked.
const changes=[{
 file:'sim.js',description:'Honor an explicit zero ability maximum in caller qualification',
 old:'      h.ability >= (o.abilityMin || 0) && h.ability <= (o.abilityMax || 100) &&',
 new:'      h.ability >= (o.abilityMin || 0) && h.ability <= (o.abilityMax !== undefined ? o.abilityMax : 100) &&'
},{
 file:'sim.js',description:'Disclose qualified-roster shortage against the requested field size',
 old:'      const selected=selectRaceCohort(pool,rng,{...o,n});',
 new:'      const selected=selectRaceCohort(pool,rng,{...o,n:o.n||8});'
},{
 file:'sim.js',description:'Separate player race qualifications from representative ability bands',
 old:"  function raceOptionsForRoster(h, rng, roster, weekNum) {",
 new:String.raw`  // Same sporting qualification as the weekly schedule. Ability bands are
  // representative readiness references; stronger entrants are never barred.
  const PLAYER_RACE_QUALIFICATION = {
    newcomer:{winsMin:0,winsMax:0,startsMax:0},maiden:{winsMin:0,winsMax:0},
    cond1:{winsMin:1,winsMax:1},cond2:{winsMin:2,winsMax:2},cond3:{winsMin:3,winsMax:3},
    open:{winsMin:4,winsMax:99},g3:{winsMin:2,winsMax:99},g2:{winsMin:3,winsMax:99},g1:{winsMin:4,winsMax:99},
  };
  function raceOptionsForRoster(h, rng, roster, weekNum) {`
},{
 file:'sim.js',description:'Exclude the persisted player identity and apply real win/start qualification before matching',
 old:"      const rivals = pickRosterField(roster,rng,weekNum,{ageMin:band[2],ageMax:band[3],abilityMin:band[0],abilityMax:band[1],n:7,tierKey:key,race:{length:dist,surface,state,dir,profile}});",
 new:"      const rivals = pickRosterField(roster.filter(rh=>rh.id!==h.id),rng,weekNum,{...PLAYER_RACE_QUALIFICATION[key],ageMin:band[2],ageMax:band[3],abilityMin:band[0],abilityMax:Infinity,n:7,tierKey:key,race:{length:dist,surface,state,dir,profile}});"
}];
function applyPlayerEntryPatch(source){for(const c of changes){
 const oldCount=source.split(c.old).length-1,newCount=source.split(c.new).length-1;
 // The function declaration occurs inside the longer replacement. Prefer the
 // integrated exact new block before counting its contained old declaration.
 if(newCount===1)continue;
 assert.equal(oldCount,1,'Unique player entry fragment: '+c.description);
 source=source.replace(c.old,c.new);
}return source;}
module.exports={changes,applyPlayerEntryPatch};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path'),{HASH}=require('../system-reality-v9'),root=path.resolve(__dirname,'../..'),
 source=fs.readFileSync(path.join(root,'sim.js'),'utf8'),before=HASH(source),candidate=applyPlayerEntryPatch(source);
 const patch={version:1,productionInputHash:before,testedSourceHash:HASH(candidate),generatedAt:new Date().toISOString(),changes,
   notes:['Sporting wins/start qualification follows the existing weekly schedule; no ability ceiling.',
    'Exclude all roster entries with the persisted player id before matching. Other duplicated rival ids raise the existing clear selection error.',
    'No horse identity, supplied biology, behavior, or generation RNG is replaced.']};
 fs.writeFileSync(path.join(__dirname,'race-cohort-player-entry-v11.patch'),JSON.stringify(patch,null,2)+'\n');
 const fullPath=path.join(__dirname,'race-cohort-v11.patch'),full=JSON.parse(fs.readFileSync(fullPath,'utf8'));
 for(const c of changes){let present=false;
   for(const prior of full.changes.filter(x=>x.file===c.file)){
     if(prior.new.includes(c.new)){present=true;break;}
     if(prior.new.includes(c.old)){assert.equal(prior.new.split(c.old).length-1,1);prior.new=prior.new.replace(c.old,c.new);present=true;break;}
   }
   if(!present){
     const existing=full.changes.find(x=>x.file===c.file&&x.description===c.description);
     if(existing)assert.deepEqual(existing,c);else full.changes.push(c);
   }
 }
 full.lastPlayerEntryUpdateAt=patch.generatedAt;
 fs.writeFileSync(fullPath,JSON.stringify(full,null,2)+'\n');
 assert.equal(HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8')),before);
 console.log(JSON.stringify({ready:'tests/fixtures/race-cohort-player-entry-v11.patch',changes:changes.length,productionInputHash:before,testedSourceHash:HASH(candidate),productionUnchanged:true}));
}
