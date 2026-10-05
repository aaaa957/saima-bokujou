'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const ENTRY_NAMES=['cohort-selection-v11.js','cohort-admission-v11.js','cohort-player-entry-v11.js','behavior-intent-review-v11.js',
 'roster-physiology-entry-v9.js','career-save.js','physiology-save.js','bet-validation.js','market-integration.js','page-cohort-v11.js','page-race-failure-v9.js'];
const MECHANISM_MINIMUM={ 'prediction-consistency':12,'rider-route-planning':15,'rider-planning':5,'finalcoarse-focused':10,'rank-focused':6,'controller-review':10,'sequence-safety-focused':10 };
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),sameNames=(got,expected)=>got.length===expected.length&&new Set(got).size===got.length&&expected.every(name=>got.includes(name));
function regressionSourceHash(r){return r.engineHash||r.testedSourceHash||r.sourceHash||r.protocol?.engineHash||null;}
function kindOf(r){const name=path.basename(r.file||'');if(name==='entry-regressions-v11.json'||Array.isArray(r.cases)&&Object.hasOwn(r,'browser'))return 'entry';
 if(name==='final-engine-regressions-v11.json'||Array.isArray(r.suites))return 'mechanism';return 'supplemental';}
function auditRegressions(reports,expected,{strictSource=true,expectedPageHash=null}={}){
 if(strictSource)assert(hash(expected),'Final regression source hash is required');
 const records=reports.map(r=>{const kind=kindOf(r),sourceHash=regressionSourceHash(r),sourceProblems=[],issues=[],need=(test,message)=>{if(!test)issues.push(message);},
  checkHash=(name,value,target=expected)=>{if(!hash(value))sourceProblems.push(name+' missing/invalid');else if(value!==target)sourceProblems.push(name+' is not the final source');};
  checkHash('regression source hash',sourceHash);
  let cases=[],coverageComplete=false,passedCount=0,failures=[];
  if(kind==='entry'){
   checkHash('engineHash',r.engineHash);if(expectedPageHash)checkHash('pageHash',r.pageHash,expectedPageHash);
   cases=r.cases||[];coverageComplete=sameNames(cases.map(c=>c.name),ENTRY_NAMES)&&r.browser===true;
   for(const c of cases){checkHash(c.name+' beforeEngine',c.beforeEngine);checkHash(c.name+' afterEngine',c.afterEngine);}
   failures=cases.filter(c=>c.passed!==true||c.exitCode!==0||c.error||c.signal||c.sourceImmutable!==true);
   passedCount=cases.length-failures.length;
   need(r.sourceImmutable===true,'entry sourceImmutable is not true');need(r.browser===true,'entry browser run missing');
   need(r.passed===passedCount&&r.failed===failures.length,'entry declared pass/fail counts differ from raw cases');
  }else if(kind==='mechanism'){
   checkHash('sourceHash',r.sourceHash);checkHash('expectedSourceHash',r.expectedSourceHash);checkHash('productionEndHash',r.productionEndHash);
   cases=r.suites||[];coverageComplete=sameNames(cases.map(c=>c.id),Object.keys(MECHANISM_MINIMUM))&&typeof r.finishedAt==='string';
   failures=cases.filter(c=>c.pass!==true||c.status!=='passed'||c.exitCode!==0||c.signal||c.spawnError||c.inputsUnchanged!==true||
    !Array.isArray(c.evidence?.problems)||c.evidence.problems.length>0||!(c.evidence.checks>=MECHANISM_MINIMUM[c.id]));
   passedCount=cases.length-failures.length;
   need(r.inputsUnchanged===true,'mechanism inputsUnchanged is not true');need(r.syntax?.pass===true&&r.syntax.exitCode===0,'mechanism syntax check failed/missing');
   need(r.pass===true,'mechanism wrapper pass is not true');
  }else{
   cases=r.cases||r.checks||[];failures=cases.filter(c=>c.passed!==true&&c.pass!==true);passedCount=cases.length-failures.length;
   coverageComplete=true;need(r.pass===true||r.failed===0&&r.passed>0,'supplemental regression does not report a pass');
  }
  if(strictSource)assert.equal(sourceProblems.length,0,'Regression source proof rejected: '+r.file+'; '+sourceProblems.join('; '));
  need(coverageComplete,kind==='entry'?'entry requires all 11 named Node/browser cases':'mechanism requires all 7 named suites and completed wrapper');
  return {file:r.file,kind,sourceHash,sourceValid:sourceProblems.length===0,sourceProblems,coverageComplete,
   immutable:kind==='entry'?r.sourceImmutable===true:kind==='mechanism'?r.inputsUnchanged===true:null,
   passedCount,failedCount:failures.length,failures:clone(failures),issues,
   passed:sourceProblems.length===0&&coverageComplete&&issues.length===0&&failures.length===0};
 });
 const missing=[];for(const kind of ['entry','mechanism']){const found=records.filter(r=>r.kind===kind);
  if(found.length!==1)missing.push(kind==='entry'?'最终entry wrapper恰好1份（11case/browser）':'最终机制wrapper恰好1份（7suite）');
  else if(!found[0].coverageComplete)missing.push(kind==='entry'?'entry全部11case与browser覆盖':'机制全部7suite已闭合');}
 for(const r of records)if(!r.sourceValid)missing.push('回归最终源码证明：'+r.file);
 return {requiredWrappersComplete:missing.length===0,missing,records,passed:missing.length===0&&records.every(r=>r.passed),
  failures:records.flatMap(r=>r.failures.map(failure=>({file:r.file,kind:r.kind,failure}))),
  issues:records.flatMap(r=>[...r.sourceProblems,...r.issues].map(issue=>({file:r.file,kind:r.kind,issue}))),
  interpretation:'Completed failing wrappers are retained as failures, not omitted or rewritten as passing. Functional regressions, physics accounting and realism residuals are separate results.'};
}
module.exports={ENTRY_NAMES,MECHANISM_MINIMUM,regressionSourceHash,auditRegressions};
