'use strict';
const assert=require('node:assert/strict');
function once(source,before,after,label){assert.equal(source.split(before).length-1,1,'Unique visible-prior anchor: '+label);return source.replace(before,after);}
function applyVisiblePriorPatch(source){
  source=source.replace(/\r\n/g,'\n');
  source=once(source,'      const segments=[],trace=options.trace?[]:null,observedLeaders=new Map();let previousLeader=null;',`      const segments=[],trace=options.trace?[]:null,observedLeaders=new Map();let previousLeader=null;
      // Optional public launch hypothesis. The default observation API remains
      // the measured-motion extrapolator, including fixed-control comparisons.
      const suppliedPrior=options.opponentMotionPrior;
      const motionPrior=suppliedPrior&&Number.isFinite(suppliedPrior.pace)&&suppliedPrior.pace>0?{
        pace:clamp(suppliedPrior.pace,3,30),
        launchUntil:Number.isFinite(suppliedPrior.launchUntil)?Math.max(0,suppliedPrior.launchUntil):0.8,
        assumedDelay:Number.isFinite(suppliedPrior.assumedDelay)?Math.max(0,suppliedPrior.assumedDelay):0.3}:null;
      let opponentPathConflict=false;`,'public prior and independent uncertainty');
  source=once(source,'        observedLeaders.set(key,F);return F;',`        F.launchPrior=!!motionPrior&&((F.observedAt<motionPrior.launchUntil&&F.observedV<3)||
          (F.accel>0.3&&F.observedV<motionPrior.pace*0.9));
        observedLeaders.set(key,F);return F;`,'freeze public observation hypothesis');
  source=once(source,'        const v=Math.max(0,F.observedV+F.accel*tau*(1-Math.exp(-age/tau))),meanV=(F.v+v)/2;',`        let v;
        if(F.launchPrior) {
          const delay=F.observedV>0?0:Math.max(0,motionPrior.assumedDelay-F.observedAt);
          const fraction=clamp((time+dt-F.observedAt-delay)/dt,0,1);
          const mix=clamp(F.v/Math.max(3,motionPrior.pace),0,1);
          const acceleration=RACE_F.maxAccel*(0.7+70/230)*(1-mix)+RACE_F.runningAccel*(0.65+70/200)*mix;
          v=Math.max(0,F.v+clamp((motionPrior.pace-F.v)/tau,-RACE_F.braking,acceleration)*dt*fraction);
          // Fractional stall release must not advance along the full time step.
          dt*=fraction;
        } else v=Math.max(0,F.observedV+F.accel*tau*(1-Math.exp(-age/tau)));
        const meanV=(F.v+v)/2;`,'visible finite launch motion');
  source=once(source,'          for(let a=0;a<traffic.length;a++)for(let b=a+1;b<traffic.length;b++)if(projectionBodySweep(traffic[a].h,traffic[b].h,traffic[a].before,traffic[b].before,traffic[a].move,traffic[b].move))pathConflict=true;',
    '          // Peers may respond to each other, which this one-way forecast cannot know.\n          // Their mutual extrapolated collision is uncertainty, not an own route veto.\n          for(let a=0;a<traffic.length;a++)for(let b=a+1;b<traffic.length;b++)if(projectionBodySweep(traffic[a].h,traffic[b].h,traffic[a].before,traffic[b].before,traffic[a].move,traffic[b].move))opponentPathConflict=true;','independent peer collision uncertainty');
  source=once(source,'lateral=(t-F.t)/dt;','lateral=dt>0?(t-F.t)/dt:0;','zero prior release fraction');
  source=once(source,'        pathConflict,trafficFeasible,trafficCertified:false,feasible:complete&&requestedEnergyFeasible,segments,',
    '        pathConflict,opponentPathConflict,trafficFeasible,trafficCertified:false,feasible:complete&&requestedEnergyFeasible,segments,','diagnostic separation');
  source=once(source,"model:{mode:requestedMode?'demand':'paid-execution',maxDt,tailMaxDt,tickOrigin,opponent:",
    "model:{mode:requestedMode?'demand':'paid-execution',maxDt,tailMaxDt,tickOrigin,opponentMotionPrior:motionPrior,opponent:",'explicit public assumption metadata');
  return source;
}
module.exports={applyVisiblePriorPatch};
