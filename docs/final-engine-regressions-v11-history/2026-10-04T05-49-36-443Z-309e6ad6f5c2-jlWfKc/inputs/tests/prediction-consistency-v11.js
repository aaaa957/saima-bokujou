#!/usr/bin/env node
'use strict';
// Same-state continuation verifies the predictor against execution, not a frozen-fatigue formula.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const {api,HASH,DT}=require('./system-reality-v9');
const {applyPredictionPatch}=require('./fixtures/race-prediction-v11-install');
const ROOT=path.resolve(__dirname,'..'),historical=execFileSync('git',['show','26fa9cb:sim.js'],{cwd:ROOT,encoding:'utf8'}).replace(/\r\n/g,'\n');
const outputPath=path.join(ROOT,'docs/prediction-consistency-v11.json'),historyDirectory=path.join(ROOT,'docs/prediction-consistency-v11-history');
if(fs.existsSync(outputPath)){const previous=fs.readFileSync(outputPath,'utf8');fs.mkdirSync(historyDirectory,{recursive:true});const archived=path.join(historyDirectory,HASH(previous)+'.json');if(!fs.existsSync(archived))fs.writeFileSync(archived,previous);}
const original=fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'),coreSource=applyPredictionPatch(historical);
const source=original.includes('H.projectActions=')?original:coreSource;
const B=api(historical),Core=api(coreSource),S=api(source),clone=x=>JSON.parse(JSON.stringify(x));
const report={startedAt:new Date().toISOString(),testSourceHash:HASH(fs.readFileSync(__filename,'utf8')),fixtureSourceHash:HASH(fs.readFileSync(path.join(__dirname,'fixtures/race-prediction-v11-core.txt'),'utf8')),historicalSourceHash:HASH(historical),coreSourceHash:HASH(coreSource),engineHash:HASH(source),
  productionAtStartHash:HASH(original),productionUsed:source===original,coefficientHash:HASH(JSON.stringify(S.RACE_F)),
  protocol:{dt:DT,fieldSeed:2026100301,raceSeed:2026100302,horse:'Neutral70; all attributes70,480+57kg, no morale/fatigue modifiers; controlled request; no AI or traffic.',
    exactReference:'Actual execution at60Hz from the identical full state, same route and RNG. Finite actions use integral frames; end-state/work include the final whole frame while official finish seconds are interpolated.',
    golden:'Core factoring alone compared with published26fa9cb, every physical state and ledger at each frame. Controller and coefficient changes are excluded from this factoring check.',
    coarse:'Finite default1/30s, tail default0.5s with0.05s response/low-reserve adaptation. Accuracy is reported against60Hz; no fitting to race results.',
    leader:'Visible s/t/v/accel/body geometry only. Decaying observed acceleration uses1.4s response; no hidden opponent physiology or future targets. Projection is not a traffic certificate.',
    scope:'12 fixed solo continuations plus3 exact factoring controls; microbenchmark forecasts are counted separately, not simulated races. No real field calibration or between-horse physiological inference.'},
  executions:0,frames:0,forecastQueries:0,microbenchmarkQueries:0,rows:[],golden:[],properties:[],failures:[]};
