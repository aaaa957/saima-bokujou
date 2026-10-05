'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {HASH}=require('../system-reality-v9');
const root=path.resolve(__dirname,'../..');
const patch=JSON.parse(fs.readFileSync(path.join(__dirname,'race-cohort-v11.patch'),'utf8'));
const files=new Map(['sim.js','index.html'].map(file=>[file,fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')]));
assert.equal(HASH(files.get('sim.js')),patch.baseEngineHash,'Expected clean diagnostic baseline');
assert.equal(HASH(files.get('index.html')),patch.basePageHash,'Expected clean page baseline');
files.set('sim.js',require('./race-prediction-v11-install').applyPredictionPatch(files.get('sim.js')));
files.set('sim.js',require('./rider-controller-v11').applyController(files.get('sim.js')));
for(const change of patch.changes){const before=change.old.replace(/\r\n/g,'\n'),after=change.new.replace(/\r\n/g,'\n');
  const source=files.get(change.file);assert.equal(source.split(before).length-1,1,'Unique cohort anchor: '+change.description);
  files.set(change.file,source.replace(before,after));}
files.set('sim.js',require('./route-station-lookup-v11').applyRouteStationLookupPatch(files.get('sim.js')));
const releasePath=path.join(__dirname,'race-release-v11.patch');
if(fs.existsSync(releasePath))files.set('sim.js',require('./race-release-v11').applyReleasePatch(files.get('sim.js'),JSON.parse(fs.readFileSync(releasePath,'utf8'))));
for(const [file,source]of files)fs.writeFileSync(path.join(root,file),source);
console.log(JSON.stringify(Object.fromEntries([...files].map(([file,source])=>[file,HASH(source)]))));
