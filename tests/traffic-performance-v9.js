#!/usr/bin/env node
'use strict';
// Exact paired-state regression for performance changes only. The two source
// archives are isolated historical snapshots, never production dependencies.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const zlib=require('node:zlib'),crypto=require('node:crypto'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const initial=option('--stage','cache')==='initial';
const output=path.resolve(ROOT,option('--out','docs/traffic-performance-v9.json'));
const archive=id=>zlib.gunzipSync(fs.readFileSync(path.join(ROOT,'docs/traffic-performance-source-'+id+'-v9.js.gz'))).toString('utf8');
const hash=source=>crypto.createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
const beforeSource=archive(initial?'18c9cf':'2b711a');
const sourcePath=path.resolve(ROOT,option('--source-archive',initial?'docs/traffic-performance-source-2b711a-v9.js.gz':'sim.js'));
const readSource=()=>{const b=fs.readFileSync(sourcePath);return(b[0]===0x1f&&b[1]===0x8b?zlib.gunzipSync(b):b).toString('utf8');};
const afterSource=readSource(),sourceArtifact={path:sourcePath,kind:args.includes('--source-archive')?'explicit-artifact':initial?'frozen-stage':'workspace',contentHash:hash(afterSource)};
if(args.includes('--check-source')){console.log(JSON.stringify({sourceArtifact,engineHash:hash(afterSource)}));process.exit(0);}
assert.equal(hash(beforeSource),initial?'18c9cf8995cfa6cc1b6c820871c2c6e98289ea8c901f8834b783b01984293d10':'2b711a6ce5c3befe653bfd59af5329d55cd460da6ab00fa6139d98fc7b55f81b');
function api(source){const filename=path.join(ROOT,'sim.perf-snapshot.js'),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(source,filename);return loaded.exports;}
const beforeS=api(beforeSource),afterS=api(afterSource),KEYS=['s','t','v','stamina','guts','retention','targetV','targetT'];
const configurations=[
  {length:1600,course:'東京芝A',n:16,seed:2026100207,seconds:10},
  {length:1600,course:'東京芝A',n:18,seed:2026100207,seconds:10},
  {length:2000,course:'東京芝A',n:16,seed:2026100207,seconds:10},
  {length:2000,course:'東京芝A',n:18,seed:2026100207,seconds:20},
  {length:1200,course:'标准',n:16,seed:3198315393,raceSeed:546640440,healthy:true},
  {length:1200,course:'标准',n:16,seed:3198943767,raceSeed:547060654,healthy:true,equal:true},
];
function run(S,config){
  const entries=beforeS.makeField(beforeS.mulberry32(config.seed),{n:config.n,level:70});
  for(const h of entries){h.surface='草地';h.special='左右皆可';
    if(config.healthy)Object.assign(h,{'疲劳':0,'斗志':50,jockeyGrade:'普通',bodyMass:480,carriedWeight:57});
    if(config.equal)for(const key of Object.keys(h.stats))h.stats[key]=70;
  }
  const r=S.createRace(JSON.parse(JSON.stringify(entries)),{length:config.length,course:config.course,
    dir:config.course==='東京芝A'?'左回':undefined,profile:'平坦',surface:'草地',state:'良',
    rng:S.mulberry32(config.raceSeed??((config.seed^0x9e3779b9)>>>0))});
  const trace=[],durations=[],wallStart=performance.now(),cpuStart=process.cpuUsage();
  while(!r.race.finished&&r.race.t<(config.seconds||610)){
    const start=performance.now();r.step(1/60);durations.push(performance.now()-start);
    trace.push(r.race.horses.map(h=>KEYS.map(key=>{assert(Number.isFinite(h[key]));return h[key];})));
  }
  const wallSeconds=(performance.now()-wallStart)/1000,cpu=process.cpuUsage(cpuStart);
  durations.sort((a,b)=>a-b);
  return {trace,result:{wallSeconds,cpuSeconds:(cpu.user+cpu.system)/1e6,frames:durations.length,
    median:durations[Math.floor(durations.length*.5)],p95:durations[Math.floor(durations.length*.95)],
    p99:durations[Math.floor(durations.length*.99)],max:durations.at(-1),finished:r.race.finished,
    traffic:r.race.traffic,horseFinal:r.race.horses.map(h=>({id:h.id,time:h.time,final600:h.final3f,
      sectionals:h.sectionals,targetV:h.targetV,targetT:h.targetT,reserve:h.stamina}))}};
}
const prior=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):null;
const initialStage=initial?undefined:prior?.initialStage;
if(initialStage){
  initialStage.compiledSourcesImmutable=true;
  initialStage.note='This earlier stage compiled both source snapshots once. Later workspace edits do not alter the compared in-memory modules; sourceUnchanged describes the workspace only.';
}
const rows=[];
for(const config of configurations){
  console.log(JSON.stringify({event:'start',config}));const before=run(beforeS,config),after=run(afterS,config);
  let maxError=0,firstDifference=null;
  for(let i=0;i<Math.min(before.trace.length,after.trace.length);i++)for(let j=0;j<config.n;j++)for(let k=0;k<KEYS.length;k++){
    const error=Math.abs(before.trace[i][j][k]-after.trace[i][j][k]);
    if(error>maxError){maxError=error;if(!firstDifference)firstDifference={frame:i,horse:j,key:KEYS[k],before:before.trace[i][j][k],after:after.trace[i][j][k]};}
  }
  const allFinalEqual=JSON.stringify(before.result.horseFinal)===JSON.stringify(after.result.horseFinal);
  const row={config,maxError,firstDifference,equalFrames:before.trace.length===after.trace.length,
    allFinalEqual,before:before.result,after:after.result};rows.push(row);
  const report={initialStage,note:'Sequential comparisons; concurrent independent jobs can affect wall timings. cpuSeconds isolates this Node process. Exact-state equality is the regression requirement, not a universal browser FPS claim.',
    beforeHash:hash(beforeSource),engineHash:hash(afterSource),sourceArtifact,protocol:{sourceArtifact,stage:initial?'initial':'cache'},
    sourceUnchanged:hash(readSource())===hash(afterSource),
    keys:KEYS,rows,complete:rows.length===configurations.length,
    allExactEqual:rows.every(x=>x.maxError===0&&x.equalFrames&&x.allFinalEqual),
    allStagesExactEqual:rows.length===configurations.length&&rows.every(x=>x.maxError===0&&x.equalFrames&&x.allFinalEqual)&&
      (!initialStage||(initialStage.rows.length===configurations.length&&initialStage.rows.every(x=>x.maxError===0&&x.equalFrames&&x.allFinalEqual)))};
  fs.writeFileSync(output,JSON.stringify(report,null,2));
  assert.equal(maxError,0,JSON.stringify(firstDifference));assert(row.equalFrames&&allFinalEqual);
  console.log(JSON.stringify({event:'result',config,maxError,allFinalEqual,
    before:row.before.wallSeconds,after:row.after.wallSeconds,cpuBefore:row.before.cpuSeconds,cpuAfter:row.after.cpuSeconds,
    p95Before:row.before.p95,p95After:row.after.p95,maxBefore:row.before.max,maxAfter:row.after.max}));
}
