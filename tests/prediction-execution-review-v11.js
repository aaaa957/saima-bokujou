#!/usr/bin/env node
'use strict';
// Read-only engineering review. Instruments a source snapshot in memory only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {api,HASH,DT}=require('./system-reality-v9'),ROOT=path.resolve(__dirname,'..'),sourceFile=process.argv[2]?path.resolve(ROOT,process.argv[2]):path.join(ROOT,'sim.js');
const readSource=p=>(p.endsWith('.gz')?require('node:zlib').gunzipSync(fs.readFileSync(p)).toString('utf8'):fs.readFileSync(p,'utf8')).replace(/\r\n/g,'\n');
const source=readSource(sourceFile);
const output=path.join(ROOT,'docs/prediction-execution-review-v11.json');
if(fs.existsSync(output)){const raw=fs.readFileSync(output,'utf8'),dir=path.join(ROOT,'docs/prediction-execution-review-v11-history');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,HASH(raw)+'.json'),raw);}
const forecastAnchor=source.includes('        const forecast=H.projectActions(requests,options);')?'        const forecast=H.projectActions(requests,options);':'        const forecast=H.projectActions(requests,{...options,maxDt});';
const replacements=[
  ['    function projectActions(H,actions,options={}) {','    function projectActions(H,actions,options={}) {\n      reviewProjectionCalls++;'],
  ['      return H;\n    }); race.horses=horses;','      return H;\n    }); race.horses=horses;\n    let reviewProjectionCalls=0;'],
  [forecastAnchor,forecastAnchor+'\n        if(H.reviewForecasts)H.reviewForecasts.push({mode,requests:JSON.parse(JSON.stringify(requests)),forecast});'],
  ['      const viable=candidates.filter(c=>Number.isFinite(c.score));','      if(H.reviewCandidates)H.reviewCandidates.push(...candidates.map(c=>({mode:c.mode,actions:c.actions,forecast:c.forecast,score:c.score,conflict:c.conflict})));\n      const viable=candidates.filter(c=>Number.isFinite(c.score));'],
  ['    return {race,step,snapshot,state:snapshot};','    return {race,step,snapshot,state:snapshot,review:{runAI,applyRiderSequence,observedPosition,budgetSpeed,projectionCalls:()=>reviewProjectionCalls}};'],
];
let instrumented=source;for(const [before,after] of replacements){assert.equal(instrumented.split(before).length-1,1,'Unique review anchor');instrumented=instrumented.replace(before,after);}
let inverse=instrumented;for(const [before,after]of replacements.slice().reverse())inverse=inverse.replace(after,before);assert.equal(inverse,source);
const S=api(instrumented),Plain=api(source),clone=x=>JSON.parse(JSON.stringify(x));
const wakeInjection='        if(requests[0].leader===undefined)requests[0].leader=wake?visible(wake):null;\n';
const withoutInjection=instrumented.replace(wakeInjection,'');
const Legacy=withoutInjection===instrumented?S:api(withoutInjection);
const protocol={race:{length:2400,course:'标准',surface:'草地',state:'良',profile:'平坦',wind:0},rng:'constant0.5',
  horse:'Neutral70,480kg+57kg, no morale/fatigue modifiers; tractability.65; position/risk/patience.5/.5/.7; excellent jockey.',
  cases:'Two constructed stable horses8m apart in one lane; fixed controls for execution. No natural population inference.',
  scope:'Readonly source snapshot instrumentation; no changes to physics/controller/fixtures. Goals and cache suggestions evaluated at exact same state; no parameter search.',
  leaderMeaning:'Omitted leader inherits within one projectActions call; explicit null clears. New calls start with no inherited observation.'};
const report={startedAt:new Date().toISOString(),sourceArtifact:path.relative(ROOT,sourceFile),engineHash:HASH(source),instrumentedHash:HASH(instrumented),testSourceHash:HASH(fs.readFileSync(__filename,'utf8')),protocol,executions:0,frames:0,forecasts:0,
  findings:[],dtEvidence:[],microbenchmarks:[],failures:[],exactInverse:true};
report.wakeAblation={sourceHash:HASH(withoutInjection),removedExactLine:withoutInjection===instrumented?null:wakeInjection,
  meaning:'Single-line ablation reconstructs the pre-fix omission semantics while retaining all other frozen source logic. Counterexamples below use this diagnostic arm; current source regression checks are separately identified.'};
