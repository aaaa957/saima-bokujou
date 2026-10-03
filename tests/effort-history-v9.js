#!/usr/bin/env node
'use strict';
// Prescribed request histories are diagnostic controls only. They never enter
// the production rider, and no physiological or movement coefficient changes.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {api,HASH,DT}=require('./system-reality-v9');
const {NUMERIC_HASH,archivePath}=require('./helpers/v9-numeric-snapshot');
const ROOT=path.resolve(__dirname,'..');
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);if(i<0)return fallback;if(!args[i+1])throw new Error(key+' requires a value');return args[i+1];};
const EXPECTED=option('--expected-hash',NUMERIC_HASH);
const sourcePath=path.resolve(ROOT,option('--source-archive',archivePath));
const readSource=()=>{const raw=fs.readFileSync(sourcePath);return(raw[0]===0x1f&&raw[1]===0x8b?zlib.gunzipSync(raw):raw).toString('utf8');};
const source=readSource(),engineHash=HASH(source);assert.equal(engineHash,EXPECTED,'Effort history diagnostic requires the declared immutable numeric snapshot');
if(args.includes('--check-source')){console.log(JSON.stringify({engineHash,sourceArtifact:sourcePath}));process.exit(0);}
const S=api(source),clone=x=>JSON.parse(JSON.stringify(x)),coefficientHash=HASH(JSON.stringify(S.RACE_F));
const protocol={dt:DT,distances:[1200,2400],baselineMiddleMeans:[14.5,16.5],amplitude:1.2,maximumRequest:30,
  first200Request:'Maximum request 30 m/s; not an assertion that the horse can run at30 m/s.',
  final600Request:'Identical maximum request30 m/s; actual speed is limited by existing execution states and caps.',
  middleRequest:'For x=(distance−200)/(length−800) inside200..length−600: constant mean, front-loaded mean+1.2*sin(2*pi*x), back-loaded mean−1.2*sin(2*pi*x).',
  diagnosticOnly:'Distance-prescribed controls are a controlled experiment, never production race phases or rider coefficients.',
  workMatching:{relativeTolerance:1e-4,meanRadius:0.6,gridIntervals:16,maximumBisections:16,
    rule:'Probe the declared local mean interval. Use the sign-changing adjacent interval nearest the baseline mean; verify quarter-point and all subsequent sampled monotonicity within the absolute work-matching tolerance. A nominal request already within tolerance needs a sampled monotone neighborhood. Preserve missing/nonmonotone brackets and unmatched outputs as failures.',
    limitation:'Finite sampled monotonicity is not a proof for every mean. Multiple brackets are reported; no global monotonicity or unique optimum is assumed.'},
  horse:'One fixed neutral70 synthetic horse; all attributes70, morale50, fatigue0, body480 kg, carried57 kg, ordinary rider, fixed behavior and neutral five-axis physiology.',
  route:'Flat standard course, wind0, left turn; initial and commanded lateral position remain the exact reference lane. Same geometry within each distance, no opponents, drafting or AI.',
  seeds:{field:2026100301,race:2026100302},
  accounting:'Match statsSummary.workUsed including the complete final60 Hz tick, as recorded by the engine. Official finish and600 m crossing times are interpolated inside the tick. Endpoint ledger/state therefore extends at most1/60 s beyond the timed finish. Report this excess separately.',
  oxygen:'Mechanical-equivalent aerobic supply integral and aerobicUsed are W/kg × s; they are not measured VO2. Supply integral includes the reaction interval because existing engine supply kinetics do.',
  stateSampling:'Entry states at200 m and last600 m are linearly interpolated between enclosing60 Hz states at the engine crossing time; physiological interpolation is diagnostic, not an extra execution substep.',
  controlTiming:'Requests update at the beginning of each60 Hz tick from the current distance. The tick crossing a request boundary retains its earlier request until the next tick; paired first200 times and the crossing state are checked/reported.',
  durations:'Reserve fractions≤0.10 and≤0.01 durations use linear within-step threshold crossings through the ledger endpoint. Recovery seconds count whole ticks with positive recovery. Final-request/actual means weight the part of each tick after last600 m entry.',
  causalLimits:'Equal whole-race mechanical work does not equal aerobic availability, anaerobic draw, reserve at last600 m entry, elapsed time, entry velocity or tactical optimum. Adjusting mean changes the request history as well as matching the budget. No measured real horse, field-selection or rider validation is claimed.'};
