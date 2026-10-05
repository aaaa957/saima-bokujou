#!/usr/bin/env node
'use strict';
// Zero engine steps: verify deterministic assignment of unchanged declared jobs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {references,makeJobs,allocateJobs,estimateJobCost}=require('./race-validation-v11');
const ROOT=path.resolve(__dirname,'..'),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),key=job=>sha(JSON.stringify(job));
const args=process.argv.slice(2),oi=args.indexOf('--out'),output=oi>=0?args[oi+1]:'docs/validation-scheduling-v11.json';assert(output&&!fs.existsSync(path.resolve(ROOT,output)),'Use a new --out path; historical scheduling proofs must remain unchanged');
assert.equal(typeof allocateJobs,'function');assert.equal(typeof estimateJobCost,'function');
const ref=references(),checks=[];
for(const [scope,lengths] of [['calibration',[1200,2400]],['calibration',null],['controls',null],['forecasts',null],['final',null]]){
  const jobs=makeJobs(scope,ref.races,1,'selected').filter(j=>!lengths||lengths.includes(j.length)),before=JSON.stringify(jobs),old=Array.from({length:4},(_,i)=>jobs.filter((_,j)=>j%4===i)),allocation=allocateJobs(jobs,4),flat=allocation.groups.flat();
  assert.equal(JSON.stringify(jobs),before,'Scheduling changed declared jobs');assert.deepEqual(flat.map(key).sort(),jobs.map(key).sort(),'Foreign, duplicate or dropped scheduled jobs');
  assert.deepEqual(allocateJobs(jobs,4),allocation,'Scheduling is not deterministic');
  assert(flat.every(j=>jobs.includes(j)),'Scheduling must pass original job objects without rewriting fields');
  const oldCost=old.map(group=>group.reduce((sum,job)=>sum+estimateJobCost(job),0)),newCost=allocation.groups.map(group=>group.reduce((sum,job)=>sum+estimateJobCost(job),0));
  assert(Math.max(...newCost)<=Math.max(...oldCost)+1e-9,'Greedy balancing unexpectedly raises largest estimated load');
  if(scope==='controls')assert(allocation.groups.every(group=>group.some(j=>j.command==='natural'&&j.n>1)),'Natural multi-horse starts must use all workers');
  checks.push({scope,lengths,jobs:jobs.length,jobListSha256:sha(before),originalAssignmentEstimatedCosts:oldCost,newAssignmentEstimatedCosts:newCost,groups:allocation.groups.map((group,i)=>({worker:i,jobs:group.map(key)}))});
}
const report={at:new Date().toISOString(),driverNormalizedSha256:require('./system-reality-v9').HASH(fs.readFileSync(path.join(__dirname,'race-validation-v11.js'),'utf8')),engineSteps:0,checks,passed:true,scope:'Cost values are deterministic rough relative scheduling estimates, not measured CPU or physical quantities. Only worker assignment/order changes. Jobs, source, entrant RNG, numerical integration, physics and guard thresholds are unchanged. Each simulation independently compiles its frozen source and seeded input.'};
fs.writeFileSync(path.resolve(ROOT,output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,driver:report.driverNormalizedSha256,passed:report.passed,engineSteps:0,checks:checks.map(c=>({scope:c.scope,lengths:c.lengths,jobs:c.jobs,old:c.originalAssignmentEstimatedCosts,new:c.newAssignmentEstimatedCosts}))}));