const start=performance.now(),horse=B.makeHorse(B.mulberry32(2026100301),{id:'predict-neutral70',level:70,physiology:B.neutralPhysiology(),behavior:{forwardness:.5,settle:.5,tractability:.65},surface:'草地',special:'左右皆可','斗志':50,'疲劳':0,bodyMass:480,carriedWeight:57,jockeyGrade:'普通'});
for(const key of Object.keys(horse.stats))horse.stats[key]=70;
const cases=[
  {name:'gate-flat',length:1200,course:'标准',request:17},
  {name:'gate-side-wind',length:2400,course:'東京',wind:5,side:2,request:17,finite:8},
  {name:'flat-history-full',length:2400,course:'标准',s:1800,v:16,reserve:.47,guts:.88,oxygen:.98,request:18.75},
  {name:'flat-history-depleted',length:2400,course:'标准',s:1800,v:14,reserve:.001,guts:.7,oxygen:1,request:18.75},
  {name:'uphill-nakayama',length:2000,course:'中山',s:1770,v:15,reserve:.12,guts:.8,oxygen:.85,request:18},
  {name:'outer-bend-kyoto',length:3000,course:'京都',s:700,v:16,t:14,reserve:.45,guts:.85,oxygen:1,wind:8,request:17.5},
  {name:'low-reserve-fade',length:800,course:'标准',s:650,v:16,reserve:80/2450,guts:.9,oxygen:1,request:19},
  {name:'zero-reserve-recovery',length:800,course:'标准',s:650,v:10,reserve:0,guts:.9,oxygen:1,request:10},
  {name:'cold-oxygen-demand',length:800,course:'标准',s:400,v:17.5,reserve:1,guts:1,oxygen:.2,request:18.5},
  {name:'low-high-return-sequence',length:1600,course:'标准',s:600,v:16,reserve:.6,guts:.9,oxygen:1,actions:[{duration:3,targetV:14},{duration:5,targetV:18}],request:16},
  {name:'finite-accelerate-lateral',length:2000,course:'中山',s:900,v:12,reserve:.7,guts:.9,oxygen:.6,t:5,side:2,request:17,finite:8},
  {name:'finite-bounded-deceleration',length:1200,course:'小回り',s:400,v:18,reserve:.8,guts:.95,oxygen:1,t:4,request:12,finite:8},
];
report.inputHash=HASH(JSON.stringify({protocol:report.protocol,horse,cases}));
function fresh(A,c){const r=A.createRace([clone(horse)],{length:c.length,course:c.course,surface:'草地',state:'良',profile:'平坦',wind:c.wind||0,rng:A.mulberry32(2026100302)}),H=r.race.horses[0];
  H.t=c.t??r.race.geo.referenceLane;H.targetT=H.t;H.s=c.s??0;H.v=c.v??0;if(H.s>0){H.startDelay=0;r.race.t=20;}
  if(c.reserve!=null)H.stamina=H.staminaMax*c.reserve;if(c.guts!=null)H.guts=H.gutsMax*c.guts;
  H.retention=1-H.fatigueLoss*(1-H.guts/H.gutsMax);if(c.oxygen!=null)H.aerobicOutput=H.aerobic*H.retention*c.oxygen;
  H.control={targetV:c.request,targetT:H.t+(c.side||0)};return {r,H};}
function state(H){return Object.fromEntries(['s','t','v','stamina','guts','retention','aerobicOutput'].map(k=>[k,H[k]]));}
function forecast(H,actions,opts){const before=HASH(JSON.stringify(H));report.forecastQueries++;const p=H.projectActions(actions,opts);assert.equal(HASH(JSON.stringify(H)),before,'Projection mutated the original horse');return p;}
function execute(c,A=S){const {r,H}=fresh(A,c),at=r.race.t,startStats=clone(H.statsSummary),framesPerAction=(c.actions||[]).map(a=>Math.round(a.duration/DT));let frames=0;
  const actions=(c.actions||[]).map(a=>({...a,targetT:a.targetT??H.control.targetT}));
  try{while(!r.race.finished&&r.race.t<610&&(!c.finite||frames<Math.round(c.finite/DT))){let offset=frames,index=0;while(index<actions.length&&offset>=framesPerAction[index])offset-=framesPerAction[index++];
      const action=actions[index]||{targetV:c.request,targetT:H.control.targetT};H.control={targetV:action.targetV,targetT:action.targetT};r.step(DT);frames++;report.frames++;}
    report.executions++;assert(c.finite?frames===Math.round(c.finite/DT):r.race.finished,'Incomplete replay');
    return {status:'complete',frames,seconds:c.finite?r.race.t-at:H.time-at,ledgerSeconds:frames*DT,endpoint:state(H),ledger:{work:H.statsSummary.workUsed-startStats.workUsed,
      aerobicUsed:H.statsSummary.aerobicUsed-startStats.aerobicUsed,energyUsed:H.statsSummary.energyUsed-startStats.energyUsed,recovered:H.statsSummary.recovered-startStats.recovered,unpaidWork:H.statsSummary.unpaidWork-startStats.unpaidWork},final600:H.final3f};
  }catch(error){report.executions++;const failed={status:'failed',frames,error:String(error.stack||error),endpoint:state(H)};report.failures.push({case:c.name,...failed});return failed;}}
