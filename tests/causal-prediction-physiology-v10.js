#!/usr/bin/env node
'use strict';
// Diagnostic controls only: production source and global coefficients are never edited.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {api,HASH,q,DT}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),sourcePath=path.join(ROOT,'sim.js');
const source=fs.readFileSync(sourcePath,'utf8'),engineHash=HASH(source);
const EXPECTED='51caabc1395b62a325f3048aa923994516310d8c69665f3fd17b89978615b82a';
assert.equal(engineHash,EXPECTED,'Freeze the declared source; do not silently reuse results after production changes');
const patches=[
  ['if(segments) segments.push({from:a,to:b,v:distance/seconds,fromV:previousV,toV:end.v,time:seconds,',
   'if(segments) segments.push({from:a,to:b,v:distance/seconds,fromV:previousV,toV:end.v,time:seconds,diagnosticTrajectory:{startTime:elapsed,boundedTime,boundedV,target,limit,sign,response,distance},'],
  ['          (0.65+0.35*reserveFade);','          (0.65+0.35*(H.diagnosticFixedAccelerationReserve??reserveFade));'],
  ['        motion.set(H,paidProposal(nextV));H.pot=desired;',
   '        motion.set(H,paidProposal(nextV));H.pot=desired;\n        H.diagnosticStep={fatigue,aerobic,cap,desired,kineticBudget,maxA,maxPower,reserveFade,maxVCap:H.maxV*fatigue,steadyPowerCap:speedAtPower(H,maxPower,!!wake),curveCap:curvature>0?Math.sqrt(Math.max(1,(RACE_F.curveLateral+(H.adj["力量"]-70)*0.008)/curvature))*bendCoefFor(H.h.special,dir):null};']
];
let diagnosticSource=source;
for(const [before,after]of patches){assert.equal(diagnosticSource.split(before).length-1,1,'Instrumentation anchor must be unique');diagnosticSource=diagnosticSource.replace(before,after);}
let reversed=diagnosticSource;for(const [before,after]of patches.slice().reverse())reversed=reversed.replace(after,before);assert.equal(reversed,source);
const S=api(diagnosticSource),Plain=api(source),clone=x=>JSON.parse(JSON.stringify(x)),coefficientHash=HASH(JSON.stringify(S.RACE_F));
const protocol={distances:[1200,2400],middleRequests:[14.5,16.5],checkpointRule:'Two start states, two identical first200 states, four history-dependent last600 entry states: eight actual60 Hz states, no interpolation before continuation.',
  startDelay:0,dt:DT,fieldSeed:2026100301,raceSeed:2026100302,
  horse:'One neutral70 horse: every attribute70, morale50, fatigue0,480 kg+57 kg, neutral physiology, behavior(.5,.5,.65).',
  route:'Flat standard course, wind0, left turn, fixed exact reference lane, no opponents, AI, draft or lateral movement.',
  history:'Before200 m: request30 m/s. From200 m to last600 entry: constant14.5 or16.5 m/s. These controls are diagnostic, not production phases.',
  requests:['budget: nine bisections using current finishPlan and current reserve','maximum: request30 m/s, including infeasible forecasts'],
  additionalRequest:'At the four last600 entry states only, request14 m/s to check conservative recovery omission.',
  arms:['actual','freezeFutureGuts','freezeAccelerationReserve','freezeBoth'],
  freezeFutureGuts:'Keep guts/retention equal to checkpoint values after every execution tick. Oxygen kinetics, reserve accounting, work and constraints otherwise unchanged. This is a controlled artificial recurrence, never a production proposal.',
  freezeAccelerationReserve:'Only execution maximum-acceleration multiplier uses the checkpoint reserveFade. Supply, reserve power fade, energy accounting and fatigue evolve normally.',
  prediction:'Production finishPlan at40 m and5 m meshes; constant requested physical speed, current fixed lane. Infeasible forecast times are not promises and are analyzed separately.',
  first200Diagnostic:'Trace exposes the existing bounded/response trajectory constants without changing predictions; solve the exact stored trajectory at the physical arc to200 m. Gate reaction is set to0 in all paired arms, so this tests forecast integration only.',
  accounting:'Timed finish is interpolated within the last60 Hz frame; work and endpoint states include the whole frame. All continuations begin at identical complete checkpoint state. No global coefficient search or reality fit.',
  causalLimits:'Within-horse sensitivity is not an explanation of between-horse real field range. Freeze arms are interventions; interaction is reported rather than assigning both differences additively.'};
