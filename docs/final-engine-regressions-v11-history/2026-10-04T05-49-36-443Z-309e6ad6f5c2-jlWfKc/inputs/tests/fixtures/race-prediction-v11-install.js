'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function replaceOnce(source,before,after,label){assert.equal(source.split(before).length-1,1,'Unique prediction patch anchor: '+label);return source.replace(before,after);}
function installFollowingSolverAndCap(source){
  const start=source.indexOf('      const brakingCache=new WeakMap(),stoppingCache=new WeakMap(),followingCache=new WeakMap(),brakingInterval=0.125;');
  const end=source.indexOf('      // 横移提案同步审核',start);
  assert(start>=0&&end>start,'Current pure pairwise following solver anchors missing');
  let body=source.slice(start,end);
  body=body.replace('Math.max(...[...motionModel.values()].map(m=>m.freeV))','maximumSpeed');
  body=body.replaceAll('horseLen(','followingBodyLength(').replaceAll('bodyClearance(','followingBodyClearance(');
  const factory='    // Shared one-way physical stopping/response constraint; no opponent hidden state.\n    function followingConstraintSolver(maximumSpeed) {\n'+body+'      return followingSlack;\n    }\n';
  source=source.slice(0,start)+'      const followingSlack=followingConstraintSolver(Math.max(...[...motionModel.values()].map(m=>m.freeV)));\n'+source.slice(end);
  source=replaceOnce(source,'    function reserveToFinish(H,requestedV,draftDistance=0) {',factory+'    function reserveToFinish(H,requestedV,draftDistance=0) {','shared pairwise headway factory');
  source=replaceOnce(source,'          const gap=old.get(front).s-before.s-(horseLen(H)+horseLen(front))/2-0.25;\n          const safe=Math.max(0,old.get(front).v+gap*0.65);',
    '          const safe=followingSpeedCap(H,front,before,old.get(front));','shared actual following desired cap');
  return source;
}
function applyPredictionOpponentPatch(raw){
  let source=raw.replace(/\r\n/g,'\n');
  const from=source.indexOf('    // 状态推进共用实际供能'),to=source.indexOf('    function reserveToFinish(H,requestedV,draftDistance=0)',from);
  assert(from>=0&&to>from,'Installed prediction core anchors missing');
  const code=fs.readFileSync(path.join(__dirname,'race-prediction-v11-core.txt'),'utf8').replace(/\r\n/g,'\n');
  source=source.slice(0,from)+code.replace(/\n*$/,'\n\n')+source.slice(to);
  return installFollowingSolverAndCap(source);
}
function applyPredictionPatch(raw){
  let source=raw.replace(/\r\n/g,'\n');
  const code=fs.readFileSync(path.join(__dirname,'race-prediction-v11-core.txt'),'utf8').replace(/\r\n/g,'\n');
  const from=source.indexOf('    // 路线预算预测有限加速与制动'),to=source.indexOf('    function reserveToFinish(H,requestedV,draftDistance=0)',from);
  assert(from>=0&&to>from,'Original route forecast block missing');
  source=source.slice(0,from)+code.replace(/\n*$/,'\n\n')+source.slice(to);
  source=replaceOnce(source,'      H.finishPlan=(requestedV,draftDistance=0,options={})=>finishPlan(H,requestedV,draftDistance,options);',
    '      H.finishPlan=(requestedV,draftDistance=0,options={})=>finishPlan(H,requestedV,draftDistance,options);\n      H.projectActions=(actions,options={})=>projectActions(H,actions,options);','public projection API');
  const supplyBefore=`        const fatigue=1-H.fatigueLoss*(1-H.guts/H.gutsMax);
        const aerobicTarget=H.aerobic*fatigue;
        H.aerobicOutput+=(aerobicTarget-H.aerobicOutput)*(1-Math.exp(-dt/H.aerobicTau));
        const aerobic=H.aerobicOutput;
        const stRatio=clamp(H.stamina/H.staminaMax,0,1);
        const reserveFade=clamp(stRatio/RACE_F.reserveFade,0,1);
        // 可用无氧功率同时受剩余容量与本步能量约束，不能先透支再截成零。
        const reservePower=Math.min(H.reservePower*reserveFade,H.stamina/dt);
        const maxPower=aerobic+reservePower;`;
  source=replaceOnce(source,supplyBefore,`        const supply=raceSupplyState(H,dt);
        H.aerobicOutput=supply.aerobic;
        const {fatigue,aerobic,reserveFade,maxPower}=supply;`,'shared supply');
  const accelBefore=`        const accelerationMix=clamp(H.v/H.base,0,1);
        const maxA=(RACE_F.maxAccel*(0.7+H.adj['出闸能力']/230)*(1-accelerationMix)+
          RACE_F.runningAccel*(0.65+H.adj['爆发力']/200)*accelerationMix)*
          (0.65+0.35*reserveFade);
        const response=RACE_F.responseTime*clamp(1+(0.65-H.behavior.tractability)*0.4,0.82,1.26);
        const kineticBudget=Math.max(0,maxPower-powerCost(H,H.v,0,!!wake))/(H.massRatio*Math.max(H.v,1));
        let a=clamp((desired-H.v)/response,-RACE_F.braking,Math.min(maxA,kineticBudget));
        let nextV=Math.max(0,H.v+a*dt*startFraction);`;
  source=replaceOnce(source,accelBefore,`        const limits=raceAccelerationLimits(H,supply,!!wake);
        const {maxA,response,kineticBudget}=limits;
        let a=clamp((desired-H.v)/response,-RACE_F.braking,Math.min(maxA,kineticBudget));
        let nextV=Math.max(0,H.v+a*dt*startFraction);`,'shared finite acceleration');
  const proposalBefore=`          const lateralLimit=Math.min(RACE_F.lateralSpeed,(H.v+v)/2*0.06)*dt*startFraction;
          const t=clamp(H.t+clamp(transverse-H.t,-lateralLimit,lateralLimit),bodyMargin,width-bodyMargin);
          const lateral=startFraction?(t-before.t)/(dt*startFraction):0,travelV=(H.v+v)/2;
          const forwardV=Math.sqrt(Math.max(0,travelV*travelV-lateral*lateral));
          const proposal={s:advancePhysical(H.s,forwardV*dt*startFraction,(H.t+t)/2),
            t,v,a:(v-H.v)/dt,travelV,lateral,aerobic,activeFraction:startFraction};`;
  source=replaceOnce(source,proposalBefore,`          const proposal=raceKinematicProposal(H,before,v,transverse,dt,startFraction,aerobic);`,'shared paid route movement');
  const ledgerBefore=`        const excess=Math.max(0,work-move.aerobic), draw=Math.min(H.stamina,excess*dt);
        // 只有明显低于供能的做功才允许有限恢复；制动不回充动能。
        const restore=Math.min(H.staminaMax-H.stamina,Math.max(0,move.aerobic*0.90-work)*H.recoveryRate*dt,H.recoveryMax*dt);
        H.stamina=clamp(H.stamina-draw+restore,0,H.staminaMax);
        H.guts=Math.max(0,H.guts-(H.fatigueWork*work+H.fatigueExcess*excess)*dt);
        H.retention=1-H.fatigueLoss*(1-H.guts/H.gutsMax);`;
  source=replaceOnce(source,ledgerBefore,`        const energy=raceEnergyState(H,work,move.aerobic,dt);
        const {excess,draw,restore}=energy;
        H.stamina=energy.stamina;H.guts=energy.guts;H.retention=energy.retention;`,'shared reserve/fatigue/recovery');
  source=replaceOnce(source,'if(finishPlan(H,mid,draftDistance,{reserve}).feasible) low=mid;else high=mid;',
    'if(finishPlan(H,mid,draftDistance,{reserve,earlyExit:true}).feasible) low=mid;else high=mid;','early infeasible budget exit');
  return installFollowingSolverAndCap(source);
}
module.exports={applyPredictionPatch,applyPredictionOpponentPatch};
