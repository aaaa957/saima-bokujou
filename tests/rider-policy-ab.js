#!/usr/bin/env node
// Calibration-only: retest the captured development rider policy against the current policy using current shared physics.
// Historical docs/rider-policy-ab-v7-development.json used an earlier physical hash; this rerun may differ.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../sim.js'),'utf8');
const oldPolicy=fs.readFileSync(path.join(__dirname,'fixtures/rider-policy-before-v7.txt'),'utf8');
const start=source.indexOf('    function runAI(H) {'),end=source.indexOf('\n    function ',start+30)+1;
const baselineSource=source.slice(0,start)+oldPolicy+source.slice(end);
function api(text){const box={exports:{}};new Function('module','exports',text)(box,box.exports);return box.exports;}
const old=api(baselineSource),fresh=api(source),clone=x=>JSON.parse(JSON.stringify(x));
const hash=text=>crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
function quantile(values,p){const a=values.filter(Number.isFinite).sort((x,y)=>x-y),at=(a.length-1)*p,lo=Math.floor(at);return a[lo]+(a[Math.min(lo+1,a.length-1)]-a[lo])*(at-lo);}
function run(S,field,seed,length,dir){
  const r=S.createRace(clone(field),{length,dir,surface:'草地',state:'良',profile:'平坦',course:'标准',rng:S.mulberry32(seed)});
  let half=null,straight=null,leadChanges=0,previous=null;
  const mark=length-(r.race.geo.finishStraight||r.race.geo.S);
  while(!r.race.finished&&r.race.t<600){r.step(1/30);const sorted=r.race.horses.slice().sort((a,b)=>b.s-a.s||a.gate-b.gate);const H=sorted[0];
    if(!r.race.order.length){if(r.race.t>10&&previous&&previous!==H.id)leadChanges++;if(r.race.t>10)previous=H.id;if(!half&&H.s>=length/2)half=H.id;if(!straight&&H.s>=mark)straight=sorted.map(F=>F.id);}}
  const winner=r.race.order[0],second=r.race.order[1],last=r.race.order.at(-1);
  return{finished:r.race.order.length===field.length,margin:second.gapAtWin/2.4,tail:last.gapAtWin/2.4,winnerTime:winner.time,
    halfLeaderWon:winner.id===half,straightLeaderWon:winner.id===straight?.[0],winnerRankAtStraight:(straight?.indexOf(winner.id)??-1)+1,
    reserveMedian:quantile(r.race.horses.map(H=>H.stamina/H.staminaMax),.5),winnerReserve:winner.stamina/winner.staminaMax,
    meanLaunches:r.race.horses.reduce((n,H)=>n+(H.statsSummary.launches||0),0)/field.length,
    meanWithdrawals:r.race.horses.reduce((n,H)=>n+(H.statsSummary.withdrawals||0),0)/field.length,leadChanges};
}
function summarize(rows){return{n:rows.length,complete:rows.every(r=>r.finished),marginMedian:quantile(rows.map(r=>r.margin),.5),marginP90:quantile(rows.map(r=>r.margin),.9),
  tailMedian:quantile(rows.map(r=>r.tail),.5),winnerTimeMedian:quantile(rows.map(r=>r.winnerTime),.5),
  halfLeaderWinRate:rows.filter(r=>r.halfLeaderWon).length/rows.length,straightLeaderWinRate:rows.filter(r=>r.straightLeaderWon).length/rows.length,
  winnerRanks:rows.reduce((a,r)=>(a[r.winnerRankAtStraight]=(a[r.winnerRankAtStraight]||0)+1,a),{}),reserveMedian:quantile(rows.map(r=>r.reserveMedian),.5),winnerReserveMedian:quantile(rows.map(r=>r.winnerReserve),.5),
  meanLaunches:rows.reduce((n,r)=>n+r.meanLaunches,0)/rows.length,meanWithdrawals:rows.reduce((n,r)=>n+r.meanWithdrawals,0)/rows.length};}
const rows=[];
for(const [li,length] of [1200,1600,2000,2400,3000,3200].entries())for(const [di,dir]of ['左回','右回'].entries())for(let k=0;k<4;k++){
  const seed=(2026100201+li*1000003+di*200003+k*7919)>>>0,field=fresh.makeField(fresh.mulberry32(seed),{n:8,level:70});
  for(const h of field){h.surface='草地';h.special='左右皆可';}
  rows.push({seed,length,dir,old:run(old,field,seed,length,dir),new:run(fresh,field,seed,length,dir)});
}
const result={scope:'48 paired calibration-only races: 6 distances x 2 directions x 4 seeds, generated level 70, standard turf good flat course. Both policies run the exact same locked physical source and fields; no holdout touched.',
  newSourceSHA256:hash(source),oldPolicyOnlySourceSHA256:hash(baselineSource),old:summarize(rows.map(r=>r.old)),new:summarize(rows.map(r=>r.new)),
  byDistance:[1200,1600,2000,2400,3000,3200].map(length=>({length,old:summarize(rows.filter(r=>r.length===length).map(r=>r.old)),new:summarize(rows.filter(r=>r.length===length).map(r=>r.new))})),rows};
if(process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({old:result.old,new:result.new,byDistance:result.byDistance},null,2));
