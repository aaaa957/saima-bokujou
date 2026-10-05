'use strict';
// Source fixture for the v11 rider. The production engine remains one browser script.
const fs=require('node:fs');
const controller=String.raw`    // Only visible motion is extrapolated. Opponents' energy and future orders are unknown.
    function observedPosition(F,seconds,anticipatedPace=null) {
      const response=RACE_F.responseTime;
      // At the break, frozen zero-speed extrapolation would pretend that all rivals
      // remain in their stalls. Use a shared public kinematic prior, then replace it
      // with observed motion. No rival attributes or reserve enter this estimate.
      if(anticipatedPace&&((race.t<0.8&&F.v<3)||(F.accel>0.3&&F.v<anticipatedPace*0.9))) {
        let elapsed=0,v=F.v,distance=0,delay=F.v>0?0:Math.max(0,0.3-race.t);
        while(elapsed<seconds-1e-9){const dt=Math.min(0.25,seconds-elapsed),moving=Math.max(0,elapsed+dt-Math.max(elapsed,delay));
          const mix=clamp(v/Math.max(3,anticipatedPace),0,1);
          const limit=RACE_F.maxAccel*(0.7+70/230)*(1-mix)+RACE_F.runningAccel*(0.65+70/200)*mix;
          const next=Math.max(0,v+clamp((anticipatedPace-v)/response,-RACE_F.braking,limit)*moving);
          distance+=(v+next)*moving/2;v=next;elapsed+=dt;}
        return {s:F.s+distance*laneProgressCoef(F.s,F.t,geo),t:F.t,v};
      }
      const a=clamp(F.accel||0,-RACE_F.braking,RACE_F.runningAccel);
      const change=a*response*(1-Math.exp(-seconds/response));
      const stop=a<0&&F.v+a*response<0?-response*Math.log1p(F.v/(a*response)):Infinity;
      const movingSeconds=Math.min(seconds,stop);
      const distance=Math.max(0,F.v*movingSeconds+a*response*(movingSeconds-response*(1-Math.exp(-movingSeconds/response))));
      return {s:F.s+distance*laneProgressCoef(F.s,F.t,geo),t:F.t,v:Math.max(0,F.v+change)};
    }
    function applyRiderSequence(H) {
      const sequence=H.riderSequence;if(!sequence)return;
      let elapsed=race.t-sequence.at,index=0;
      while(index<sequence.actions.length&&elapsed>=sequence.actions[index].duration-1e-9){elapsed-=sequence.actions[index++].duration;}
      if(index===sequence.actions.length){H.riderSequence=null;H.lastObserve=0;return;}
      const action=sequence.actions[index];
      H.targetV=Math.max(3,Math.min(H.maxV,action.targetV));
      if(sequence.stage!==index){sequence.stage=index;setLaneTarget(H,action.targetT);}
    }
    function runAI(H) {
      if(H.control) return;
      const list=ranked(),remaining=Math.max(0,length-H.s),localFront=frontOf(H);
      const behavior=H.behavior||{forwardness:0.5,settle:0.5,tractability:0.5};
      const plan=H.plan||{position:behavior.forwardness,risk:0.5,patience:behavior.settle};
      const quality={'新人':0.40,'普通':0.70,'优秀':0.88,'殿堂':0.97}[H.jockey]??0.70;
      const speedError=(rng()*2-1)*(0.05+(1-quality)*0.55);
      const reserveEstimate=H.stamina*clamp(1+(rng()*2-1)*(0.02+(1-quality)*0.18),0.82,1.18);
      const near=list.filter(F=>F!==H&&Math.abs(F.s-H.s)<48);
      const wake=near.filter(F=>F.s>H.s&&F.s-H.s<=RACE_F.draftRange&&
        Math.abs(F.t-H.t)<=(horseWid(H)+horseWid(F))/2+0.8).sort((a,b)=>a.s-b.s)[0];
      const visible=F=>({id:F.id,s:F.s,t:F.t,v:Math.max(0,F.v+speedError),accel:F.accel||0,lateralV:F.lateralV||0,
        bodyLength:horseLen(F),bodyWidth:horseWid(F)});
      const observedPace=(wake?.v??localFront?.v??H.v)+speedError;
      // The remaining-route budget and the short action forecast share state propagation.
      // A possible wake is credited only by a finite forecast while actually in its corridor.
      const planned=budgetSpeed(H,reserveEstimate*clamp(0.965+0.02*plan.risk,0.965,0.985),0);
      updateStartState(H,planned);
      const horizon=Math.max(0.05,Math.min(8,remaining/Math.max(3,planned)));
      const settleDuration=Math.min(RACE_F.responseTime*2,Math.max(0,remaining/Math.max(3,planned)-horizon));
      const evaluationHorizon=horizon+settleDuration;
      const options={maxDt:0.12,trace:true,opponents:list.filter(F=>F!==H).map(visible),
        opponentMotionPrior:{pace:H.startSettled?planned:Math.max(planned,H.base+RACE_F.peakExtra),launchUntil:0.8,assumedDelay:0.3}};
      const holdT=H.laneIntentT>0?H.targetT:H.t;
      const evaluate=(mode,actions,t,goal=null,maxDt=options.maxDt)=>{
        const requests=actions.map(a=>({...a,targetT:a.targetT??t}));
        if(requests[0].leader===undefined)requests[0].leader=wake?visible(wake):null;
        if(goal)requests.at(-1).goal=goal;
        // Account for the subsequent return to budget pace instead of pricing all
        // terminal kinetic energy as if it disappeared at the planning boundary.
        if(settleDuration>0)requests.push({duration:settleDuration,targetV:planned,targetT:t,leader:null});
        const forecast=H.projectActions(requests,{...options,maxDt});
        // Every projected own sweep is checked against the same visible motion
        // used for wake and following constraints. Future rival responses remain
        // uncertain; the actual simultaneous solver still checks execution.
        const conflict=forecast.pathConflict;
        return {mode,actions,t,goal,forecast,conflict,request:actions[0].targetV};
      };
      if(H.riderSequence) {
        const sequence=H.riderSequence,actions=[];let elapsed=race.t-sequence.at;
        for(const action of sequence.actions){if(elapsed>=action.duration){elapsed-=action.duration;continue;}
          actions.push({...action,duration:action.duration-elapsed,
            leader:action.leader===null?null:action.leader&&wake?visible(wake):undefined});elapsed=0;}
        const continuation=actions.length?evaluate(sequence.mode,actions,actions.at(-1).targetT,sequence.goal,1/60):null;
        if(continuation&&!continuation.conflict&&continuation.forecast.energyFeasible&&continuation.forecast.goalReached) {
          applyRiderSequence(H);
          H.planning={...H.planning,continuation:true,remainingActions:actions.length,
            predictedGoal:continuation.forecast.goalReached,predictedS:continuation.forecast.endpoint.s};
          recordDecision(H,list,sequence.mode,'从实测状态复核并继续已规划的动作序列',reserveEstimate,observedPace);return;
        }
        H.statsSummary.cancelledSequences=(H.statsSummary.cancelledSequences||0)+1;H.riderSequence=null;
      }
      const candidates=[],baseline=evaluate(H.startSettled?'settle':'start',
        [{duration:horizon,targetV:planned}],holdT);
      candidates.push(baseline);
      const ahead=near.filter(F=>F.s>H.s).sort((a,b)=>a.s-b.s)[0];
      const nextBend=routeCorners.find(at=>at>H.s+0.1&&kAt(Math.min(length,at+0.1),geo)>0);
      const bendDeadline=nextBend===undefined?Infinity:(nextBend-H.s)/Math.max(3,planned);
      const targetRank=(1-plan.position)*Math.max(0,list.length-1);
      const rankCache=new WeakMap();
      const rankAt=forecast=>{
        if(rankCache.has(forecast))return rankCache.get(forecast);
        // Utility and motion share this candidate's visible trajectory and time.
        const endpoints=new Map((forecast.observedLeaderEndpoints||[]).map(F=>[F.id,F]));
        const rank=list.filter(F=>F!==H).reduce((sum,F)=>{
          const p=endpoints.get(F.id)||observedPosition(visible(F),forecast.seconds,options.opponentMotionPrior.pace);
          return sum+(p.finished?1:clamp(0.5+(p.s-forecast.endpoint.s)/Math.max(2,horseLen(H)*2),0,1));
        },0);
        rankCache.set(forecast,rank);return rank;
      };
      const baseRank=rankAt(baseline.forecast);
      const baseEnergy=baseline.forecast.ledger.energyUsed-baseline.forecast.ledger.recovered;
      const powerSlope=(H.powerFor(planned+0.12,0,false)-H.powerFor(Math.max(3,planned-0.12),0,false))/0.24;
      const reservePrice=(1+0.12*plan.patience)/Math.max(3,powerSlope-Math.max(0,H.powerFor(planned,0,false)-H.aerobicOutput)/Math.max(3,planned));
      // Position has value through room to run, contact with the pack and corner access.
      // It never adds a speed, acceleration or energy multiplier to a running style.
      const positionValue=horseLen(H)*(0.65+0.55*plan.risk)*(bendDeadline<horizon+3?1.35:1);
      H.targetV=planned;
      const openGap=findGap(H,true);
      const sideBlocked=t=>near.some(F=>Math.abs(F.s-H.s)<(horseLen(H)+horseLen(F))/2+0.35&&
        Math.min(H.t,t)-(horseWid(H)+horseWid(F))/2-0.1<F.t&&F.t<Math.max(H.t,t)+(horseWid(H)+horseWid(F))/2+0.1);
      const lanes=[holdT];
      if(openGap&&Math.abs(openGap.t-holdT)>0.3&&!sideBlocked(openGap.t)) lanes.push(openGap.t);
      const inner=Math.max(horseWid(H)/2+0.25,H.t-Math.min(2,horizon*RACE_F.lateralSpeed));
      if(H.laneIntentT<=0&&Math.abs(inner-holdT)>0.3&&!sideBlocked(inner)&&!lanes.some(t=>Math.abs(t-inner)<0.3)) lanes.push(inner);
      const attackPlan=finishPlan(H,H.maxV,0,{reserve:reserveEstimate});
      const budgetFinishTime=attackPlan.feasible?finishPlan(H,planned,0,{reserve:reserveEstimate}).seconds:null;
      for(const t of lanes) {
        if(t!==holdT)candidates.push(evaluate('route',[{duration:horizon,targetV:planned}],t));
        const needPosition=!H.startSettled||baseRank>targetRank+0.25||
          (ahead&&ahead.s-H.s<12&&ahead.v>planned+0.05);
        if(needPosition||attackPlan.feasible) {
          const surge=Math.min(H.maxV,Math.max(planned+0.25,
            ahead?ahead.v+speedError+(ahead.s-H.s+horseLen(H))/Math.max(2,horizon):H.maxV));
          candidates.push(evaluate(attackPlan.feasible?'attack':!H.startSettled?'start-position':'position',
            [{duration:horizon,targetV:attackPlan.feasible?H.maxV:surge}],t));
        }
      }
      // Dropping behind a flank can create a legal inside route; it is paid and timed.
      if(H.laneIntentT<=0&&(sideBlocked(inner)||H.blocked)&&H.v>3) {
        const delay=Math.min(2,horizon/2),front=localFront;
        const easing=Math.max(3,Math.min(planned-0.35,front?front.v-0.2:planned-0.35));
        candidates.push(evaluate('wait-route',[{duration:delay,targetV:easing,targetT:H.t},
          {duration:horizon-delay,targetV:planned,targetT:inner}],inner));
      }
      H.followOpportunity=null;
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
      const futureTurns=routeMesh.reduce((angle,at,i)=>i&&at>H.s?
        angle+kAt((Math.max(H.s,routeMesh[i-1])+at)/2,geo)*(at-Math.max(H.s,routeMesh[i-1])):angle,0);
      for(const c of candidates) {
        const f=c.forecast,rank=rankAt(f),netEnergy=f.ledger.energyUsed-f.ledger.recovered;
        const reference=c.reference||baseline,ref=reference.forecast;
        const refEnergy=ref.ledger.energyUsed-ref.ledger.recovered,refRank=rankAt(ref);
        const positionGain=Math.abs(refRank-targetRank)-Math.abs(rank-targetRank);
        const routeBenefit=(holdT-f.endpoint.t)*futureTurns*0.35;
        const changeCost=c.t!==holdT?0.15:0;
        c.score=f.endpoint.s-ref.endpoint.s-(netEnergy-refEnergy)*reservePrice+
          positionGain*positionValue+routeBenefit-changeCost;
        // Once the complete remaining route is payable, unused reserve has no
        // terminal value: compare finishing time, keeping the local traffic check.
        if(c.mode==='attack'&&attackPlan.feasible)c.score=Math.max(c.score,
          (budgetFinishTime-attackPlan.seconds)*planned+routeBenefit-changeCost);
        if(f.finished)c.score=((baseline.forecast.finished?baseline.forecast.seconds:budgetFinishTime??evaluationHorizon)-f.seconds)*planned;
        if(c.conflict||!f.energyFeasible)c.score=-Infinity;
      }
      const viable=candidates.filter(c=>Number.isFinite(c.score));
      let chosen=viable.sort((a,b)=>b.score-a.score)[0]||baseline;
      if(chosen!==baseline&&chosen.score<0.15&&Number.isFinite(baseline.score))chosen=baseline;
      let mode=chosen.mode,reason={start:'建立可支付的跑动速度','start-position':'在发走后争取可达的位置',
        settle:'按自身状态保留余程能力',route:'比较横移时间与剩余弯道外绕成本',position:'短时推进争取可达位置',
        attack:'余程预算支持持续发力',follow:'连续跟跑、追回的距离目标可达且净耗能降低',
        'wait-route':'收力留出横移间隙，再进入较短路线'}[mode];
      const attacking=mode==='attack',sr=H.stamina/Math.max(1,H.staminaMax);
      H.targetV=Math.max(3,Math.min(H.maxV,chosen.request));
      const first=chosen.actions[0];
      if(Math.abs((first.targetT??chosen.t)-H.targetT)>0.2)setLaneTarget(H,first.targetT??chosen.t);
      if(mode==='follow')H.followOpportunity.accepted=true;
      else if(H.followOpportunity?.fineChecked&&!H.followOpportunity.rejectedReason) {
        H.followOpportunity.rejectedReason='lower-score';
        const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
        reasons['lower-score']=(reasons['lower-score']||0)+1;
      }
      if(mode==='follow'||mode==='wait-route') {
        H.riderSequence={at:race.t,mode,stage:-1,actions:chosen.actions.map(a=>({...a})),
          goal:chosen.goal};
        applyRiderSequence(H);
      }
      H.planning={horizon,evaluationHorizon,targetRank,bendDeadline:Number.isFinite(bendDeadline)?bendDeadline:null,
        reservePrice,selected:mode,selectedScore:Number.isFinite(chosen.score)?chosen.score:null,
        baseline:{s:baseline.forecast.endpoint.s,energy:baseEnergy,rank:baseRank},
        candidates:candidates.map(c=>({mode:c.mode,targetV:c.request,targetT:c.t,score:Number.isFinite(c.score)?c.score:null,
          predictedS:c.forecast.endpoint.s,predictedReserve:c.forecast.endpoint.stamina,
          energyFeasible:c.forecast.energyFeasible,goalReached:c.forecast.goalReached,
          targetShortfall:c.forecast.targetShortfall,pathConflict:c.conflict}))};
      const sequenceBeforeSafety=H.riderSequence,beforeSafety={targetV:H.targetV,targetT:H.targetT},reasonBeforeSafety=reason;
      setAction(H,attacking?(sr>0.15?'打鞭':'推骑'):H.targetV>H.v+0.15?'推骑':'收力');
      if(!viable.length||(localFront&&localFront.s-H.s<4+Math.max(0,H.targetV-localFront.v)*3&&H.targetV>localFront.v+0.3)) {
        if(!avoidBlock(H,openGap)){mode='wait';reason='预测通道未开放，保留制动距离等待';}
      }
      const speedChanged=H.targetV!==beforeSafety.targetV,laneChanged=H.targetT!==beforeSafety.targetT;
      H.planning.selectedCandidate=chosen.mode;
      H.planning.actualControls={targetV:H.targetV,targetT:H.targetT};
      if(speedChanged||laneChanged) {
        // The safety command has no forecast for the selected action tuple.
        // Preserve that immediate command and distinguish it from its candidate.
        H.statsSummary.safetyOverrides=(H.statsSummary.safetyOverrides||0)+1;
        if(sequenceBeforeSafety) {
          H.riderSequence=null;
          H.statsSummary.safetyOverriddenSequences=(H.statsSummary.safetyOverriddenSequences||0)+1;
          if(sequenceBeforeSafety.mode==='follow'&&H.followOpportunity) {
            H.followOpportunity.accepted=false;
            H.followOpportunity.rejectedReason='safety-override';
            const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
            reasons['safety-override']=(reasons['safety-override']||0)+1;
          }
        }
        mode=laneChanged?'route':'wait';
        reason=sequenceBeforeSafety?'按实测近马避让调整实际指令，取消尚未执行的动作序列':'按实测近马避让调整实际指令';
        H.planning.selectedCandidateScore=H.planning.selectedScore;
        H.planning.selectedScore=null;
        H.planning.selected=mode;
        H.planning.sequenceCommitted=false;
        H.planning.safetyOverride={candidateMode:chosen.mode,before:beforeSafety,
          actual:{targetV:H.targetV,targetT:H.targetT},speedChanged,laneChanged};
      } else {
        // Merely repeating a safe assignment does not change the action tuple.
        if(sequenceBeforeSafety) {
          mode=sequenceBeforeSafety.mode;reason=reasonBeforeSafety;
          H.statsSummary.committedSequences=(H.statsSummary.committedSequences||0)+1;
          H.planning.sequenceCommitted=true;
        } else if(mode!==chosen.mode) {
          // No viable plan may require waiting without a numerical tuple change.
          H.planning.selectedCandidateScore=H.planning.selectedScore;
          H.planning.selectedScore=null;
          H.planning.fallbackReason=reason;
        }
        H.planning.selected=mode;
      }
      // Bookkeep labels after safety chooses the actual instruction, once only.
      const finalAttacking=mode==='attack';
      if(finalAttacking&&!H.attacking) {
        H.statsSummary.launches=(H.statsSummary.launches||0)+1;
        if(H.sprintAt===null){H.sprintAt=H.s;H.statsSummary.sprintAt=H.s;}
        event(H.name+' 开始发力！');
      } else if(!finalAttacking&&H.attacking) {
        H.statsSummary.withdrawals=(H.statsSummary.withdrawals||0)+1;event(H.name+' 收力重新调整节奏');
      }
      H.attacking=finalAttacking;
      recordDecision(H,list,mode,reason,reserveEstimate,observedPace);
      if(H.planning.safetyOverride||H.planning.fallbackReason) {
        const detail={selectedCandidate:H.planning.selectedCandidate,targetT:H.targetT,
          ...(H.planning.safetyOverride?{safetyOverride:H.planning.safetyOverride}:{}),
          ...(H.planning.fallbackReason?{fallbackReason:H.planning.fallbackReason}:{})};
        Object.assign(H.strategy,detail);
        Object.assign(H.strategyHistory[H.strategyHistory.length-1],detail);
      }
    }
`;
function applyController(source){
  const existing=source.indexOf('    // Only visible motion is extrapolated.'),start=existing>=0?existing:source.indexOf('    function runAI(H) {'),end=source.indexOf('    function headwindAt(at) {',start);
  if(start<0||end<0)throw new Error('Rider source anchors missing');
  source=source.slice(0,start)+controller+source.slice(end);
  // Lateral velocity is measured from the completed paid movement, so forecasts
  // can observe a lane change without reading another rider's target lane.
  if(!source.includes('H.accel=(H.v-before.v)/dt;H.lateralV=move.lateral;'))
    source=source.replace('H.v=move.v;H.accel=(H.v-before.v)/dt;',
      'H.v=move.v;H.accel=(H.v-before.v)/dt;H.lateralV=move.lateral;');
  source=source.replace('    function step(dt) {','    function step(dt,onTick) {');
  const beforeStep='      for(let i=0;i<count&&!race.finished;i++) tick(sub);';
  const afterStep=String.raw`      for(let i=0;i<count&&!race.finished;i++) {
        let left=sub;
        while(left>1e-10&&!race.finished) {
          let slice=left;
          // Execute finite action transitions at their forecast time, including
          // transitions falling between two display/60 Hz update boundaries.
          for(const H of horses)if(!H.control&&!H.place&&!H.dnf&&H.riderSequence) {
            let boundary=H.riderSequence.at;
            for(const action of H.riderSequence.actions){boundary+=action.duration;
              const until=boundary-race.t;if(until>1e-9){slice=Math.min(slice,until);break;}}
          }
          const before=typeof onTick==='function'?horses.map(H=>({id:H.id,s:H.s,t:H.t,v:H.v,place:H.place,dnf:H.dnf})):null;
          tick(slice);if(before)onTick(before,slice);left-=slice;
        }
      }`;
  if(source.includes(beforeStep))source=source.replace(beforeStep,afterStep);
  const anchor='        if(!H.control && H.lastObserve<=0) {runAI(H);';
  if(!source.includes(anchor))throw new Error('Rider execution anchor missing');
  return source.includes('        if(!H.control)applyRiderSequence(H);')?source:source.replace(anchor,'        if(!H.control)applyRiderSequence(H);\n'+anchor);
}
module.exports={applyController,controller};
if(require.main===module){const file=process.argv[2];fs.writeFileSync(file,applyController(fs.readFileSync(file,'utf8')));}