const begun=performance.now(),horse=S.makeHorse(()=>.5,{id:'review-a',level:70,physiology:S.neutralPhysiology(),behavior:{forwardness:.5,settle:.5,tractability:.65},racePlan:{position:.5,risk:.5,patience:.7},surface:'草地',special:'左右皆可','斗志':50,'疲劳':0,bodyMass:480,carriedWeight:57,jockeyGrade:'优秀'});
const reviewRaces=[];
for(const k of Object.keys(horse.stats))horse.stats[k]=70;
report.inputHash=HASH(JSON.stringify({protocol,horse}));
function pair(A=S,options={}){const field=[clone(horse),{...clone(horse),id:'review-b'}],r=A.createRace(field,{...protocol.race,...options,rng:()=>.5}),[H,F]=r.race.horses;if(r.review)reviewRaces.push(r);
  r.race.t=30;for(const [i,h]of [H,F].entries()){Object.assign(h,{s:200+i*8,t:10,targetT:10,startDelay:0,v:16,prevV:16,accel:0,startSettled:true,lastObserve:0});h.stamina=1300;h.aerobicOutput=h.aerobic;h.control={targetV:16,targetT:10};}
  const planned=r.review?r.review.budgetSpeed(H,H.stamina*.975,0):16;for(const h of [H,F]){h.v=planned;h.prevV=planned;h.control.targetV=planned;}return {r,H,F,planned};}
function state(h){return Object.fromEntries(['s','t','v','stamina','guts','retention','aerobicOutput'].map(k=>[k,h[k]]));}
function snapshot(x){return {H:clone(x.H),F:clone(x.F),time:x.r.race.t};}
function replay(cp,actions,A=S){const x=pair(A);Object.assign(x.H,clone(cp.H));Object.assign(x.F,clone(cp.F));x.r.race.t=cp.time;
  let frames=0;const initial=clone(x.H.statsSummary);try{for(const action of actions){const count=Math.round(action.duration/DT);x.H.control={targetV:action.targetV,targetT:action.targetT};
    for(let i=0;i<count&&!x.r.race.finished;i++){x.r.step(DT);frames++;report.frames++;}}
    report.executions++;return {status:'complete',frames,endpoint:state(x.H),draftSeconds:x.H.statsSummary.draftSeconds-initial.draftSeconds,
      energy:x.H.statsSummary.energyUsed-initial.energyUsed,recovered:x.H.statsSummary.recovered-initial.recovered,work:x.H.statsSummary.workUsed-initial.workUsed,
      blockedSeconds:x.H.statsSummary.blockedSeconds-initial.blockedSeconds};
  }catch(error){report.executions++;const fail={status:'failed',frames,error:String(error.stack||error),endpoint:state(x.H)};report.failures.push(fail);return fail;}}
function observe(F){return {s:F.s,t:F.t,v:F.v,accel:F.accel,bodyWidth:.65+.15*F.adj['体格']/100};}
function project(H,actions,opts={}){report.forecasts++;return H.projectActions(actions,opts);}
function evidence(name,run){try{report.findings.push({name,status:'observed',...run()});}catch(error){const f={name,status:'failed',error:String(error.stack||error)};report.failures.push(f);report.findings.push(f);}}
evidence('Pre-fix wake omission: same request automatically drafts in execution',()=>{const x=pair(Legacy),cp=snapshot(x);delete x.H.control;x.H.reviewForecasts=[];x.H.reviewCandidates=[];x.r.review.runAI(x.H);
  const captured=x.H.reviewForecasts.find(p=>p.mode==='settle');assert(captured,'Settled baseline capture');
  const baseline=project(x.H,captured.requests,{maxDt:DT,trace:true}),withVisible=project(x.H,captured.requests.map((a,i)=>({...a,...(i===0?{leader:observe(x.F)}:{leader:undefined})})),{maxDt:DT,trace:true});
  const actual=replay(cp,captured.requests);assert.equal(actual.status,'complete');assert.equal(actual.blockedSeconds,0);assert(actual.draftSeconds>10);assert.equal(baseline.limits.draftingSeconds,0);assert(baseline.ledger.energyUsed>actual.energy+1);
  const delta=Object.fromEntries(Object.keys(actual.endpoint).map(k=>[k,withVisible.endpoint[k]-actual.endpoint[k]]));assert(Object.values(delta).every(v=>Math.abs(v)<1e-6));
  return {kind:'counterexample',inputStateHash:HASH(JSON.stringify(cp)),planned:x.planned,requests:captured.requests,baseline:{energy:baseline.ledger.energyUsed,draftSeconds:baseline.limits.draftingSeconds,endpoint:baseline.endpoint},
    observedWake:{energy:withVisible.ledger.energyUsed,draftSeconds:withVisible.limits.draftingSeconds,endpoint:withVisible.endpoint},actual,observedMinusActual:delta,
    baselineExcessEnergy:baseline.ledger.energyUsed-actual.energy,causalBoundary:'Pre-fix omission reproduced by the declared one-line ablation. It does not prove a natural follow decision, real field effect, or that every future wake persists.'};});
