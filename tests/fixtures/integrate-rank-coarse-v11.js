'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {HASH}=require('../system-reality-v9');
const file=path.resolve(__dirname,'../../sim.js'),before=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
assert.equal(HASH(before),'d0fea99e162584783b93e64a25ceb47685ab90894140de5c63aea548f3d6b956',
  'Historical integration only: refuse to overwrite a newer production engine');
let source=require('./rider-controller-v11').applyController(before);
const old='observedLeaderEndpoints:[...observedLeaders.values()].map(F=>({s:F.s,t:F.t,v:F.v,finished:F.finished}))';
const next='observedLeaderEndpoints:[...observedLeaders.values()].map(F=>({id:F.id,s:F.s,t:F.t,v:F.v,finished:F.finished}))';
assert.equal(source.split(old).length-1,1,'Unique forecast endpoint identity');
source=source.replace(old,next);
source=require('./follow-coarse-screen-v11').applyFollowCoarseScreenPatch(source);
fs.writeFileSync(file,source);
console.log(JSON.stringify({before:HASH(before),after:HASH(source)}));