const horse=S.makeHorse(S.mulberry32(protocol.seeds.field),{id:'controlled-neutral70',name:'受控中性70马',level:70,
  physiology:S.neutralPhysiology(),behavior:{forwardness:.5,settle:.5,tractability:.65},surface:'草地',special:'左右皆可',
  '斗志':50,'疲劳':0,carriedWeight:57,bodyMass:480,jockeyGrade:'普通'});
for(const key of Object.keys(horse.stats))horse.stats[key]=70;
const startedAt=new Date().toISOString(),start=Date.now(),cache=new Map(),initialHashes=new Map();
let simulations=0,maxWorkError=0,maxReserveError=0,maxUnpaid=0,minAcceleration=0,maxLaneDeviation=0,first200Difference=0;
function state(H,time){return{time,distance:H.s,speed:H.v,reserve:H.stamina,reserveFraction:H.stamina/H.staminaMax,
  guts:H.guts,retention:H.retention,aerobicOutput:H.aerobicOutput,aerobicFraction:H.aerobicOutput/H.aerobic,
  work:H.statsSummary.workUsed,aerobicUsed:H.statsSummary.aerobicUsed,energyUsed:H.statsSummary.energyUsed,recovered:H.statsSummary.recovered};}
function interpolate(before,after,time,distance){const f=Math.max(0,Math.min(1,(time-before.time)/(after.time-before.time))),out={time,distance};
  for(const key of Object.keys(before))if(key!=='time'&&key!=='distance')out[key]=before[key]+(after[key]-before[key])*f;return out;}
function durationBelow(a,b,threshold){if(a<=threshold&&b<=threshold)return DT;if(a>threshold&&b>threshold)return 0;
  const crossing=Math.max(0,Math.min(1,(threshold-a)/(b-a)));return DT*(a<=threshold?crossing:1-crossing);}