function error(p,a){return {seconds:p.seconds-a.seconds,ledgerSeconds:p.ledgerSeconds-a.ledgerSeconds,...Object.fromEntries(Object.keys(a.endpoint).map(k=>[k,p.endpoint[k]-a.endpoint[k]])),
  work:p.ledger.work-a.ledger.work,energy:p.ledger.energyUsed-a.ledger.energyUsed,recovery:p.ledger.recovered-a.ledger.recovered};}
for(const c of cases){try{const {H,r}=fresh(S,c),actions=c.actions||(c.finite?[{duration:c.finite,targetV:c.request,targetT:H.control.targetT}]:[]),opts=c.finite?{}:{tailTargetV:c.request,tailTargetT:H.control.targetT};
  const stateHash=HASH(JSON.stringify({horse:H,time:r.race.t,geo:r.race.geo})),fine=forecast(H,actions,{...opts,maxDt:DT,tailMaxDt:DT}),coarse=forecast(H,actions,opts),actual=execute(c),fineError=actual.status==='complete'?error(fine,actual):null,coarseError=actual.status==='complete'?error(coarse,actual):null;
  const demand=c.finite||c.actions?null:(report.forecastQueries++,H.finishPlan(c.request,0,{tailMaxDt:DT}));
  report.rows.push({case:c,stateHash,actual,fine,coarse,fineError,coarseError,demand});
  assert.equal(actual.status,'complete');assert(Object.values(fineError).every(x=>Math.abs(x)<1e-7),'Fine replay disagrees with actual execution');assert.equal(fine.energyFeasible,true);assert(fine.ledger.unpaidWork<1e-6);
  if(c.name==='zero-reserve-recovery')assert(fine.ledger.recovered>0,'Recovery must evolve in the forecast');
  if(c.name==='cold-oxygen-demand')assert.equal(demand.feasible,false,'Available stored reserve cannot pay an unavailable instantaneous power');
}catch(error){report.failures.push({case:c.name,type:'assertion',error:String(error.stack||error)});}}
for(const c of [cases[0],cases[1],cases[4]]){try{const x=fresh(B,c),y=fresh(Core,c);let frames=0,maxStateError=0,maxLedgerError=0;while(frames<600&&!x.r.race.finished){x.r.step(DT);y.r.step(DT);frames++;report.frames+=2;
  for(const k of Object.keys(state(x.H)))maxStateError=Math.max(maxStateError,Math.abs(x.H[k]-y.H[k]));for(const k of Object.keys(x.H.statsSummary))if(typeof x.H.statsSummary[k]==='number')maxLedgerError=Math.max(maxLedgerError,Math.abs(x.H.statsSummary[k]-y.H.statsSummary[k]));}
  report.executions+=2;assert.equal(maxStateError,0);assert.equal(maxLedgerError,0);report.golden.push({case:c.name,frames,maxStateError,maxLedgerError,exact:true});
}catch(error){report.failures.push({case:c.name,type:'golden',error:String(error.stack||error)});}}
function property(name,run){try{report.properties.push({name,status:'passed',...run()});}catch(error){const failure={name,status:'failed',error:String(error.stack||error)};report.properties.push(failure);report.failures.push(failure);}}
property('Goal reachability is separate from paid energy and clipped speed',()=>{const {H}=fresh(S,{length:2400,course:'東京',s:2200,v:18.6,reserve:800/2450,guts:1,oxygen:1,request:18.75});
  const baseline=forecast(H,[{duration:8,targetV:18.75}],{maxDt:DT}),p=forecast(H,[{duration:4,targetV:18.5},{duration:4,targetV:19.5,goal:{s:baseline.endpoint.s+1,tolerance:.02}}],{maxDt:DT});
  assert(p.energyFeasible);assert(p.targetShortfall>0);assert.equal(p.goalReached,false);assert.equal(p.segments[1].goalReached,false);return {baselineS:baseline.endpoint.s,endpointS:p.endpoint.s,shortfall:p.targetShortfall,energyFeasible:p.energyFeasible,goalReached:p.goalReached};});