evidence('Pre-fix re-observation starting in catch loses inherited leader',()=>{const x=pair(Legacy),cp=snapshot(x),leader=observe(x.F);delete x.H.control;
  const first={duration:4,targetV:x.planned-.1,targetT:x.H.t,leader},catchAction={duration:4,targetV:x.planned+.1,targetT:x.H.t};
  x.H.riderSequence={at:x.r.race.t-4,mode:'follow',stage:0,actions:[first,catchAction],goal:{s:x.H.s+x.planned*4-.2,tolerance:.12}};x.H.reviewForecasts=[];x.r.review.runAI(x.H);
  const continuation=x.H.reviewForecasts.find(p=>p.mode==='follow');assert(continuation);assert(!Object.hasOwn(continuation.requests[0],'leader'));assert.equal(continuation.forecast.limits.draftingSeconds,0);
  const noLeader=project(x.H,continuation.requests,{maxDt:DT}),visible=project(x.H,continuation.requests.map((a,i)=>({...a,...(i===0?{leader:observe(x.F)}:{leader:undefined})})),{maxDt:DT}),actual=replay(cp,continuation.requests);
  assert.equal(actual.status,'complete');assert(actual.draftSeconds>0);assert(noLeader.ledger.energyUsed>actual.energy+1);
  return {kind:'counterexample',inputStateHash:HASH(JSON.stringify(cp)),continuationAccepted:!!x.H.planning?.continuation,requests:continuation.requests,
    noLeaderEnergy:noLeader.ledger.energyUsed,observedLeaderEnergy:visible.ledger.energyUsed,actual,energyOverestimate:noLeader.ledger.energyUsed-actual.energy,
    boundary:'Original omitted catch leader inherits within the original follow+catch call. A new continuation call has an empty observation map, so omission cannot inherit the prior call. Conservative energy bias; cancellation is not established by this case.'};});
evidence('Current continuation handling of explicit null',()=>{const x=pair(),leader=observe(x.F);delete x.H.control;
  x.H.riderSequence={at:x.r.race.t,mode:'follow',stage:0,actions:[{duration:2,targetV:x.planned,targetT:x.H.t,leader},{duration:2,targetV:x.planned,targetT:x.H.t,leader:null}],goal:null};
  x.H.reviewForecasts=[];x.r.review.runAI(x.H);const found=x.H.reviewForecasts.find(p=>p.mode==='follow');assert(found);const erased=!Object.hasOwn(found.requests[1],'leader');
  const restored=project(x.H,found.requests.map((a,i)=>i===1?{...a,leader:null}:a),{maxDt:DT});
  return {kind:erased?'latent-api-edge-case':'fix-validated',explicitNullErased:erased,capturedRequests:found.requests,actualContinuationForecastDraft:found.forecast.limits.draftingSeconds,explicitNullForecastDraft:restored.limits.draftingSeconds,
    productionReachability:'Current generator stores follow and omitted-leader catch only; appended leader:null settle is forecast-only. This explicit-null riderSequence is constructed, not a demonstrated natural sequence.'};});
