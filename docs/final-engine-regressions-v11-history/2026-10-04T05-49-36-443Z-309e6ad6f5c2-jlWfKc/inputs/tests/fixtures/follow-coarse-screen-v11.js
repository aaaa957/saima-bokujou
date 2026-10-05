'use strict';
const assert=require('node:assert/strict');
function applyFollowCoarseScreenPatch(source){
 source=source.replace(/\r\n/g,'\n');
 if(source.includes('        // A cheap same-resolution comparison screens opportunities.')) {
  assert.equal(source.split('H.statsSummary.followScreenAttempts=').length-1,1,'Installed coarse follow counter');
  assert(source.includes("const c=evaluate('follow',actions,holdT,{s:goalS,tolerance:0.12},1/60);"),'Installed follow final validation remains fine');
  return source;
 }
 const from=source.indexOf('      H.followOpportunity=null;'),to=source.indexOf('      const futureTurns=',from);
 assert(from>=0&&to>from,'Unique follow planning block anchors');
 assert.equal(source.split('      H.followOpportunity=null;').length-1,1);
 const next=`      H.followOpportunity=null;
      if(wake&&observedPace>3&&observedPace<=planned+0.25&&horizon>1&&plan.patience>0.2) {
        // A cheap same-resolution comparison screens opportunities. It is a
        // planning heuristic, not a traffic certificate or a catch guarantee.
        // Only a subsequent 60 Hz reference and catch may enter the candidates.
        const following=Math.max(3,Math.min(planned,observedPace+0.04));
        const followTime=Math.min(horizon/2,(wake.s-H.s)/Math.max(0.1,planned-observedPace));
        const catchTime=horizon-followTime;
        const catchV=planned+Math.max(0,planned-following)*followTime/Math.max(0.1,catchTime);
        const actions=[{duration:followTime,targetV:following,targetT:wake.t,leader:visible(wake)},
          {duration:catchTime,targetV:catchV,targetT:holdT}];
        const netEnergy=f=>f.ledger.energyUsed-f.ledger.recovered;
        const goalAt=f=>f.trace.find(p=>p.time>=race.t+horizon-1e-7)?.s??f.endpoint.s;
        const coarseGoal=goalAt(baseline.forecast);
        const screened=evaluate('follow',actions,holdT,{s:coarseGoal,tolerance:0.12});
        const coarseSaving=netEnergy(baseline.forecast)-netEnergy(screened.forecast);
        const rejectReason=(c,saving,prefix)=>!c.forecast.energyFeasible?prefix+'energy':
          !c.forecast.complete||!c.forecast.goalReached?prefix+'goal':c.conflict?prefix+'path':
          !(saving>0)?prefix+'no-saving':null;
        const coarseReject=rejectReason(screened,coarseSaving,'coarse-');
        H.statsSummary.followScreenAttempts=(H.statsSummary.followScreenAttempts||0)+1;
        H.followOpportunity={following,catchV,followTime,catchTime,saving:coarseSaving,
          savingResolution:'coarse',regainedDistance:screened.forecast.endpoint.s-baseline.forecast.endpoint.s,
          goalReached:screened.forecast.goalReached,targetShortfall:screened.forecast.targetShortfall,
          pathConflict:screened.conflict,accepted:false,fineChecked:false,rejectedReason:coarseReject,
          coarse:{maxDt:options.maxDt,goalS:coarseGoal,goalReached:screened.forecast.goalReached,
            energyFeasible:screened.forecast.energyFeasible,pathConflict:screened.conflict,
            saving:coarseSaving,regainedDistance:screened.forecast.endpoint.s-baseline.forecast.endpoint.s,
            steps:screened.forecast.steps},fine:null};
        if(coarseReject) {
          const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
          reasons[coarseReject]=(reasons[coarseReject]||0)+1;
          H.statsSummary.coarseCatchRejected=(H.statsSummary.coarseCatchRejected||0)+1;
          H.statsSummary.rejectedCatchPlans=(H.statsSummary.rejectedCatchPlans||0)+1;
        } else {
          H.statsSummary.fineCatchChecks=(H.statsSummary.fineCatchChecks||0)+1;
          const reference=evaluate(baseline.mode,baseline.actions,holdT,null,1/60);
          const goalS=goalAt(reference.forecast);
          const c=evaluate('follow',actions,holdT,{s:goalS,tolerance:0.12},1/60);
          c.reference=reference;
          const saving=netEnergy(reference.forecast)-netEnergy(c.forecast),fineReject=rejectReason(c,saving,'fine-');
          Object.assign(H.followOpportunity,{saving,savingResolution:'fine',fineChecked:true,
            regainedDistance:c.forecast.endpoint.s-reference.forecast.endpoint.s,
            goalReached:c.forecast.goalReached,targetShortfall:c.forecast.targetShortfall,
            pathConflict:c.conflict,rejectedReason:fineReject,
            fine:{maxDt:1/60,goalS,goalReached:c.forecast.goalReached,energyFeasible:c.forecast.energyFeasible,
              pathConflict:c.conflict,saving,regainedDistance:c.forecast.endpoint.s-reference.forecast.endpoint.s,
              steps:c.forecast.steps}});
          if(!fineReject) {
            H.statsSummary.fineCatchViable=(H.statsSummary.fineCatchViable||0)+1;
            candidates.push(c);
          } else {
            const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
            reasons[fineReject]=(reasons[fineReject]||0)+1;
            H.statsSummary.fineCatchRejected=(H.statsSummary.fineCatchRejected||0)+1;
            H.statsSummary.rejectedCatchPlans=(H.statsSummary.rejectedCatchPlans||0)+1;
          }
        }
      }
`;
 source=source.slice(0,from)+next+source.slice(to);
 const selected="      if(mode==='follow')H.followOpportunity.accepted=true;";
 assert.equal(source.split(selected).length-1,1,'Follow commit telemetry anchor');
 return source.replace(selected,selected+`\n      else if(H.followOpportunity?.fineChecked&&!H.followOpportunity.rejectedReason) {
        H.followOpportunity.rejectedReason='lower-score';
        const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
        reasons['lower-score']=(reasons['lower-score']||0)+1;
      }`);
}
module.exports={applyFollowCoarseScreenPatch};