const horse=S.makeHorse(S.mulberry32(protocol.fieldSeed),{id:'causal-neutral70',name:'预测一致性受控马',level:70,physiology:S.neutralPhysiology(),behavior:{forwardness:.5,settle:.5,tractability:.65},surface:'草地',special:'左右皆可','斗志':50,'疲劳':0,bodyMass:480,carriedWeight:57,jockeyGrade:'普通'});
for(const key of Object.keys(horse.stats))horse.stats[key]=70;
const inputHash=HASH(JSON.stringify({protocol,horse})),startedAt=new Date().toISOString(),start=Date.now();
const checkpoints=[],histories=[],rows=[],failures=[];let totalFrames=0,simulations=0,maxWorkError=0,maxReserveError=0,maxUnpaid=0,maxLaneDeviation=0;
function fresh(A,length){const r=A.createRace([clone(horse)],{length,course:'标准',dir:'左回',surface:'草地',state:'良',profile:'平坦',wind:0,rng:A.mulberry32(protocol.raceSeed)}),H=r.race.horses[0],lane=r.race.geo.referenceLane;H.t=lane;H.targetT=lane;H.startDelay=0;H.control={targetV:30,targetT:lane};return{r,H,lane};}
function bodyState(H){const out=clone(H);delete out.diagnosticStep;delete out.diagnosticFixedAccelerationReserve;return out;}
function capture(r,H,lane,length,label,history){const state=bodyState(H),raceTime=r.race.t,sectionals=clone(r.race.sectionals);return{length,label,history,lane,raceTime,state,sectionals,stateHash:HASH(JSON.stringify({state,raceTime,sectionals,lane}))};}
function recordIntegrity(H,lane){assert([H.s,H.t,H.v,H.stamina,H.guts,H.retention,H.aerobicOutput].every(Number.isFinite));assert.equal(H.statsSummary.blockedSeconds,0);assert.equal(H.statsSummary.draftSeconds,0);maxWorkError=Math.max(maxWorkError,Math.abs(H.statsSummary.workUsed-H.statsSummary.aerobicUsed-H.statsSummary.energyUsed));maxReserveError=Math.max(maxReserveError,Math.abs(H.stamina-(H.staminaMax-H.statsSummary.energyUsed+H.statsSummary.recovered)));maxUnpaid=Math.max(maxUnpaid,H.statsSummary.unpaidWork);maxLaneDeviation=Math.max(maxLaneDeviation,Math.abs(H.t-lane));}
for(const length of protocol.distances)for(const middle of protocol.middleRequests){
  const {r,H,lane}=fresh(S,length);if(middle===protocol.middleRequests[0])checkpoints.push(capture(r,H,lane,length,'start','shared'));
  let first=false,last=false;
  while(!r.race.finished&&r.race.t<610){H.control={targetV:H.s<200?30:middle,targetT:lane};r.step(DT);totalFrames++;recordIntegrity(H,lane);
    if(!first&&H.s>=200){first=true;if(middle===protocol.middleRequests[0])checkpoints.push(capture(r,H,lane,length,'after200','shared'));}
    if(!last&&H.s>=length-600){last=true;checkpoints.push(capture(r,H,lane,length,'last600',middle));break;}}
  assert(first&&last,'History checkpoint missing');histories.push({length,middle,frames:r.race.traffic.steps,checkpointHash:checkpoints.at(-1).stateHash,entry:{time:r.race.t,s:H.s,v:H.v,reserve:H.stamina/H.staminaMax,retention:H.retention,aerobicOutput:H.aerobicOutput}});simulations++;
}
assert.equal(checkpoints.length,8);
function restore(A,cp){const x=fresh(A,cp.length);Object.assign(x.H,clone(cp.state));x.r.race.t=cp.raceTime;x.r.race.sectionals=clone(cp.sectionals);assert.equal(HASH(JSON.stringify({state:bodyState(x.H),raceTime:x.r.race.t,sectionals:x.r.race.sectionals,lane:x.lane})),cp.stateHash);return x;}
function budget(H){let lo=3,hi=H.maxV;for(let i=0;i<9;i++){const mid=(lo+hi)/2;if(H.finishPlan(mid,0,{reserve:H.stamina}).feasible)lo=mid;else hi=mid;}return lo;}
function predictedCrossing(plan,at,cp,geo){const segment=plan.segments.find(s=>s.from<=at&&s.to>=at);if(!segment)return null;const p=segment.diagnosticTrajectory,distance=S.laneArcDistance(segment.from,at,cp.lane,geo);
  const trajectory=t=>{if(p.boundedTime>0&&t<=p.boundedTime)return segment.fromV*t+p.sign*p.limit*t*t/2;const tail=t-p.boundedTime;return segment.fromV*p.boundedTime+p.sign*p.limit*p.boundedTime*p.boundedTime/2+p.target*tail+(p.boundedV-p.target)*p.response*(1-Math.exp(-tail/p.response));};
  let low=0,high=segment.time;for(let i=0;i<50;i++){const mid=(low+high)/2;if(trajectory(mid)<distance)low=mid;else high=mid;}return p.startTime+(low+high)/2;}