function execute(length,shape,middleMean){
  const key=JSON.stringify([length,shape,middleMean]);if(cache.has(key))return cache.get(key);
  const r=S.createRace([clone(horse)],{length,course:'标准',dir:'左回',surface:'草地',state:'良',profile:'平坦',wind:0,rng:S.mulberry32(protocol.seeds.race)}),H=r.race.horses[0],lane=r.race.geo.referenceLane;
  H.t=lane;H.targetT=lane;
  const initial={horse:clone(H.h),startDelay:H.startDelay,aiBias:H.aiBias,gate:H.gate,lane,physiologicalParameters:{aerobic:H.aerobic,capacity:H.staminaMax,reservePower:H.reservePower,tau:H.aerobicTau,maxV:H.maxV},coefficientHash};
  const initialHash=HASH(JSON.stringify(initial));if(initialHashes.has(length))assert.equal(initialHash,initialHashes.get(length),'Start state changed between histories');else initialHashes.set(length,initialHash);
  let frames=0,oxygenSupply=0,reserveFadeSeconds=0,reserveAlmostEmptySeconds=0,recoverySeconds=0;
  let finalSeconds=0,finalTargetIntegral=0,finalSpeedIntegral=0,finalDesiredIntegral=0,finalMaxVIntegral=0;
  let entry200=null,entry600=null;
  while(!r.race.finished&&r.race.t<610){
    const before=state(H,r.race.t),x=(H.s-200)/(length-800);
    H.control={targetV:H.s<200||H.s>=length-600?protocol.maximumRequest:middleMean+shape*protocol.amplitude*Math.sin(2*Math.PI*x),targetT:lane};
    const requested=H.control.targetV;r.step(DT);frames++;
    const after=state(H,r.race.t);
    oxygenSupply+=H.aerobicOutput*DT;
    reserveFadeSeconds+=durationBelow(before.reserveFraction,after.reserveFraction,.10);
    reserveAlmostEmptySeconds+=durationBelow(before.reserveFraction,after.reserveFraction,.01);
    if(after.recovered-before.recovered>1e-10)recoverySeconds+=DT;
    if(!entry200&&H.sectionals.some(s=>s.distance===200))entry200=interpolate(before,after,H.sectionals.find(s=>s.distance===200).time,200);
    if(!entry600&&H.t600!=null)entry600=interpolate(before,after,H.t600,length-600);
    const finalPart=entry600?Math.max(0,r.race.t-Math.max(before.time,entry600.time)):0;
    finalSeconds+=finalPart;finalTargetIntegral+=requested*finalPart;finalSpeedIntegral+=(before.speed+after.speed)/2*finalPart;
    finalDesiredIntegral+=H.pot*finalPart;finalMaxVIntegral+=H.maxV*H.retention*finalPart;
    minAcceleration=Math.min(minAcceleration,H.accel);maxLaneDeviation=Math.max(maxLaneDeviation,Math.abs(H.t-lane));
    maxWorkError=Math.max(maxWorkError,Math.abs(H.statsSummary.workUsed-H.statsSummary.aerobicUsed-H.statsSummary.energyUsed));
    maxReserveError=Math.max(maxReserveError,Math.abs(H.stamina-(H.staminaMax-H.statsSummary.energyUsed+H.statsSummary.recovered)));
    maxUnpaid=Math.max(maxUnpaid,H.statsSummary.unpaidWork);
    assert([H.s,H.t,H.v,H.stamina,H.guts,H.retention,H.aerobicOutput].every(Number.isFinite),'Nonfinite solo execution');
  }
  assert(r.race.finished&&H.place===1&&!H.dnf&&Number.isFinite(H.time)&&entry200&&entry600,'Controlled solo did not finish');
  assert.equal(H.statsSummary.blockedSeconds,0);assert.equal(H.statsSummary.draftSeconds,0);assert.equal(H.sprintAt,null,'Rider AI was unexpectedly active');
  const sectionals=H.sectionals.map(s=>({distance:s.distance,time:s.time,split:s.split}));
  assert.equal(sectionals.length,length/200);assert.equal(sectionals.at(-1).time,H.time);
  const row={length,shape:shape===0?'constant':shape===1?'front-loaded':'back-loaded',middleMean,amplitude:shape===0?0:protocol.amplitude,frames,initialHash,initial,
    time:H.time,first200:entry200.time,preLast600Time:entry600.time,final600:H.final3f,last200Difference:sectionals.at(-1).split-sectionals.at(-2).split,sectionals,
    totalWork:H.statsSummary.workUsed,totalAerobicUsed:H.statsSummary.aerobicUsed,totalEnergyUsed:H.statsSummary.energyUsed,totalRecovered:H.statsSummary.recovered,oxygenSupply,
    reserveFadeSeconds,reserveAlmostEmptySeconds,recoverySeconds,entry200,entry600,ledgerEndpoint:state(H,r.race.t),ledgerAfterTimedFinishSeconds:r.race.t-H.time,
    final600RequestAndExecution:{ledgerSeconds:finalSeconds,meanRequested:finalTargetIntegral/finalSeconds,meanActual:finalSpeedIntegral/finalSeconds,meanFeasibleDesired:finalDesiredIntegral/finalSeconds,
      meanFatiguedMaxVelocity:finalMaxVIntegral/finalSeconds,requestedMinusActual:(finalTargetIntegral-finalSpeedIntegral)/finalSeconds,feasibleDesiredMinusActual:(finalDesiredIntegral-finalSpeedIntegral)/finalSeconds},
    workBalanceError:Math.abs(H.statsSummary.workUsed-H.statsSummary.aerobicUsed-H.statsSummary.energyUsed),reserveBalanceError:Math.abs(H.stamina-(H.staminaMax-H.statsSummary.energyUsed+H.statsSummary.recovered)),unpaidWork:H.statsSummary.unpaidWork};
  simulations++;cache.set(key,row);return row;
}
function probe(row,target){return{mean:row.middleMean,work:row.totalWork,error:row.totalWork-target,relativeError:(row.totalWork-target)/target,time:row.time,final600:row.final600,reserveAt600:row.entry600.reserveFraction};}
function monotonic(points,direction,tolerance){const sorted=points.slice().sort((a,b)=>a.mean-b.mean);return sorted.every((p,i)=>i===0||direction*(p.work-sorted[i-1].work)>=-tolerance);}
function matchWork(length,shape,baselineMean,reference){
  const target=reference.totalWork,tolerance=protocol.workMatching.relativeTolerance*target,probes=[];
  for(let i=0;i<=protocol.workMatching.gridIntervals;i++){const mean=baselineMean-protocol.workMatching.meanRadius+2*protocol.workMatching.meanRadius*i/protocol.workMatching.gridIntervals;probes.push(probe(execute(length,shape,mean),target));}
  const brackets=[];for(let i=0;i+1<probes.length;i++)if(probes[i].error*probes[i+1].error<=0)brackets.push([probes[i],probes[i+1]]);
  brackets.sort((a,b)=>Math.abs((a[0].mean+a[1].mean)/2-baselineMean)-Math.abs((b[0].mean+b[1].mean)/2-baselineMean));
  const nominal=execute(length,shape,baselineMean),closest=probes.reduce((a,b)=>Math.abs(b.error)<Math.abs(a.error)?b:a,probe(nominal,target));
  const output={targetWork:target,relativeTolerance:protocol.workMatching.relativeTolerance,absoluteTolerance:tolerance,
    searchMeanInterval:[baselineMean-protocol.workMatching.meanRadius,baselineMean+protocol.workMatching.meanRadius],probes,
    signChangingBrackets:brackets.map(b=>b.map(p=>p.mean)),globalSampledMonotonicIncreasing:monotonic(probes,1,tolerance),globalSampledMonotonicDecreasing:monotonic(probes,-1,tolerance),
    nominalRelativeError:(nominal.totalWork-target)/target,matched:false,closest};
  let selected=brackets[0];
  if(!selected&&Math.abs(closest.error)<=tolerance){
    const i=probes.findIndex(p=>p.mean===closest.mean);
    if(i>0&&i<probes.length-1)selected=[probes[i-1],probes[i+1]];
  }
  if(!selected)return{...output,status:'no-local-bracket-within-declared-mean-range'};
  const [a,b]=selected,direction=Math.sign(b.work-a.work);output.selectedMeanBracket=[a.mean,b.mean];output.monotonicDirection=direction;
  const local=[a,b];for(const f of [.25,.5,.75])local.push(probe(execute(length,shape,a.mean+(b.mean-a.mean)*f),target));
  output.localProbes=local;
  output.sampledBracketMonotonicWithinTolerance=direction!==0&&monotonic(local,direction,tolerance);
  output.sampledBracketStrictMonotonic=direction!==0&&monotonic(local,direction,1e-10);
  if(!output.sampledBracketMonotonicWithinTolerance)return{...output,status:'sampled-local-bracket-nonmonotone'};
  let best=local.reduce((p,q)=>Math.abs(q.error)<Math.abs(p.error)?q:p),lo=a.mean,hi=b.mean,iterations=0;
  while(Math.abs(best.error)>tolerance&&iterations<protocol.workMatching.maximumBisections){
    const mid=(lo+hi)/2,p=probe(execute(length,shape,mid),target);local.push(p);iterations++;
    if(Math.abs(p.error)<Math.abs(best.error))best=p;
    if(!monotonic(local,direction,tolerance))return{...output,status:'sampled-bisection-nonmonotone',bisections:iterations,closest:best,sampledBracketMonotonicWithinTolerance:false};
    if(p.error*direction<0)lo=mid;else hi=mid;
  }
  output.bisections=iterations;output.closest=best;
  output.sampledBracketStrictMonotonic=monotonic(local,direction,1e-10);
  if(Math.abs(best.error)>tolerance)return{...output,status:'work-residual-exceeds-tolerance'};
  return{...output,matched:true,status:'matched-with-sampled-local-monotonicity',adjustedMean:best.mean,relativeResidual:best.relativeError,result:execute(length,shape,best.mean)};
}
const rows=[];
for(const length of protocol.distances)for(const mean of protocol.baselineMiddleMeans){
  const reference=execute(length,0,mean),histories=[];
  for(const shape of [1,-1]){
    const nominal=execute(length,shape,mean),matching=matchWork(length,shape,mean,reference);
    first200Difference=Math.max(first200Difference,Math.abs(nominal.first200-reference.first200));
    if(matching.result)first200Difference=Math.max(first200Difference,Math.abs(matching.result.first200-reference.first200));
    const differences=r=>({time:r.time-reference.time,preLast600Time:r.preLast600Time-reference.preLast600Time,final600:r.final600-reference.final600,
      last200Difference:r.last200Difference-reference.last200Difference,entryReserveFraction:r.entry600.reserveFraction-reference.entry600.reserveFraction,
      entryRetention:r.entry600.retention-reference.entry600.retention,entryAerobicOutput:r.entry600.aerobicOutput-reference.entry600.aerobicOutput,entrySpeed:r.entry600.speed-reference.entry600.speed});
    histories.push({shape:nominal.shape,nominal,nominalMinusConstant:differences(nominal),matching,
      ...(matching.matched?{equalWorkMinusConstant:differences(matching.result)}:{})});
  }
  rows.push({length,baselineMean:mean,reference,histories});
  console.log(JSON.stringify({measuredRegimes:rows.length,totalRegimes:protocol.distances.length*protocol.baselineMiddleMeans.length,length,baselineMean:mean,
    matches:histories.map(h=>({shape:h.shape,status:h.matching.status,relativeResidual:h.matching.relativeResidual??h.matching.closest.relativeError,final600Difference:h.equalWorkMinusConstant?.final600??null})),simulations,elapsedSeconds:(Date.now()-start)/1000}));
}
const histories=rows.flatMap(r=>r.histories),successful=histories.filter(h=>h.matching.matched);
const sourceUnchanged=HASH(readSource())===engineHash,coefficientsUnchanged=HASH(JSON.stringify(S.RACE_F))===coefficientHash;
const integrity={complete:rows.length===4&&histories.length===8,sourceUnchanged,coefficientsUnchanged,identicalInitialStates:initialHashes.size===2,
  allFinite:true,noAIOrDraftOrTraffic:true,maxLaneDeviation,first200Difference,maxWorkError,maxReserveError,maxUnpaid,minAcceleration,
  matchedHistories:successful.length,declaredHistories:histories.length,allEqualWorkMatchesSucceeded:successful.length===histories.length,
  maximumSuccessfulRelativeWorkResidual:Math.max(0,...successful.map(h=>Math.abs(h.matching.relativeResidual)))};