evidence('Current baseline and catch first action observe existing wake',()=>{const x=pair();delete x.H.control;x.H.reviewForecasts=[];x.r.review.runAI(x.H);const baseline=x.H.reviewForecasts.find(p=>p.mode==='settle');
  assert(baseline);assert(baseline.requests[0].leader,'Existing visible wake must be supplied on the first action');
  x.H.riderSequence={at:x.r.race.t-4,mode:'follow',stage:0,actions:[{duration:4,targetV:x.planned,targetT:x.H.t,leader:observe(x.F)},{duration:4,targetV:x.planned,targetT:x.H.t}],goal:null};
  x.H.reviewForecasts=[];x.r.review.runAI(x.H);const continuation=x.H.reviewForecasts.find(p=>p.mode==='follow');assert(continuation?.requests[0].leader);
  return {kind:'fix-validated',baselineDraftSeconds:baseline.forecast.limits.draftingSeconds,catchDraftSeconds:continuation.forecast.limits.draftingSeconds,
    boundary:'First finite action now receives the current observable wake, including when entering catch. The appended null settle tail remains a conservative forecast assumption; not a committed action.'};});
evidence('Forecast-only settle tail is not committed by riderSequence',()=>{const x=pair();delete x.H.control;x.H.reviewForecasts=[];x.H.reviewCandidates=[];x.r.review.runAI(x.H);
  const follow=x.H.reviewForecasts.find(f=>f.mode==='follow'),candidate=x.H.reviewCandidates.find(c=>c.mode==='follow');
  if(!follow)return {kind:'source-invariant',followGenerated:false,code:'evaluate appends settle requests; returns original actions; committed riderSequence stores chosen.actions'};
  return {kind:'source-invariant',followGenerated:true,forecastDurations:follow.requests.map(a=>a.duration),forecastLeaders:follow.requests.map(a=>a.leader===null?'null':a.leader?'observed':'omitted'),
    storedCandidateDurations:candidate?.actions.map(a=>a.duration)||null,committedSequenceDurations:x.H.riderSequence?.actions.map(a=>a.duration)||null,
    boundary:'Model predictive control may legitimately assume a settle tail before replanning. Scoring that tail is not a guarantee it will be executed, and should not be described as a committed3-stage sequence.'};});
evidence('Continuation settle lane follows the final intended route',()=>{const x=pair();delete x.H.control;
  x.H.riderSequence={at:x.r.race.t,mode:'wait-route',stage:0,actions:[{duration:2,targetV:x.planned-.3,targetT:10},{duration:4,targetV:x.planned,targetT:8}],goal:null};
  x.H.reviewForecasts=[];x.r.review.runAI(x.H);const continuation=x.H.reviewForecasts.find(p=>p.mode==='wait-route');assert(continuation);
  const finalRoute=continuation.requests.at(-2).targetT,settleRoute=continuation.requests.at(-1).targetT,misaligned=settleRoute!==finalRoute;
  return {kind:misaligned?'counterexample':'fix-validated',requests:continuation.requests,finalRoute,settleRoute,misaligned,
    boundary:'A remaining early stage in the original continuation passed its first lane to evaluate, although the later action ended on another lane. This invented a return to the earlier lane in the forecast-only settle tail; it did not prove actual execution moved back.'};});
evidence('Physical collision-free forecast versus executed headway limits',()=>{const x=pair();for(const h of [x.H,x.F]){h.v=16;h.prevV=16;h.control={targetV:16,targetT:10};}const cp=snapshot(x);
  const actions=[{duration:3,targetV:18,targetT:10,leader:observe(x.F)}],prediction=project(x.H,actions,{maxDt:DT});
  const goal={s:prediction.endpoint.s-.05,tolerance:.02},promise=project(x.H,actions,{maxDt:DT,goal}),actual=replay(cp,actions);assert.equal(actual.status,'complete');
  const actualGoalReached=actual.endpoint.s>=goal.s-goal.tolerance,distanceError=prediction.endpoint.s-actual.endpoint.s;
  return {kind:!prediction.pathConflict&&promise.goalReached&&!actualGoalReached?'counterexample':'fix-validated',inputHash:HASH(JSON.stringify(cp)),actions,goal,
    prediction:{s:prediction.endpoint.s,v:prediction.endpoint.v,energy:prediction.ledger.energyUsed,pathConflict:prediction.pathConflict,goalReached:promise.goalReached,trafficCertified:prediction.trafficCertified},
    actual,actualGoalReached,distanceError,
    boundary:'A controlled two-horse witness. Actual front cap and response/stopping headway can bind before geometric collision. The projection explicitly is not a traffic certificate, but a controller cannot turn its collision-free physical endpoint into an executed catch guarantee without those limits. Natural selection/avoidBlock behavior is not inferred.'};});