function execute(cp,request,arm,A=S,collectFrames=false){
  const {r,H,lane}=restore(A,cp),initial=bodyState(H),initialHash=cp.stateHash;H.control={targetV:request,targetT:lane};
  if(arm==='freezeAccelerationReserve'||arm==='freezeBoth')H.diagnosticFixedAccelerationReserve=Math.min(1,Math.max(0,H.stamina/H.staminaMax/S.RACE_F.reserveFade));
  const frozenGuts=H.guts,frozenRetention=H.retention;let frames=0,seconds=0,meanRequest=0,meanSpeed=0,energy=0,rec=0,minReserve=H.stamina/H.staminaMax,minRetention=H.retention;
  const binding={maxVelocitySeconds:0,steadyPowerSeconds:0,curveSeconds:0,kineticAccelerationSeconds:0,accelerationLimitSeconds:0,reserveFadeSeconds:0};const frameHashes=[];
  try{
  while(!r.race.finished&&r.race.t<610){const oldV=H.v,oldDraw=H.statsSummary.energyUsed,oldRecovery=H.statsSummary.recovered;r.step(DT);frames++;totalFrames++;recordIntegrity(H,lane);
    const d=H.diagnosticStep;
    if(d){if(d.maxVCap<=d.steadyPowerCap+1e-7&&(d.curveCap==null||d.maxVCap<=d.curveCap+1e-7)&&request>=d.cap-1e-7)binding.maxVelocitySeconds+=DT;
      if(d.steadyPowerCap<=d.maxVCap+1e-7&&(d.curveCap==null||d.steadyPowerCap<=d.curveCap+1e-7)&&request>=d.cap-1e-7)binding.steadyPowerSeconds+=DT;
      if(d.curveCap!=null&&d.curveCap<=Math.min(d.maxVCap,d.steadyPowerCap)+1e-7&&request>=d.cap-1e-7)binding.curveSeconds+=DT;
      if(d.kineticBudget<=d.maxA+1e-7&&H.accel>1e-7&&Math.abs(H.accel-d.kineticBudget)<1e-5)binding.kineticAccelerationSeconds+=DT;
      if(d.maxA<=d.kineticBudget+1e-7&&H.accel>1e-7&&Math.abs(H.accel-d.maxA)<1e-5)binding.accelerationLimitSeconds+=DT;
      if(d.reserveFade<1-1e-9)binding.reserveFadeSeconds+=DT;}
    energy+=H.statsSummary.energyUsed-oldDraw;rec+=H.statsSummary.recovered-oldRecovery;minReserve=Math.min(minReserve,H.stamina/H.staminaMax);minRetention=Math.min(minRetention,H.retention);
    seconds+=DT;meanSpeed+=(oldV+H.v)/2*DT;meanRequest+=request*DT;
    if(arm==='freezeFutureGuts'||arm==='freezeBoth'){H.guts=frozenGuts;H.retention=frozenRetention;}
    if(collectFrames)frameHashes.push(HASH(JSON.stringify(bodyState(H))));
  }
  assert(r.race.finished&&H.place===1&&!H.dnf&&Number.isFinite(H.time),'Continuation did not finish');
  simulations++;return{status:'complete',arm,inputStateHash:initialHash,request,frames,remainingSeconds:H.time-cp.raceTime,totalTime:H.time,first200:H.sectionals[0].time,final600:H.final3f,last200Difference:H.sectionals.at(-1).split-H.sectionals.at(-2).split,
    draw:energy,recovery:rec,netDraw:energy-rec,work:H.statsSummary.workUsed-initial.statsSummary.workUsed,aerobicUsed:H.statsSummary.aerobicUsed-initial.statsSummary.aerobicUsed,
    endpoint:{v:H.v,reserve:H.stamina/H.staminaMax,retention:H.retention,aerobicOutput:H.aerobicOutput},minReserve,minRetention,meanActualSpeed:meanSpeed/seconds,meanRequest:meanRequest/seconds,bindingSeconds:binding,ledgerBeyondTimedFinish:r.race.t-H.time,
    ...(collectFrames?{frameHashes}:{})};
  }catch(error){simulations++;const failure={status:'failed',arm,inputStateHash:initialHash,request,frames,error:String(error.stack||error),state:bodyState(H)};failures.push({checkpoint:cp.label,length:cp.length,history:cp.history,...failure});return failure;}
}
const instrumentationEquivalence=[];
for(const cp of checkpoints.filter(x=>x.label==='start')){const request=30,a=execute(cp,request,'actual',S,true),b=execute(cp,request,'actual',Plain,true);assert.equal(a.status,'complete');assert.equal(b.status,'complete');assert.deepEqual(a.frameHashes,b.frameHashes,'Instrumentation changed execution');instrumentationEquivalence.push({length:cp.length,frames:a.frames,allHorseFramesExact:true,totalTimeExact:a.totalTime===b.totalTime,frameDigest:HASH(JSON.stringify(a.frameHashes))});}
for(const cp of checkpoints){
  const {H,r:forecastRace}=restore(S,cp),requests=[{kind:'budget',v:budget(H)},{kind:'maximum',v:30}];if(cp.label==='last600')requests.push({kind:'recovery-check',v:14});
  for(const request of requests){const forecast40=H.finishPlan(request.v,0,{trace:true}),forecast5=H.finishPlan(request.v,0,{maxStep:5}),arms=request.kind==='recovery-check'?['actual','freezeFutureGuts']:protocol.arms;
    const outcomes=arms.map(arm=>execute(cp,request.v,arm));assert(outcomes.every(x=>x.inputStateHash===cp.stateHash));const find=arm=>outcomes.find(x=>x.arm===arm),actual=find('actual'),ff=find('freezeFutureGuts'),fa=find('freezeAccelerationReserve'),both=find('freezeBoth');
    const effects=actual.status==='complete'&&ff.status==='complete'?{futureGutsSeconds:actual.remainingSeconds-ff.remainingSeconds,futureGutsDraw:actual.draw-ff.draw,
      predictionSecondsError:forecast40.seconds-actual.remainingSeconds,predictionDrawError:forecast40.required-actual.draw,
      frozenGutsPredictionSecondsError:forecast40.seconds-ff.remainingSeconds,frozenGutsPredictionDrawError:forecast40.required-ff.draw,
      mesh5Minus40Seconds:forecast5.seconds-forecast40.seconds,mesh5Minus40Required:forecast5.required-forecast40.required,
      ...(fa?.status==='complete'&&both?.status==='complete'?{accelerationReserveSeconds:actual.remainingSeconds-fa.remainingSeconds,interactionSeconds:actual.remainingSeconds-ff.remainingSeconds-fa.remainingSeconds+both.remainingSeconds,bothFrozenPredictionSecondsError:forecast40.seconds-both.remainingSeconds}: {})}:null;
    rows.push({length:cp.length,checkpoint:cp.label,history:cp.history,checkpointTime:cp.raceTime,checkpointDistance:cp.state.s,stateHash:cp.stateHash,entry:{v:cp.state.v,reserve:cp.state.stamina/cp.state.staminaMax,retention:cp.state.retention,aerobicOutput:cp.state.aerobicOutput},request:request.kind,requestedSpeed:request.v,forecast40,forecast5,outcomes,effects,
      ...(cp.label==='start'?{first200Diagnostic:{predictedSeconds:predictedCrossing(forecast40,200,cp,forecastRace.race.geo),actualSeconds:actual.first200,predictionMinusActual:predictedCrossing(forecast40,200,cp,forecastRace.race.geo)-actual.first200,gateDelayExcluded:true}}:{})});
  }
  console.log(JSON.stringify({completedCheckpoints:rows.filter(r=>r.stateHash===cp.stateHash).length,checkpoint:cp.label,length:cp.length,history:cp.history,simulations,elapsedSeconds:(Date.now()-start)/1000}));
}
const valid=rows.filter(x=>x.effects),feasible=valid.filter(x=>x.forecast40.feasible&&x.request==='budget'),maximum=valid.filter(x=>x.request==='maximum'),range=arr=>({n:arr.length,median:q(arr),min:q(arr,0),max:q(arr,1)});
const aggregate=rs=>({n:rs.length,predictionSecondsError:range(rs.map(x=>x.effects.predictionSecondsError)),futureGutsSeconds:range(rs.map(x=>x.effects.futureGutsSeconds)),frozenGutsPredictionSecondsError:range(rs.map(x=>x.effects.frozenGutsPredictionSecondsError)),mesh5Minus40Seconds:range(rs.map(x=>x.effects.mesh5Minus40Seconds)),predictionDrawError:range(rs.map(x=>x.effects.predictionDrawError)),accelerationReserveSeconds:range(rs.map(x=>x.effects.accelerationReserveSeconds).filter(Number.isFinite))});
const integrity={complete:rows.length===20,allContinuationsComplete:failures.length===0,sourceUnchanged:HASH(fs.readFileSync(sourcePath,'utf8'))===engineHash,coefficientsUnchanged:HASH(JSON.stringify(S.RACE_F))===coefficientHash,exactInstrumentationInverse:reversed===source,instrumentationEquivalence,inputStatesPaired:true,maxWorkError,maxReserveError,maxUnpaid,maxLaneDeviation,allFinite:true};
const report={engineHash,diagnosticSourceHash:HASH(diagnosticSource),sourceArtifact:'sim.js',startedAt,elapsedSeconds:(Date.now()-start)/1000,inputHash,coefficientHash,protocol,patches,simulations,totalFrames,integrity,summary:{feasibleBudget:aggregate(feasible),maximumRequest:aggregate(maximum),byCheckpoint:protocol.distances.flatMap(length=>['start','after200','last600'].map(checkpoint=>({length,checkpoint,...aggregate(valid.filter(x=>x.length===length&&x.checkpoint===checkpoint&&x.request==='budget'))})))},histories,checkpoints,rows,failures};
fs.writeFileSync(path.join(ROOT,'docs/causal-prediction-physiology-v10.json'),JSON.stringify(report,null,2)+'\n');
const f=(x,n=3)=>Number.isFinite(x)?x.toFixed(n):'—';
const md=['# 骑手余程预测与实际生理执行：受控因果诊断','',`生产源 SHA256：\`${engineHash}\`；预先固定输入 SHA256：\`${inputHash}\`。${simulations} 次单马执行，${totalFrames} 帧；关闭 AI、对手、横移、尾流和风，保持同马、同路线、同 RNG。生产文件及全局系数没有修改。`,'',
  '40米预测冻结当前疲劳、车道与加速储备；实际执行随未来体力改变供能、最大速度与储备功率。本实验保持固定请求，分别冻结未来 guts、仅冻结加速储备因子，以及同时冻结两者。冻结操作只存在诊断运行内，并不是建议游戏删除疲劳。5米网格检查属于预测器离散误差检查。最大请求的不可行预测不会当成骑手可执行承诺。',
  '', '## 每个配对的余程结果','', '|距离|检查点|先前中段请求|未来请求|预测可行|预测−实际／秒|未来 guts 衰减造成／秒|冻结 guts 后预测−实际／秒|仅冻结加速储备的效果／秒|5米−40米预测／秒|', '|---:|---|---:|---|---|---:|---:|---:|---:|---:|'];
