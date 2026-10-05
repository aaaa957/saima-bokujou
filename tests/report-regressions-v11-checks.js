#!/usr/bin/env node
'use strict';
// Hand-built wrapper data; no child suite or engine execution is started.
const assert=require('node:assert/strict'),{ENTRY_NAMES,MECHANISM_MINIMUM,auditRegressions}=require('./helpers/regression-audit-v11'),R=require('./report-system-v11');
const engine='a'.repeat(64),page='b'.repeat(64),clone=x=>structuredClone(x),
 entry={file:'docs/entry-regressions-v11.json',engineHash:engine,pageHash:page,browser:true,sourceImmutable:true,passed:11,failed:0,
  cases:ENTRY_NAMES.map(name=>({name,exitCode:0,signal:null,error:null,passed:true,sourceImmutable:true,beforeEngine:engine,afterEngine:engine,beforePage:page,afterPage:page}))},
 mechanism={file:'docs/final-engine-regressions-v11.json',sourceHash:engine,expectedSourceHash:engine,productionEndHash:engine,
  inputsUnchanged:true,pass:true,finishedAt:'2026-10-04T00:00:00.000Z',syntax:{pass:true,exitCode:0},
  suites:Object.entries(MECHANISM_MINIMUM).map(([id,checks])=>({id,pass:true,status:'passed',exitCode:0,signal:null,spawnError:null,inputsUnchanged:true,evidence:{checks,problems:[]}}))};
const good=auditRegressions([entry,mechanism],engine,{expectedPageHash:page});assert.equal(good.passed,true);assert.equal(good.records[1].sourceHash,engine);assert.equal(good.records[1].passedCount,7);
console.log('PASS Entry 11/browser and mechanism 7 suites both require the final source');
const missingHash=clone(mechanism);delete missingHash.sourceHash;
assert.throws(()=>auditRegressions([entry,missingHash],engine),/source proof rejected/);
for(const field of ['sourceHash','expectedSourceHash','productionEndHash'])assert.throws(()=>auditRegressions([entry,{...mechanism,[field]:'c'.repeat(64)}],engine),/source proof rejected/);
assert.throws(()=>auditRegressions([{...entry,engineHash:'c'.repeat(64)},mechanism],engine),/source proof rejected/);
console.log('PASS Missing or wrong engine/expected/end hashes are rejected');
const failedEntry=clone(entry);failedEntry.cases[10].passed=false;failedEntry.cases[10].exitCode=1;failedEntry.cases[10].stderr='retained browser failure';failedEntry.passed=10;failedEntry.failed=1;
const failedMechanism=clone(mechanism);failedMechanism.pass=false;Object.assign(failedMechanism.suites[5],{pass:false,status:'failed',exitCode:1});failedMechanism.suites[5].evidence.problems=['retained controller failure'];
const before=JSON.stringify([failedEntry,failedMechanism]),failed=auditRegressions([failedEntry,failedMechanism],engine);
assert.equal(failed.requiredWrappersComplete,true);assert.equal(failed.passed,false);assert.equal(failed.failures.length,2);assert.equal(failed.failures[0].failure.stderr,'retained browser failure');
assert.deepEqual(failed.failures[1].failure.evidence.problems,['retained controller failure']);assert.equal(JSON.stringify([failedEntry,failedMechanism]),before);
assert.equal(R.summaryStatus(false,true,failed.passed),'complete_with_retained_failures');
console.log('PASS Failed cases, messages and wrapper failures remain without a functional pass status');
assert.equal(auditRegressions([entry],engine).requiredWrappersComplete,false);
assert.equal(auditRegressions([{...entry,browser:false},mechanism],engine).requiredWrappersComplete,false);
assert.equal(auditRegressions([entry,{...mechanism,suites:mechanism.suites.slice(0,6)}],engine).requiredWrappersComplete,false);
assert.equal(auditRegressions([entry,{...mechanism,inputsUnchanged:false,pass:false}],engine).passed,false);
const shortSafety=clone(mechanism);shortSafety.suites.find(s=>s.id==='sequence-safety-focused').evidence.checks=9;
assert.equal(auditRegressions([entry,shortSafety],engine).passed,false);
assert.equal(MECHANISM_MINIMUM['sequence-safety-focused'],10);
console.log('PASS Missing wrappers/coverage stay incomplete and failed immutability cannot pass');
console.log(JSON.stringify({passed:4,steppedRaceExecutions:0,retainedSyntheticFailures:2}));
