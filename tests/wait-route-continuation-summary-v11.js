#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readArchive}=require('./helpers/read-archive-v11'),args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);return i<0?value:args[i+1];};
const {HASH,DT}=require('./system-reality-v9'),root=path.resolve(__dirname,'..'),input=readArchive(path.resolve(root,arg('--input','docs/wait-route-continuation-partial-v11.json.gz'))),file=input.file,
 raw=input.text,report=JSON.parse(raw),output=path.resolve(root,arg('--out','docs/wait-route-continuation-partial-v11.regenerated-summary.json'));
if(output===file||output===file.replace(/\.gz$/,''))throw new Error('Do not overwrite the raw/gzip experiment while summarizing');
if(!report.closed)throw Error('Complete wait-route paired partial required');
delete report.finiteGoalAlwaysFine;
const candidate=report.arms.find(a=>!a.reused),follow=candidate.decisions.filter(d=>d.continuation&&d.mode==='follow');
report.actualFollowContinuationCount=follow.length;report.actualFollowContinuationAllFine=follow.every(d=>d.continuationMaxDt===DT);
report.explicitGoalResolutionEvidence={file:'docs/wait-route-continuation-focused-v11.json',scope:'Focused cases include follow without a goal and wait/route with an explicit goal. The actual partial contains no committed follow continuations and does not independently exercise that branch.'};
report.productionDecision='Not integrated: one paired partial measured32.781→32.828 CPUseconds, so no demonstrated throughput benefit. Keep execution-resolution continuation checks.';
report.regeneratedSummary={input:path.relative(root,file).replace(/\\/g,'/'),inputNormalizedSha256:HASH(raw),processorHash:HASH(fs.readFileSync(__filename,'utf8')),
 scope:'Derived diagnostics only; original archive, measured rows and historical processor/driver metadata remain unchanged.'};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({productionDecision:report.productionDecision,actualFollowContinuationCount:report.actualFollowContinuationCount,actualFollowContinuationAllFine:report.actualFollowContinuationAllFine}));