for(const r of rows)md.push(`|${r.length}|${r.checkpoint}|${r.history}|${r.request} ${f(r.requestedSpeed)}|${r.forecast40.feasible?'是':'否'}|${f(r.effects?.predictionSecondsError)}|${f(r.effects?.futureGutsSeconds)}|${f(r.effects?.frozenGutsPredictionSecondsError)}|${f(r.effects?.accelerationReserveSeconds)}|${f(r.effects?.mesh5Minus40Seconds,5)}|`);
md.push('', '## 解释边界', '',
  '预测时间比实际短，可能包含被冻结的未来衰减、未在预测轨迹内执行的瞬时功率限制、储备衰减、恢复遗漏，以及预测和执行的积分方法差异。未来 guts 的因果效果用实际减冻结 guts 的配对秒差估计；它不能自动解释剩余误差，两个冻结操作存在交互。储备不足时的最大请求被预测标为不可行，其时间本来只是假设需求轨迹，不应将全部误差归为错误承诺。',
  '', '本实验没有把同一匹马的末600米变化等同于现实异质马群极差，也没有检验体力变量对应真实代谢或疲劳阈值。若自然骑手需求缺少波动，已有生理历史响应也不会凭空产生真实比赛节奏；如果执行普遍被同一个速度上限绑定，提高可用储备功率未必会改变速度。JSON 保存每个续跑的上限绑定时长、功率和储备账目，以便区别这两类原因。',
  '', `完整结果：[causal-prediction-physiology-v10.json](causal-prediction-physiology-v10.json)。原始错误样本 ${failures.length} 个，全部保留；当前文件 hash、全局系数、同输入帧一致性与账目误差列于 integrity。`, '', '复现：`node tests/causal-prediction-physiology-v10.js`。', '');
