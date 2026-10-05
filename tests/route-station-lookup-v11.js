#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {compileSource}=require('./race-validation-v11'),{HASH}=require('./system-reality-v9');
const {applyRouteStationLookupPatch,restoreRouteStationLookupBaseline}=require('./fixtures/route-station-lookup-v11');
const root=path.resolve(__dirname,'..'),production=fs.readFileSync(path.join(root,'sim.js'),'utf8').replace(/\r\n/g,'\n'),
 source=production.includes('  const ROUTE_STATION_LOOKUP_CACHE=new WeakMap();')?restoreRouteStationLookupBaseline(production):production,candidate=applyRouteStationLookupPatch(source);
const expose=(s,newer)=>s.replace('  const api = {','  const api = {\n    __routeTablePoint:routeTablePoint,__lowerIndex:'+(newer?'routeStationLowerIndex':'(stations,at)=>{let lo=0,hi=stations.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(stations[mid]<=at)lo=mid;else hi=mid;}return lo;}')+',');
const S=compileSource(expose(source,false)),T=compileSource(expose(candidate,true)),report={sourceHash:HASH(production),baselineHash:HASH(source),candidateHash:HASH(candidate),installedAtStart:production===candidate,scriptHash:HASH(fs.readFileSync(__filename,'utf8')),actualStepCalls:0,fullRaceExecutions:0,checks:[],routes:[],queryCount:0,bracketQueries:0,benchmarks:[],failures:[]};
function check(name,fn){try{const details=fn();report.checks.push({name,pass:true,...details});}catch(e){report.checks.push({name,pass:false,error:e.stack});report.failures.push(name);}}
check('Patch idempotent, inverse exact, all interpolation expressions retained',()=>{assert.equal(applyRouteStationLookupPatch(candidate),candidate);assert.equal(restoreRouteStationLookupBaseline(candidate),source);assert.equal(candidate.slice(candidate.indexOf('    const a=samples[i],b=samples[i+1];'),candidate.indexOf('  function loopReferencePoint')),source.slice(source.indexOf('    const a=samples[i],b=samples[i+1];'),source.indexOf('  function loopReferencePoint')));});
const loops=new Set(),tables=[];
for(const [course,def]of Object.entries(S.COURSES))for(const length of def.distances||[1200,2400,3200]){
  const geo=S.trackGeometry(length,course,course.includes('泥')?'泥地':'草地');
  if(geo.route&&!loops.has(geo.route.loop.stations)){loops.add(geo.route.loop.stations);tables.push({course,length,owner:geo.route.loop,stations:geo.route.loop.stations});}
  if(geo.route?.chute)tables.push({course,length,owner:geo.route.chute,stations:geo.route.chute.step,chute:true});
}
const bits=new DataView(new ArrayBuffer(8));
function adjacent(x,direction){if(x===0)return direction*Number.MIN_VALUE;bits.setFloat64(0,x);let v=bits.getBigUint64(0);v+=BigInt(Math.sign(x)===direction?1:-1);bits.setBigUint64(0,v);return bits.getFloat64(0);}
function equivalent(table,at){
  let a,b,ae,be;try{a=S.__routeTablePoint(table.owner.samples,table.stations,at);}catch(e){ae={name:e.name,message:e.message};}try{b=T.__routeTablePoint(table.owner.samples,table.stations,at);}catch(e){be={name:e.name,message:e.message};}report.queryCount++;
  assert.deepEqual(be,ae,'Original exception semantics');
  if(ae)report.queriesThatThrow=(report.queriesThatThrow||0)+1;
  else{assert.deepEqual(b,a,'All point fields at '+table.course+'/'+table.length+'/'+String(at));assert.equal(JSON.stringify(b),JSON.stringify(a),'Point JSON exact');}
  if(Array.isArray(table.stations)){report.bracketQueries++;assert.equal(T.__lowerIndex(table.stations,at),S.__lowerIndex(table.stations,at),'Exact lower index');}
}
check('All route nodes, both nearest representable neighbours and fixed local neighbours',()=>{
  for(const table of tables){const end=table.owner.lap??table.owner.length,nodes=Array.isArray(table.stations)?table.stations:Array.from({length:table.owner.samples.length},(_,i)=>i*table.stations);const before=report.queryCount;
    for(const q of nodes)for(const at of [adjacent(q,-1),q,adjacent(q,1),q-1e-9,q+1e-9])equivalent(table,at);
    report.routes.push({course:table.course,length:table.length,chute:!!table.chute,nodes:nodes.length,end,queries:report.queryCount-before});
  }return {tables:tables.length,queries:report.queryCount};
});
check('Declared random finite, outside range, exact endpoints and nonfinite original semantics',()=>{
  const rng=S.mulberry32(202610041337);const before=report.queryCount;
  for(const table of tables){const end=table.owner.lap??table.owner.length;
    for(let i=0;i<1000;i++)equivalent(table,(rng()*1.02-.01)*end);
    for(const at of [-Infinity,Infinity,NaN,-0,0,-1e9,1e9,end,end+Number.EPSILON*end,null,'1',new Number(1)])equivalent(table,at);
  }return {queries:report.queryCount-before};
});
check('Synthetic immutable sparse/duplicate stations preserve original bracket for finite and nonfinite',()=>{
  const rng=S.mulberry32(912);let queries=0;
  for(const stations of [[0,1],[0,.001,.001,10,10.1,100],[-100,-9,0,.001,1,1000],[0,.00001,.00002,.00003,.00004,1,100]])for(const at of [...stations,...stations.map(x=>adjacent(x,-1)),...stations.map(x=>adjacent(x,1)),NaN,Infinity,-Infinity,...Array.from({length:1000},()=>stations[0]+rng()*(stations.at(-1)-stations[0]))]){assert.equal(T.__lowerIndex(stations,at),S.__lowerIndex(stations,at));queries++;}return {queries};
});
if(!report.failures.length&&!process.argv.includes('--no-benchmark')){
  const table=tables.find(t=>t.course==='京都芝外A'&&!t.chute),rng=S.mulberry32(6712),qs=Array.from({length:20000},()=>rng()*table.owner.lap);let sink=0;
  const run=fn=>{const start=performance.now(),cpu=process.threadCpuUsage();for(let repeat=0;repeat<50;repeat++)for(const at of qs){const p=fn(table.owner.samples,table.stations,at);sink+=p.metric;}const used=process.threadCpuUsage(cpu);return {wallMs:performance.now()-start,threadCpuMs:(used.user+used.system)/1000};};
  run(S.__routeTablePoint);run(T.__routeTablePoint);
  for(let round=0;round<5;round++){const names=round%2?['candidate','original']:['original','candidate'],r={round};for(const name of names)r[name]=run(name==='original'?S.__routeTablePoint:T.__routeTablePoint);report.benchmarks.push(r);}
  const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];report.componentBenchmark={queriesPerArmPerRound:1000000,rounds:5,originalMedianWallMs:median(report.benchmarks.map(r=>r.original.wallMs)),candidateMedianWallMs:median(report.benchmarks.map(r=>r.candidate.wallMs)),originalMedianCpuMs:median(report.benchmarks.map(r=>r.original.threadCpuMs)),candidateMedianCpuMs:median(report.benchmarks.map(r=>r.candidate.threadCpuMs)),sink,scope:'Warm pure quintic component calls, random Kyoto stations. This is not an end-to-end speed guarantee.'};report.componentBenchmark.wallReduction=1-report.componentBenchmark.candidateMedianWallMs/report.componentBenchmark.originalMedianWallMs;report.componentBenchmark.cpuReduction=1-report.componentBenchmark.candidateMedianCpuMs/report.componentBenchmark.originalMedianCpuMs;
}
report.productionUnchanged=HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===report.sourceHash;report.pass=!report.failures.length&&report.productionUnchanged;
const out=path.join(root,'docs/route-station-lookup-v11.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');for(const [suffix,s]of [['source',production],['baseline',source],['candidate',candidate],['script',fs.readFileSync(__filename,'utf8')]])fs.writeFileSync(out+'.'+suffix+'.js.gz',zlib.gzipSync(s));console.log(JSON.stringify({out,sourceHash:report.sourceHash,baselineHash:report.baselineHash,candidateHash:report.candidateHash,pass:report.pass,checks:report.checks,queries:report.queryCount,bracketQueries:report.bracketQueries,componentBenchmark:report.componentBenchmark},null,2));if(!report.pass)process.exitCode=1;
