'use strict';
// Sequential integration of the independently reviewed v11 patches.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {HASH}=require('../system-reality-v9');
const file=path.resolve(__dirname,'../../sim.js');
let source=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const before=HASH(source);
assert.equal(before,'1ca77ab4eacdd18ec98ed8bcc6b5e3cfa74525dd16dfca3f2fbe6d151304f818');
source=require('./race-prediction-v11-install').applyPredictionOpponentPatch(source);
source=require('./race-cohort-admission-v11').applyAdmissionPatch(source);
fs.writeFileSync(file,source);
console.log(JSON.stringify({before,after:HASH(source)}));
