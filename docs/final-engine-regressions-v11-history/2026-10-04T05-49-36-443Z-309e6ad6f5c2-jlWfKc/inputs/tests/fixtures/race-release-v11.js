'use strict';
// Prepare/apply an exact final header + RACE_F delta in memory. Capture is an
// explicit post-freeze operation; importing this helper never writes production.
const assert=require('node:assert/strict'),{HASH}=require('../system-reality-v9');
const normalize=s=>s.replace(/\r\n/g,'\n');
function sections(source){source=normalize(source);const header=source.match(/^\uFEFF?\/\*[\s\S]*?\*\//),parameters=source.match(/\bconst RACE_F\s*=\s*\{[\s\S]*?\n  \};/);
 assert(header&&parameters,'Recognized source header and literal RACE_F required');return {header:header[0],parameters:parameters[0]};}
function applyReleasePatch(source,patch){source=normalize(source);if(HASH(source)===patch.finalEngineHash)return source;
 assert.equal(HASH(source),patch.baseEngineHash,'Release fixture requires the exact pre-release mechanism');
 for(const change of patch.changes){assert.equal(change.file,'sim.js');assert.equal(source.split(change.old).length-1,1,'Unique final release fragment: '+change.description);source=source.replace(change.old,change.new);}
 assert.equal(HASH(source),patch.finalEngineHash,'Release fixture must rebuild the final frozen source');return source;}
function buildReleasePatch(before,after,expectedFinalHash){before=normalize(before);after=normalize(after);assert(expectedFinalHash,'Final freeze hash is required');
 assert.equal(HASH(after),expectedFinalHash,'Capture must use the declared final source');const old=sections(before),next=sections(after),changes=[];
 for(const section of ['header','parameters'])if(old[section]!==next[section])changes.push({file:'sim.js',description:section==='header'?'Final release header/version and report reference':'Final frozen literal RACE_F calibration',old:old[section],new:next[section]});
 const patch={version:1,baseEngineHash:HASH(before),finalEngineHash:HASH(after),generatedAt:new Date().toISOString(),
  scope:'Only source header and literal RACE_F; all mechanism/controller/cohort changes must already rebuild exactly.',changes};
 assert.equal(applyReleasePatch(before,patch),after,'Unregistered changes outside header/parameters require mechanism fixture synchronization first');return patch;}
module.exports={sections,applyReleasePatch,buildReleasePatch};
if(require.main===module){const fs=require('node:fs'),path=require('node:path'),{readArchive}=require('../helpers/read-archive-v11'),root=path.resolve(__dirname,'../..'),args=process.argv.slice(2),arg=key=>{const i=args.indexOf(key);return i<0?null:args[i+1];};
 assert(args.includes('--capture'),'Use --capture only after final source and parameters freeze');assert(arg('--before')&&arg('--after')&&arg('--expected-final'),'Supply --before, --after and --expected-final');
 const patch=buildReleasePatch(readArchive(path.resolve(root,arg('--before'))).text,readArchive(path.resolve(root,arg('--after'))).text,arg('--expected-final'));
 const output=path.resolve(root,arg('--out')||'tests/fixtures/race-release-v11.patch');assert.notEqual(output,path.resolve(root,arg('--before')));assert.notEqual(output,path.resolve(root,arg('--after')));
 fs.writeFileSync(output,JSON.stringify(patch,null,2)+'\n');console.log(JSON.stringify({output:path.relative(root,output).replace(/\\/g,'/'),changes:patch.changes.length,baseEngineHash:patch.baseEngineHash,finalEngineHash:patch.finalEngineHash,productionWritten:false}));}
