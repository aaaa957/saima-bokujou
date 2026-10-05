#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {HASH,q}=require('./system-reality-v9');
const {readArchive}=require('./helpers/read-archive-v11'),args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);return i<0?value:args[i+1];};
const root=path.resolve(__dirname,'..'),input=readArchive(path.resolve(root,arg('--input','docs/follow-coarse-screen-partial-v11.json.gz'))),file=input.file,
 raw=input.text,report=JSON.parse(raw),output=path.resolve(root,arg('--out','docs/follow-coarse-screen-partial-v11.regenerated-summary.json'));assert(report.closed&&report.arms.length===2,'Finished paired partial evaluation');
assert.notEqual(output,file,'Do not overwrite the raw/gzip experiment while summarizing');assert.notEqual(output,file.replace(/\.gz$/,''),'Do not replace its raw sibling');
const diagnosticKeys=['followScreenAttempts','coarseCatchRejected','fineCatchChecks','fineCatchViable','fineCatchRejected','followRejectedReasons','rejectedCatchPlans'];
const statKeys=['rejectedCatchPlans','committedSequences','cancelledSequences',...diagnosticKeys.filter(k=>!['followRejectedReasons','rejectedCatchPlans'].includes(k))];
for(const arm of report.arms){for(const d of arm.decisions)d.continuation=d.reason==='从实测状态复核并继续已规划的动作序列';const attempts=arm.decisions.filter(d=>d.opportunity&&!d.continuation);
 arm.followOpportunities=attempts.length;arm.acceptedFollowDecisions=attempts.filter(d=>d.opportunity.accepted).length;arm.rejectedReasonCounts=attempts.reduce((a,d)=>{const reason=d.opportunity.rejectedReason;if(reason)a[reason]=(a[reason]||0)+1;return a;},{});
 arm.aggregatePlanningStats=Object.fromEntries(statKeys.map(k=>[k,arm.horses.reduce((n,h)=>n+(h.stats[k]||0),0)]));
}
const stripStats=stats=>Object.fromEntries(Object.entries(stats).filter(([key])=>!diagnosticKeys.includes(key)));
const physical=arm=>({frames:arm.frames,internalTicks:arm.internalTicks,simulatedSeconds:arm.simulatedSeconds,parameters:arm.parameters,trace:arm.trace,traffic:arm.traffic,guards:arm.engineering,horses:arm.horses.map(h=>({...h,stats:stripStats(h.stats)}))});
const decisions=arm=>arm.decisions.map(d=>Object.fromEntries(Object.entries(d).filter(([key])=>!['opportunity','continuation'].includes(key))));
report.paired.physicalTrajectoryAndLedgerExact=JSON.stringify(physical(report.arms[0]))===JSON.stringify(physical(report.arms[1]));report.paired.selectedDecisionsExact=JSON.stringify(decisions(report.arms[0]))===JSON.stringify(decisions(report.arms[1]));
report.paired.physicalTrajectoryDataHashes=report.arms.map(a=>HASH(JSON.stringify(physical(a))));
report.paired.excludedPlanningDiagnosticKeys=diagnosticKeys;
const newer=new Map(report.arms[1].decisions.filter(d=>!d.continuation).map(d=>[d.id+'/'+d.time,d]));
report.paired.previouslyFinePositiveCoarseDiscards=report.arms[0].decisions.filter(d=>!d.continuation&&d.opportunity?.goalReached&&d.opportunity.saving>0&&!d.opportunity.pathConflict).flatMap(old=>{
 const next=newer.get(old.id+'/'+old.time);return next?.opportunity?.rejectedReason?.startsWith('coarse-')?[{id:old.id,time:old.time,previousFineSaving:old.opportunity.saving,previousFineGoalReached:old.opportunity.goalReached,previousFinePathConflict:old.opportunity.pathConflict,previousSelectedMode:old.mode,newRejectedReason:next.opportunity.rejectedReason,newCoarse:next.opportunity.coarse,scope:'Positive fine opportunity in the original exact same physical trajectory was discarded by the coarse heuristic. It was not selected in the original controller either. Original follow telemetry does not separately expose energyFeasible.'}]:[];
});
for(const distance of [200,400,600]){const values=report.arms.map(a=>a.horses.map(h=>h.sectionals.find(x=>x.distance===distance)?.time).filter(Number.isFinite));report.paired['first'+distance+'MedianDelta']=q(values[1])-q(values[0]);report.paired['first'+distance+'LeaderDelta']=Math.min(...values[1])-Math.min(...values[0]);}
report.regeneratedSummary={input:path.relative(root,file).replace(/\\/g,'/'),inputNormalizedSha256:HASH(raw),processorHash:HASH(fs.readFileSync(__filename,'utf8')),
 scope:'Derived diagnostics only. Original measured rows, timings and execution-driver hash/snapshot remain archived unchanged.'};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({paired:report.paired,arms:report.arms.map(a=>({name:a.name,threadCpuSeconds:a.threadCpuSeconds,followOpportunities:a.followOpportunities,acceptedFollowDecisions:a.acceptedFollowDecisions,rejectedReasonCounts:a.rejectedReasonCounts,aggregatePlanningStats:a.aggregatePlanningStats})),counterfactuals:report.counterfactuals},null,2));