property('Opponent forecast uses no hidden state, bounded acceleration, and persistent epochs',()=>{const {H,r}=fresh(S,{length:2400,course:'标准',s:200,v:10,reserve:1,guts:1,oxygen:1,request:12});
  const leader={id:'visible',s:210,t:H.t,v:10,accel:4,bodyWidth:.755};for(const k of ['targetV','stamina','maxV','physiology','aerobicOutput'])Object.defineProperty(leader,k,{get(){throw new Error('Hidden opponent field read: '+k);}});
  const a=forecast(H,[{duration:4,targetV:12,leader},{duration:4,targetV:12,leader}],{maxDt:DT,trace:true}),b=forecast(H,[{duration:8,targetV:12,leader}],{maxDt:DT,trace:true});
  assert.deepEqual(a.endpoint,b.endpoint);assert.deepEqual(a.observedLeaderEndpoints,b.observedLeaderEndpoints);assert(a.observedLeaderEndpoints[0].v<=10+S.RACE_F.runningAccel*S.RACE_F.responseTime+1e-8);
  assert(Math.abs(a.trace[0].time-(r.race.t+DT))<1e-10);assert(Math.abs(a.segments[1].startedAt-(r.race.t+4))<1e-10);assert.equal(a.trafficCertified,false);return {leaderEnd:a.observedLeaderEndpoints[0],traceTime:a.trace[0].time,stageTime:a.segments[1].startedAt,pathConflict:a.pathConflict};});
property('Actual wake corridor is used during observed actions',()=>{const {H}=fresh(S,{length:2400,course:'标准',s:200,v:15,reserve:1,guts:1,oxygen:1,request:15}),tests=[];
  for(const lateral of [1.5,1.8]){const p=forecast(H,[{duration:1,targetV:15,leader:{s:208,t:H.t+lateral,v:15,bodyWidth:.755}}],{maxDt:DT});tests.push({lateral,draftingSeconds:p.limits.draftingSeconds});}
  assert(tests[0].draftingSeconds>.99);assert.equal(tests[1].draftingSeconds,0);return {tests};});
property('Future guts, reserve, oxygen and recovery evolve instead of freezing',()=>{const {H}=fresh(S,{length:2400,course:'标准',s:1800,v:16,reserve:.47,guts:.88,oxygen:.45,request:18.75}),p=forecast(H,[],{tailTargetV:18.75,tailMaxDt:DT});
  assert(p.endpoint.guts<H.guts);assert(p.endpoint.retention<H.retention);assert(p.endpoint.aerobicOutput!==H.aerobicOutput);assert(p.endpoint.stamina<H.stamina);return {initial:state(H),endpoint:p.endpoint};});
const bench=fresh(S,{length:2400,course:'标准',request:15}).H,old=fresh(B,{length:2400,course:'标准',request:15}).H;
function benchmark(H,finite){const runs=40;for(let i=0;i<10;i++){finite?H.projectActions([{duration:8,targetV:16}],{maxDt:.12}):H.finishPlan(15);report.microbenchmarkQueries++;}
  const begun=performance.now();let steps=0;for(let i=0;i<runs;i++){const p=finite?H.projectActions([{duration:8,targetV:16}],{maxDt:.12}):H.finishPlan(15);steps+=p.steps||0;report.microbenchmarkQueries++;}return {runs,meanMilliseconds:(performance.now()-begun)/runs,meanSteps:steps/runs};}