const low=rows.find(x=>x.length===2400&&x.checkpoint==='last600'&&x.history===14.5&&x.request==='maximum'),high=rows.find(x=>x.length===2400&&x.checkpoint==='last600'&&x.history===16.5&&x.request==='maximum');
md.push('## 目前可以判别的原因','',
  `1. **预测机制不一致，证据充分，量级有限。** 8个预测可行的预算请求，预测余程时间误差为 ${f(report.summary.feasibleBudget.predictionSecondsError.min)} 至 ${f(report.summary.feasibleBudget.predictionSecondsError.max)} 秒；冻结未来 guts 后为 ${f(report.summary.feasibleBudget.frozenGutsPredictionSecondsError.min)} 至 ${f(report.summary.feasibleBudget.frozenGutsPredictionSecondsError.max)} 秒。未来体力衰减确实应进入骑手预算，但本实验不能把它独自归因为群体完赛差扩大到数秒。最大请求的大幅误差主要出现于已标不可行的需求轨迹。`,
  '', `2. **预测网格和加速储备冻结不是这些平坦受控条件的主要误差。** 可行请求的5米−40米预测时间最大绝对差 ${f(Math.max(...feasible.map(x=>Math.abs(x.effects.mesh5Minus40Seconds))),5)} 秒；仅冻结加速储备的全部配对时间差为0。这是本样本的排除性证据，不能扩展到真实坡段、动态横移与拥挤路线。`,
  '', `从闸口关闭反应延迟后，预算请求的预测首200米比执行快 ${rows.filter(x=>x.checkpoint==='start'&&x.request==='budget').map(x=>f(-x.first200Diagnostic.predictionMinusActual,4)).join('/')} 秒，最大请求为 ${rows.filter(x=>x.checkpoint==='start'&&x.request==='maximum').map(x=>f(-x.first200Diagnostic.predictionMinusActual,4)).join('/')} 秒（依次1200/2400米）。这支持起步段存在小幅连续轨迹与逐帧执行的积分差异，但它远小于现实起步指标约1秒的残差；这里没有改变最大加速、最高速度、响应时间或骑手预算选择来拟合现实。`,
  '', `3. **已有生理状态有产生末段分化与临末衰速的能力。** 同一匹马2400米、末600米同样请求30 m/s，先前中段14.5/16.5 m/s 后的末600米为 ${f(low.outcomes[0].final600)}/${f(high.outcomes[0].final600)} 秒，末200米减前200米为 +${f(low.outcomes[0].last200Difference)}/+${f(high.outcomes[0].last200Difference)} 秒。进入末600米的储备分别为 ${f(100*low.entry.reserve,4)}%/${f(100*high.entry.reserve,4)}%。早早耗尽的条件在整个末600米都被供能上限约束，反而在末200米几乎不再额外减速；晚耗尽的条件产生临末降速。这两条历史不是等预算对照，也不是现实马群的标定。`,
  '', '4. **不能靠降低末段能力上限直接制造所需节奏。** 如果请求低于当前上限，疲劳降低上限却不会改变实际速度。要先检查骑手需求是否产生争位、保存余力和发动时机的差异，以及既有执行约束是否在那些时刻真的绑定。这里将请求/速度上限/供能绑定分别保存，避免把“没有降速”误解为没有生理历史。',
  '', '5. **真实生理映射仍缺证据，不能排除参数或遗漏机制。** 当前氧供是向与 retention 相乘的能力做单指数趋近，体力只有累积消耗，储备功率以末10%容量线性衰减；这些都是待验证的结构假设。参考研究把推进力当作独立受限状态，并从少量追踪比赛反演个体供氧曲线；它没有给本游戏这组固定参数或草地群体比赛盖章。若要增加供氧变化、推进力控制状态或更多疲劳状态，应先用实测速度曲线检查现有状态无法同时解释哪些轨迹，而不是按官方末段长度增加固定衰减段。',
  '', '研究依据：[Mercier & Aftalion，2020，Optimal speed in Thoroughbred horse racing](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0235024)。论文的供氧曲线是模型识别结果，作者同时说明完整真实比赛中的供氧测量不足；不能把识别曲线当成直接测得的通用生理规律。',
  '', '建议顺序：先让预测器传播已有执行状态并明确不可行候选；再审查真实骑手需求和上限绑定；最后用独立速度轨迹识别供给、耗能和衰减尺度，只有现有状态无法解释时才引入新的生理状态。','');
fs.writeFileSync(path.join(ROOT,'docs/causal-prediction-physiology-v10.md'),md.join('\n'));
console.log(JSON.stringify({output:'docs/causal-prediction-physiology-v10.json',simulations,integrity,summary:report.summary},null,2));
assert(integrity.complete&&integrity.allContinuationsComplete&&integrity.sourceUnchanged&&integrity.coefficientsUnchanged&&maxWorkError<1e-6&&maxReserveError<1e-6&&maxUnpaid<1e-6&&maxLaneDeviation<1e-9,'Diagnostic integrity failed');