// Controlled single-body dt evidence uses the identical physical state and controls.
const dtCases=[{name:'gate',s:0,v:0,oxygen:.45,request:17,side:0},{name:'settled',s:200,v:16,oxygen:1,request:17,side:0},
  {name:'low-reserve',s:400,v:17,oxygen:1,request:18.5,side:0,reserve:40},
  {name:'lateral',s:200,v:12,oxygen:.6,request:17,side:2},{name:'hill',s:1770,v:15,oxygen:.85,request:18,side:0,course:'中山',length:2000}];
for(const c of dtCases){const r=S.createRace([clone(horse)],{...protocol.race,course:c.course||'标准',length:c.length||2400,rng:()=>.5}),H=r.race.horses[0];reviewRaces.push(r);
  r.race.t=c.s?30:0;Object.assign(H,{s:c.s,v:c.v,t:10,targetT:10,startDelay:c.s?0:.3});H.stamina=c.reserve??1300;H.aerobicOutput=H.aerobic*c.oxygen;
  const actions=[{duration:4,targetV:c.request-.5,targetT:10+c.side},{duration:4,targetV:c.request+.5,targetT:10+c.side},{duration:2.8,targetV:16,targetT:10+c.side,leader:null}];
  const reference=project(H,actions,{maxDt:DT});for(const dt of [.06,.12,.24]){const p=project(H,actions,{maxDt:dt}),row={case:c.name,inputHash:HASH(JSON.stringify({state:state(H),actions,geo:r.race.geo})),dt,
    distanceError:p.endpoint.s-reference.endpoint.s,velocityError:p.endpoint.v-reference.endpoint.v,reserveError:p.endpoint.stamina-reference.endpoint.stamina,
    gutsError:p.endpoint.guts-reference.endpoint.guts,netEnergyError:(p.ledger.energyUsed-p.ledger.recovered)-(reference.ledger.energyUsed-reference.ledger.recovered),steps:p.steps,referenceSteps:reference.steps};report.dtEvidence.push(row);}
  if(c.name==='gate'){const goal={s:reference.endpoint.s+.25,tolerance:.12},fine=project(H,actions,{maxDt:DT,goal}),coarse=project(H,actions,{maxDt:.12,goal});
    report.goalPrecisionWitness={kind:'constructed-discretization-witness',goal,fineReached:fine.goalReached,coarseReached:coarse.goalReached,fineS:fine.endpoint.s,coarseS:coarse.endpoint.s,
      boundary:'Prescribed exploratory endpoint target demonstrates classification can change at a0.12m tolerance. It is not an observed naturally accepted rider plan.'};assert.equal(fine.goalReached,false);assert.equal(coarse.goalReached,true);}}
// Each benchmark repeats an unchanged state; memoization equivalence is exact,
// while cross-state caching is expressly excluded. No coarse result is substituted.
for(const length of [1200,2400]){const x=pair(S,{length}),H=x.H;const methods={budget:()=>x.r.review.budgetSpeed(H,H.stamina*.975,0),finite:()=>H.projectActions([{duration:8,targetV:H.v+.3,targetT:H.t},{duration:2.8,targetV:H.v,targetT:H.t,leader:null}],{maxDt:.12})};
  for(const [name,call]of Object.entries(methods)){for(let i=0;i<4;i++)call();const before=x.r.review.projectionCalls(),t=performance.now(),n=15;let result;
    for(let i=0;i<n;i++)result=call();const milliseconds=(performance.now()-t)/n,projections=x.r.review.projectionCalls()-before;
    const key=HASH(JSON.stringify({state:state(H),at:x.r.race.t,length,coefficients:S.RACE_F,geo:x.r.race.geo})),cache=new Map();let maxCachedResultError=0;
    const tCached=performance.now();for(let i=0;i<n;i++){if(!cache.has(key))cache.set(key,call());const item=cache.get(key);if(name==='budget')maxCachedResultError=Math.max(maxCachedResultError,Math.abs(item-result));else assert.deepEqual(item,result);}
    report.microbenchmarks.push({length,function:name,runs:n,meanMilliseconds:milliseconds,projectionQueries:projections,sameStateCacheMeanMilliseconds:(performance.now()-tCached)/n,maxCachedResultError,
      scope:'Warmed wall time with possible concurrent tasks. Same-state repeated inputs only; not a cross-observation production cache recommendation.'});}}