report.performance={newBudget:benchmark(bench,false),oldBudget:benchmark(old,false),newEightSeconds:benchmark(bench,true),caveat:'Warmed single-process wall-time microbenchmark; not whole-race wall time or isolated CPU throughput. Other concurrent team workloads may increase the timings. Nine budget bisections and multiple finite candidates increase controller CPU.'};
const successful=report.rows.filter(x=>x.fineError),maxAbs=(key,kind)=>Math.max(...successful.map(x=>Math.abs(x[kind][key])));
report.summary={rows:report.rows.length,allFineWithin1e7:successful.length===cases.length&&successful.every(x=>Object.values(x.fineError).every(v=>Math.abs(v)<1e-7)),
  fineMaxAbsSeconds:maxAbs('seconds','fineError'),fineMaxAbsState:Math.max(...successful.flatMap(x=>['s','t','v','stamina','guts','retention','aerobicOutput'].map(k=>Math.abs(x.fineError[k])))),
  coarseMaxAbsSeconds:maxAbs('seconds','coarseError'),coarseMaxAbsEnergy:maxAbs('energy','coarseError'),coarseMaxAbsDistance:maxAbs('s','coarseError'),
  failures:report.failures.length,productionUnchanged:HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'))===report.productionAtStartHash};
report.productionEndHash=HASH(fs.readFileSync(path.join(ROOT,'sim.js'),'utf8'));
report.elapsedSeconds=(performance.now()-start)/1000;
fs.writeFileSync(path.join(ROOT,'docs/prediction-consistency-v11.json'),JSON.stringify(report,null,2)+'\n');
const f=x=>Number.isFinite(x)?x.toFixed(6):'—',md=['# v11 预测与实际动作一致性','',`执行源：\`${report.engineHash}\`。同状态输入：\`${report.inputHash}\`。${report.executions} 次执行、${report.frames} 帧、${report.forecastQueries} 个性质/轨迹预测；另 ${report.microbenchmarkQueries} 次微基准预测。`,'',
  '共享供能、有限加速、真实弧长/横移、疲劳、恢复与储备递推。需求预算保留无法支付的需求功率；动作预测则执行实际功率及运动上限。动作阶段末的明确位置目标单独判断，不把截断到上限后的可支付误称为追回成功。',
  '', '|固定场景|60 Hz 预测−实际时间/s|60 Hz 最大状态误差|默认粗积分时间误差/s|粗积分储备消耗误差|', '|---|---:|---:|---:|---:|'];
for(const row of report.rows)md.push(`|${row.case.name}|${f(row.fineError?.seconds)}|${f(row.fineError?Math.max(...['s','t','v','stamina','guts','retention','aerobicOutput'].map(k=>Math.abs(row.fineError[k]))):null)}|${f(row.coarseError?.seconds)}|${f(row.coarseError?.energy)}|`);
md.push('',`三组原执行对照仅测试抽出共同公式的补丁，逐帧最大状态/账目误差均为 ${Math.max(0,...report.golden.map(x=>Math.max(x.maxStateError,x.maxLedgerError)))}。完整生产联调的控制器与参数变化不包含在这个等价性结论中。`, '',
  `热身后：余程预算平均 ${f(report.performance.newBudget.meanMilliseconds)} ms（${report.performance.newBudget.meanSteps} 步）；旧预算 ${f(report.performance.oldBudget.meanMilliseconds)} ms；8 秒动作（dt≤0.12 s）${f(report.performance.newEightSeconds.meanMilliseconds)} ms。这是单进程墙钟微基准，并行团队任务可能增加耗时，不是独占 CPU 吞吐或完整比赛耗时。`, '',
  '60 Hz 可作为同状态续跑核验。默认粗积分是控制预算的近似；其误差完整保留，不能把能量边界或拥挤交通判定当作精确承诺。对手轨迹只使用可观察运动及身体宽度，加速度有界衰减且跨阶段不重新起算；完整交通安全仍由实际 swept solver 和控制器附近候选检查负责。', '',
  `失败 ${report.failures.length} 项，全部保存于 JSON；生产文件开末 hash 相同：${report.summary.productionUnchanged}。测试不是现实生理标定，人工耗尽储备状态也不是自然群体抽样。`, '',
  '复现：`node tests/prediction-consistency-v11.js`。生产未整合时使用 fixture 在内存编译，整合后使用当前生产源；历史 factoring 参照固定为 Git 26fa9cb。', '', '[完整机器结果](prediction-consistency-v11.json)', '');
fs.writeFileSync(path.join(ROOT,'docs/prediction-consistency-v11.md'),md.join('\n'));
console.log(JSON.stringify({summary:report.summary,performance:report.performance,failures:report.failures},null,2));
assert.equal(report.failures.length,0,'Prediction consistency failure; preserved report lists failures');
