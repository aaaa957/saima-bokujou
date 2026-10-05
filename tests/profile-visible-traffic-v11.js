#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),zlib=require('node:zlib'),{performance}=require('node:perf_hooks');
const {HASH,DT}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'sim.js'),'utf8').replace(/\r\n/g,'\n');let instrumented=source;
function once(a,b){assert.equal(instrumented.split(a).length-1,1,a);instrumented=instrumented.replace(a,b);}
once('    function followingConstraintSolver(maximumSpeed) {','    function followingConstraintSolver(maximumSpeed) {\n      globalThis.__trafficProfile.factories++;');
once('      return followingSlack;','      return (...args)=>{const p=globalThis.__trafficProfile;p.slackCalls++;const t=performance.now();try{return followingSlack(...args);}finally{p.slackMs+=performance.now()-t;}};');
once('if(paired.has(frontMove)) return paired.get(frontMove)-(withResponse?(1/60)*move.v*ownScale:0);','if(paired.has(frontMove)){globalThis.__trafficProfile.pairCache++;return paired.get(frontMove)-(withResponse?(1/60)*move.v*ownScale:0);}');
once('if(now<-1e-7) return now;','if(now<-1e-7){globalThis.__trafficProfile.nowRejected++;return now;}');
once('if(stop<-1e-7) return stop;','if(stop<-1e-7){globalThis.__trafficProfile.stopRejected++;return stop;}');
once('            paired.set(frontMove,lowerBound);\n            return lowerBound-(withResponse?(1/60)*move.v*ownScale:0);','            globalThis.__trafficProfile.distantProof++;paired.set(frontMove,lowerBound);\n            return lowerBound-(withResponse?(1/60)*move.v*ownScale:0);');
once('            paired.set(frontMove,lowerBound);return lowerBound-(withResponse?response:0);','            globalThis.__trafficProfile.routeProof++;paired.set(frontMove,lowerBound);return lowerBound-(withResponse?response:0);');
once('if(witness<-1e-7)return witness;','if(witness<-1e-7){globalThis.__trafficProfile.witnessRejected++;return witness;}');
once('        function gapAt(time) {','        function gapAt(time) {\n          globalThis.__trafficProfile.gapAt++;');
once('        function certifyInterval(left,right,depth) {','        function certifyInterval(left,right,depth) {\n          globalThis.__trafficProfile.certifyInterval++;');
once('        if(fullyCertified){','        if(fullyCertified){globalThis.__trafficProfile.fullyCertified++;');
once('        function covered(left,right) {','        globalThis.__trafficProfile.notFullyCertified++;\n        function covered(left,right) {');
once('          const slopeAt=time=>{','          const slopeAt=time=>{\n            globalThis.__trafficProfile.slopeAt++;');
once('    function projectActions(H,actions,options={}) {','    function projectActions(H,actions,options={}) {\n      globalThis.__trafficProfile.forecastCalls++;');
once('          for(let a=0;a<traffic.length;a++)for(let b=a+1;b<traffic.length;b++)if(projectionBodySweep(traffic[a].h,traffic[b].h,traffic[a].before,traffic[b].before,traffic[a].move,traffic[b].move))opponentPathConflict=true;',
     '          globalThis.__trafficProfile.peerPairs+=traffic.length*(traffic.length-1)/2;\n          for(let a=0;a<traffic.length;a++)for(let b=a+1;b<traffic.length;b++)if(projectionBodySweep(traffic[a].h,traffic[b].h,traffic[a].before,traffic[b].before,traffic[a].move,traffic[b].move))opponentPathConflict=true;');
function zero(){globalThis.__trafficProfile=Object.fromEntries(['factories','slackCalls','slackMs','pairCache','nowRejected','stopRejected','distantProof','routeProof','witnessRejected','gapAt','certifyInterval','fullyCertified','notFullyCertified','slopeAt','forecastCalls','peerPairs'].map(k=>[k,0]));}
const filename=path.join(root,'sim.profile.js'),loaded=new Module(filename);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(instrumented,filename);const S=loaded.exports;
const report={sourceHash:HASH(source),instrumentedHash:HASH(instrumented),instrumentation:'Counts and wrapper wall-time on exact unmodified calculations. No production changes; measured clocks may include OS scheduling.',cases:[]};
function h(i){const x=S.makeHorse(()=>.5,{id:'h'+i,level:70,physiology:S.neutralPhysiology(),behavior:{forwardness:.5,settle:.5,tractability:.65},bodyMass:480,carriedWeight:57,jockeyGrade:'优秀'});for(const k of Object.keys(x.stats))x.stats[k]=70;return x;}
zero();let r=S.createRace([h(0),h(1)],{length:2400,course:'标准',surface:'草地',state:'良',profile:'平坦',wind:0,rng:()=>.5});r.race.t=30;for(const [i,x]of r.race.horses.entries()){Object.assign(x,{s:200+8*i,t:10,v:16,startDelay:0});x.stamina=x.staminaMax;x.guts=x.gutsMax;x.aerobicOutput=x.aerobic;}
let t=performance.now();const own=r.race.horses[0],p=own.projectActions([{duration:10.8,targetV:18,targetT:10}],{maxDt:DT,opponents:[{id:'h1',s:208,t:10,v:16,accel:0,bodyLength:2.635,bodyWidth:.755}]});report.cases.push({name:'Binding fixed front',wallMs:performance.now()-t,steps:p.steps,counters:{...globalThis.__trafficProfile},resultHash:HASH(JSON.stringify(p))});
zero();r=S.createRace(S.makeField(S.mulberry32(902),{n:8,level:70,playerIndex:-1}),{length:1200,course:'标准',surface:'草地',state:'良',profile:'平坦',wind:0,rng:S.mulberry32(419)});zero();t=performance.now();let frames=0,error=null;try{for(;frames<180&&!r.race.finished;frames++)r.step(DT);}catch(e){error=e.message;}
report.cases.push({name:'Eight AI horses first three seconds',frames,simulatedSeconds:r.race.t,wallMs:performance.now()-t,error,counters:{...globalThis.__trafficProfile},stateHash:HASH(JSON.stringify(r.race.horses.map(x=>({s:x.s,v:x.v,t:x.t,stamina:x.stamina}))))});
report.productionUnchanged=HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===report.sourceHash;
fs.writeFileSync(path.join(root,'docs/profile-visible-traffic-v11.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(root,'docs/profile-visible-traffic-v11.json.source.js.gz'),zlib.gzipSync(source));console.log(JSON.stringify(report,null,2));delete globalThis.__trafficProfile;
