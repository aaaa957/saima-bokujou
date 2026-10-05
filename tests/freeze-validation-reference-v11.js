#!/usr/bin/env node
'use strict';
// Numerical facts from the six declared official 2020 reports. HTML remains
// outside the repository; no article text is copied into the fixture.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const cases=[['sprint',1200,'中山芝外A','右回'],['yasuda',1600,'東京芝A','左回'],['akiten',2000,'東京芝A','左回'],['jc',2400,'東京芝A','左回'],['kikka',3000,'京都芝外A','右回'],['haruten',3200,'京都芝外A','右回']];
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const cell=(s,c)=>{const m=s.match(new RegExp('<td class="'+c+'">([\\s\\S]*?)</td>'));return m?clean(m[1]):null;};
function time(s){if(!s)return null;const m=s.match(/^(\d+):(\d+\.\d)$/);return m?Number(m[1])*60+Number(m[2]):null;}
function parse(name,length,course,direction){
  const raw=fs.readFileSync(path.join(process.env.TEMP,'saima-validation-v11-'+name+'2020.html'));
  const html=new TextDecoder('shift_jis',{fatal:true}).decode(raw);
  const dateMatch=html.match(/<div class="cell date">\s*(2020)年(\d+)月(\d+)日/);
  assert(dateMatch,'Missing date: '+name);
  const date=[dateMatch[1],dateMatch[2].padStart(2,'0'),dateMatch[3].padStart(2,'0')].join('-');
  const detail=clean(html.match(/<div class="cell course">([\s\S]*?)<\/div>/)?.[1]||'');
  assert(detail.includes(length.toLocaleString('en-US')),'Wrong distance: '+name);
  const state=clean(html.match(/<li class="turf">[\s\S]*?<span class="txt">([^<]+)<\/span>/)?.[1]||'');
  assert(['良','稍重','重','不良'].includes(state),'Unknown going: '+name);
  const horses=[...html.matchAll(/<tr>\s*(<td class="place">[\s\S]*?)<\/tr>/g)].map(m=>{
    const s=m[1],position=cell(s,'place'),finishTime=time(cell(s,'time'));
    const corners=[...s.matchAll(/<li title="[^\"]*コーナー通過順位">(\d+)<\/li>/g)].map(m=>Number(m[1]));
    return {finishPosition:/^\d+$/.test(position)?Number(position):null,horseNumber:Number(cell(s,'num')),finishTime,
      final600:Number(cell(s,'f_time'))||null,carriedWeightKg:Number(cell(s,'weight')),bodyMassKg:Number(cell(s,'h_weight')?.match(/^\d+/)?.[0]),
      lastCornerRankReported:corners.at(-1)??null,status:finishTime===null?position:'finished'};
  });
  const splitText=html.match(/<th scope="row">ハロンタイム<\/th>\s*<td>([^<]+)<\/td>/)?.[1];
  assert(splitText,'Missing 200m sectionals: '+name);
  const splits=splitText.split(' - ').map(Number),finishers=horses.filter(h=>Number.isFinite(h.finishTime)),winner=horses.find(h=>h.finishPosition===1);
  assert(horses.length>=10&&horses.length<=18,'Unexpected starter count');
  assert.equal(new Set(horses.map(h=>h.horseNumber)).size,horses.length,'Duplicate horse numbers');
  assert.equal(splits.length,length/200,'Wrong sectional count');
  assert(splits.every(x=>Number.isFinite(x)&&x>0),'Invalid sectionals');
  assert(winner&&winner.finishTime>0&&winner.final600>0,'Missing winner');
  assert(Math.abs(splits.reduce((a,b)=>a+b,0)-winner.finishTime)<0.151,'Sectionals do not sum to winning time');
  assert(finishers.every(h=>h.final600>0&&h.carriedWeightKg>=40&&h.bodyMassKg>=300),'Invalid finisher');
  return {id:date.replaceAll('-','').slice(2),date,length,course,direction,state,surface:'草地',fieldSize:horses.length,entryCount:horses.length,
    raceSectionals200m:splits,winner:{finishTime:winner.finishTime,final600:winner.final600,carriedWeightKg:winner.carriedWeightKg},horses,
    source:{url:'https://www.jra.go.jp/datafile/seiseki/g1/'+name+'/result/'+name+'2020.html',publisher:'JRA',retrievedAt:'2026-10-03',htmlEncoding:'Shift_JIS',rawBytes:raw.length,rawSha256:sha(raw)},
    validation:{uniqueHorseNumbers:true,finiteFinishers:finishers.length,nonFinishers:horses.length-finishers.length,sectionalSumError:splits.reduce((a,b)=>a+b,0)-winner.finishTime}};
}
if(require.main===module){
  const races=cases.map(c=>parse(...c));
  const fixture={schemaVersion:1,selectedBeforeCandidateCalibration:'2026-10-03',scope:'The same six G1 distance/course families, year 2020. Not used for v11 parameter fitting; validation agent has viewed official pages. This is a reserved-year test, not double-blind prediction or an all-race population sample.',
    selectionRule:'One 2020 official G1 per predeclared distance 1200/1600/2000/2400/3000/3200; same Nakayama/Tokyo/Kyoto route families. The 2021 Kyoto-to-Hanshin relocation is avoided.',
    measurementCaveats:['JRA 200m splits describe the successive leader at markers, not the eventual winner trajectory.','Estimated individual final600 and rounded 0.1s finish times are official proxies, not tracking data.','Fractions within 1/2 seconds and tail span use finite finishers; no DNF time is imputed.','Synthetic simulated entrants do not reconstruct these actual horses.'],races};
  const output=path.join(ROOT,'tests/fixtures/race-validation-reference-2020-v11.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(fixture,null,2)+'\n');
  console.log(JSON.stringify({output,races:races.length,validationsPassed:races.every(r=>r.validation.uniqueHorseNumbers),sha256:sha(fs.readFileSync(output))}));
}
module.exports={parse};