const summary={matchedCases:successful.map(h=>({length:h.nominal.length,baselineMean:rows.find(r=>r.histories.includes(h)).baselineMean,shape:h.shape,adjustedMean:h.matching.adjustedMean,relativeWorkResidual:h.matching.relativeResidual,...h.equalWorkMinusConstant})),
  unsuccessfulCases:histories.filter(h=>!h.matching.matched).map(h=>({length:h.nominal.length,baselineMean:h.nominal.middleMean,shape:h.shape,status:h.matching.status,closest:h.matching.closest})),
  nominalSensitivity:rows.map(r=>({length:r.length,baselineMean:r.baselineMean,constantFinal600:r.reference.final600,constantLast200Difference:r.reference.last200Difference,
    frontMinusConstant:r.histories[0].nominalMinusConstant,backMinusConstant:r.histories[1].nominalMinusConstant}))};
const report={engineHash,sourceArtifact:path.relative(ROOT,sourcePath),startedAt,elapsedSeconds:(Date.now()-start)/1000,protocol,simulations,integrity,summary,rows};
assert(sourceUnchanged&&coefficientsUnchanged&&integrity.complete&&maxLaneDeviation<1e-9&&first200Difference<1e-9&&maxWorkError<1e-6&&maxReserveError<1e-6&&maxUnpaid<1e-6,'Diagnostic execution integrity failed');
fs.writeFileSync(path.join(ROOT,'docs/effort-history-v9.json'),JSON.stringify(report,null,2)+'\n');
const f=(x,d=3)=>Number.isFinite(x)?x.toFixed(d):'—',p=x=>f(100*x,4)+'%';
const longLow=rows.find(r=>r.length===2400&&r.baselineMean===14.5),longHigh=rows.find(r=>r.length===2400&&r.baselineMean===16.5);
const maximumMatchedFinal600Effect=Math.max(0,...successful.map(h=>Math.abs(h.equalWorkMinusConstant.final600)));
const lines=['# 受控配速历史诊断：现有执行状态能否形成末段差异','',
  `引擎快照：\`${engineHash}\`；四个预声明条件为1200/2400 米 × 中段基准请求14.5/16.5 m/s。生成 ${simulations} 次单马执行；${successful.length}/8 条历史完成局部等做功匹配。`,
  '', '每次使用同一匹中性70马、相同反应延迟与偏置、平坦标准路线和固定参考道，关闭骑手重规划，无前马、阻挡或尾流。前200米与最后600米均发出30 m/s 的饱和请求，由原有速度、功率、储备及疲劳约束决定实际速度。中段常数请求与正/负完整正弦波比较，振幅1.2 m/s。该距离波形只用于诊断，不加入游戏的分段机制。',
  '', '等预算针对引擎记录的整场机械等价做功，容许相对残差不超过0.01%。只在中段均值±0.6 m/s 内搜索；局部符号括区的四分点及二分采样须在同一做功误差尺度内单调。有限采样不证明全区间连续单调，也不保证根唯一。未能匹配的条件原样保存，没有扩大范围或调整生产系数。',
  '', '## 相同中段均值：未匹配预算的响应', '',
  '|距离|基准均值|历史|前段至最后600米（秒）|末600米（秒）|末200−前200（秒）|进入末600米储备|进入末600米保速比例|进入末600米供氧等价功率|整场做功差|',
  '|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const row of rows)for(const h of [{name:'常数',r:row.reference},...row.histories.map(h=>({name:h.shape==='front-loaded'?'先快后慢':'先慢后快',r:h.nominal}))])lines.push(`|${row.length}|${row.baselineMean}|${h.name}|${f(h.r.preLast600Time)}|${f(h.r.final600)}|${f(h.r.last200Difference)}|${p(h.r.entry600.reserveFraction)}|${p(h.r.entry600.retention)}|${f(h.r.entry600.aerobicOutput)}|${p((h.r.totalWork-row.reference.totalWork)/row.reference.totalWork)}|`);
lines.push('', '## 局部等做功匹配', '', '|距离|基准均值|历史|匹配结果|调整后的中段均值|做功相对残差|末600米相对常数差（秒）|末200变化相对常数差（秒）|', '|---:|---:|---|---|---:|---:|---:|---:|');
for(const row of rows)for(const h of row.histories){const m=h.matching;lines.push(`|${row.length}|${row.baselineMean}|${h.shape==='front-loaded'?'先快后慢':'先慢后快'}|${m.matched?'通过':'未匹配：'+m.status}|${f(m.adjustedMean??m.closest.mean,4)}|${p(m.relativeResidual??m.closest.relativeError)}|${f(h.equalWorkMinusConstant?.final600)}|${f(h.equalWorkMinusConstant?.last200Difference)}|`);}
lines.push('', '## 这些结果能说明什么', '',
  `通过等做功匹配的 ${successful.length}/8 条历史中，末600米相对常数请求的最大绝对变化为 ${f(maximumMatchedFinal600Effect,4)} 秒。这一温和的需求顺序干预没有产生很大的等预算末段差异；其余条件的失败记录也不能充当等预算证据。`,
  '', `改变中段均值会显著改变末段入口状态：2400米常数14.5 m/s 的入口储备为 ${p(longLow.reference.entry600.reserveFraction)}、末600米 ${f(longLow.reference.final600)} 秒；常数16.5 m/s 的入口储备仅 ${p(longHigh.reference.entry600.reserveFraction)}、末600米 ${f(longHigh.reference.final600)} 秒。两者整场做功分别为 ${f(longLow.reference.totalWork)} 与 ${f(longHigh.reference.totalWork)} J/kg，不属于已通过的等预算对照。这证明现有执行对前段需求和入口状态有响应，但不能据此分离平均强度与历史顺序的贡献。`,
  '',
  '现有执行已有时间依赖：有氧输出随时间建立，并随体力衰减；无氧储备的消耗/恢复依赖瞬时需求；低储备会削弱可用功率；速度又保留有限加减速的历史。疲劳还取决于累计做功和无氧支出。因此，应先检查骑手是否产生不同的需求历史，以及预测器是否正确传播未来状态，不能仅从自然比赛的末段接近就断言生理模块不具备历史响应。',
  '', '同做功仍可能形成不同末段，原因包括完成前段耗时、可用有氧量、无氧支出、末段入口速度和剩余储备不同；它不是只改变“跑法顺序”的纯生理效应。等做功匹配还调整了中段均值，不能据此判定哪种真实战术最优。',
  '', '储备耗尽的条件可能在末段收敛到同一个供能上限：此时同一匹马、同一路线、同一个最大请求自然产生相近末600米。整场做功对中段请求也可能不单调，因为更快前段会改变总时间和有氧支出，提前耗尽储备又会拖慢末段。完成所在帧的变化还会给完整最后一帧的做功计数带来小幅台阶，本实验没有把这些台阶解释成生理非单调。失败的局部匹配保留为诊断结果，不是已拟合的样本。',
  '', '需要结合完整比赛的原始骑手需求、路线反事实、个体筛选和未来疲劳预测诊断，才能判断现实中首末秒差、末600米极差和分段节奏缺口分别来自何处。本实验没有构造真实对手压力、群体策略、兴奋/抗拒状态，也没有验证现实参数。',
  '', '## 计时与数值边界', '',
  '完赛与600米入口计时使用引擎的步内穿越时刻；入口状态以60 Hz 前后状态线性插值。控制请求在每帧起点按当前位置更新，穿越请求边界的该帧仍用前一段请求，下一帧开始切换。做功、储备与最终状态沿用引擎完整最后一帧，最多比计时终点多1/60秒，每条结果另存这段余量。供氧指标为模型的机械等价量，不能作为实际 VO2 读数。30 m/s 是触发上限的控制输入，不能把“请求减实际”直接当成损失速度。JSON 同时保存可行目标、实际速度、最大速度上限、低储备时长及恢复时长。',
  '', `做功恒等式最大误差 ${maxWorkError.toExponential(3)}；储备恒等式最大误差 ${maxReserveError.toExponential(3)}；未支付功 ${maxUnpaid.toExponential(3)}；最小速率变化 ${f(minAcceleration,6)} m/s²；固定道偏差 ${maxLaneDeviation.toExponential(3)} m；前200米配对差 ${first200Difference.toExponential(3)} 秒。生产系数与快照内容保持不变。`,
  '', '完整原始数据：[effort-history-v9.json](effort-history-v9.json)。可复现脚本：[effort-history-v9.js](../tests/effort-history-v9.js)。',
  '', '```powershell', `node tests/effort-history-v9.js --source-archive ${path.relative(ROOT,sourcePath).replace(/\\/g,'/')} --expected-hash ${engineHash}`, '```', '');
fs.writeFileSync(path.join(ROOT,'docs/effort-history-v9.md'),lines.join('\n'));
console.log(JSON.stringify({output:'docs/effort-history-v9.json',simulations,integrity,summary},null,2));
if(!integrity.allEqualWorkMatchesSucceeded)process.exitCode=1;