const instrumentControl=pair(S),plainControl=pair(Plain);const cp=snapshot(instrumentControl);Object.assign(plainControl.H,clone(cp.H));Object.assign(plainControl.F,clone(cp.F));plainControl.r.race.t=cp.time;
let maxPhysicalError=0;for(let i=0;i<60;i++){instrumentControl.r.step(DT);plainControl.r.step(DT);report.frames+=2;for(const k of Object.keys(state(instrumentControl.H)))maxPhysicalError=Math.max(maxPhysicalError,Math.abs(instrumentControl.H[k]-plainControl.H[k]));}
report.executions+=2;report.instrumentationControl={framesPerArm:60,maxPhysicalError,exact:maxPhysicalError===0};assert.equal(maxPhysicalError,0);
report.projectionQueriesTotal=reviewRaces.reduce((n,r)=>n+r.review.projectionCalls(),0);
report.sourceAtEndHash=HASH(readSource(sourceFile));report.sourceUnchanged=report.sourceAtEndHash===report.engineHash;report.elapsedSeconds=(performance.now()-begun)/1000;
report.summary={findings:report.findings.length,counterexamples:report.findings.filter(x=>x.kind==='counterexample').length,failures:report.failures.length,
  maxDt012DistanceError:Math.max(...report.dtEvidence.filter(x=>x.dt===.12).map(x=>Math.abs(x.distanceError))),maxDt012NetEnergyError:Math.max(...report.dtEvidence.filter(x=>x.dt===.12).map(x=>Math.abs(x.netEnergyError)))};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const md=['# v11 预测与动作执行：第二轮只读工程评审','',`源 SHA256：\`${report.engineHash}\`；输入 SHA256：\`${report.inputHash}\`。${report.executions} 次短期执行、${report.frames} 帧。生产及 controller fixture 均未修改；instrumentation 对照误差 ${maxPhysicalError}。`, '',
  '本检查使用构造场景，区分代码可达反例、潜在 API 边界和预测控制本来允许的假设；不把它们宣称为自然比赛的现实偏差根因。',''];
for(const finding of report.findings)md.push(`## ${finding.name}`,'',`类型：${finding.kind||finding.status}。`, '',finding.boundary||finding.causalBoundary||finding.productionReachability||'', '');
md.push('## 积分分辨率证据','', '|状态|dt/s|位置误差/m|速度误差/(m/s)|净储备耗能误差|', '|---|---:|---:|---:|---:|');
for(const row of report.dtEvidence)md.push(`|${row.case}|${row.dt}|${row.distanceError.toFixed(6)}|${row.velocityError.toFixed(6)}|${row.netEnergyError.toFixed(6)}|`);
md.push('', '不能仅为了 CPU 放宽有限预测步长。先用粗候选筛选，再对最终候选、接近追回目标或碰撞边界的候选以60Hz复核，能把精度集中在硬约束上。跨状态缓存必须纳入 race.t/startDelay、路线及风、供氧、储备、guts、速度、横位和可见对手信息；本报告只验证完全相同输入的缓存不会改变结果。', '',
  `生产开末源相同：${report.sourceUnchanged}；失败 ${report.failures.length} 个，全部保存。CPU 是热身墙钟小样本，可能受并行任务影响。`, '',
  '复现：`node tests/prediction-execution-review-v11.js`。完整输入、反例账目、dt误差和微基准见 [JSON](prediction-execution-review-v11.json)。', '');
fs.writeFileSync(path.join(ROOT,'docs/prediction-execution-review-v11.md'),md.join('\n'));
console.log(JSON.stringify({summary:report.summary,findings:report.findings.map(x=>({name:x.name,status:x.status,kind:x.kind,error:x.error,baselineExcessEnergy:x.baselineExcessEnergy,energyOverestimate:x.energyOverestimate})),microbenchmarks:report.microbenchmarks},null,2));
assert.equal(report.failures.length,0,'Review failure preserved in report');
