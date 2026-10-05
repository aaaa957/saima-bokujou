#!/usr/bin/env node
'use strict';
// Synthetic release fragments only; do not capture or change final parameters.
const assert=require('node:assert/strict'),{HASH}=require('./system-reality-v9'),R=require('./fixtures/race-release-v11');
const before='/* engine v-old */\nconst RACE_F={\n    maxAccel:1,\n  };\nfunction unchanged(){return 1;}\n',
 after=before.replace('v-old','v-final').replace('maxAccel:1','maxAccel:2'),patch=R.buildReleasePatch(before,after,HASH(after));
assert.equal(patch.changes.length,2);assert.equal(R.applyReleasePatch(before,patch),after);assert.equal(R.applyReleasePatch(after,patch),after);
console.log('PASS Header and literal constants rebuild exact final text, with idempotent final hash');
assert.throws(()=>R.buildReleasePatch(before,after,'wrong'),/Capture must use the declared final source/);
assert.throws(()=>R.buildReleasePatch(before,after.replace('return 1','return 2'),HASH(after.replace('return 1','return 2'))),/Release fixture must rebuild/);
assert.throws(()=>R.applyReleasePatch(before+'// unexpected\n',patch),/exact pre-release mechanism/);
console.log('PASS Wrong final hash, unregistered mechanism changes and unexpected input are rejected');
console.log(JSON.stringify({passed:2,productionWritten:false,steppedRaceExecutions:0,finalParametersCaptured:false}));
