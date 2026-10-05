'use strict';
const assert=require('node:assert/strict');
function applyWaitRouteContinuationPatch(source){
 source=source.replace(/\r\n/g,'\n');
 if(source.includes("const continuationDt=sequence.mode==='follow'||sequence.goal?1/60:options.maxDt;")) {
  assert.equal(source.split('continuationMaxDt:continuationDt').length-1,1,'Installed continuation resolution telemetry');
  return source;
 }
 const before='        const continuation=actions.length?evaluate(sequence.mode,actions,actions.at(-1).targetT,sequence.goal,1/60):null;';
 const after=`        // A wait/route order has no absolute distance promise. Continue
        // checking it at the same resolution used to choose it initially.
        // Every follow order or explicit goal retains execution-resolution checks.
        const continuationDt=sequence.mode==='follow'||sequence.goal?1/60:options.maxDt;
        const continuation=actions.length?evaluate(sequence.mode,actions,actions.at(-1).targetT,sequence.goal,continuationDt):null;`;
 assert.equal(source.split(before).length-1,1,'Unique sequence continuation resolution');
 source=source.replace(before,after);
 const telemetry='          H.planning={...H.planning,continuation:true,remainingActions:actions.length,';
 assert.equal(source.split(telemetry).length-1,1,'Unique continuation telemetry');
 return source.replace(telemetry,'          H.planning={...H.planning,continuation:true,continuationMaxDt:continuationDt,remainingActions:actions.length,');
}
module.exports={applyWaitRouteContinuationPatch};
