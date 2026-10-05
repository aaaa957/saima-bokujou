#!/usr/bin/env node
'use strict';
// Diagnose the semantics of a forecast window; no production edit or race steps.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {api,HASH}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'sim.js'),'utf8'),S=api(source);
const race={length:2400,course:'東京芝A',surface:'草地',state:'良',dir:'左回',profile:'平坦'},
 entryOverrides={surface:'草地',special:'左右皆可','斗志':50,'疲劳':0,jockeyGrade:'优秀',bodyMass:480,carriedWeight:57};
const pool=S.makeRaceCandidatePool(S.mulberry32(347),{n:32,level:89,tierKey:'g1',entryOverrides});
const strong=S.makeHorse(S.mulberry32(100),{id:'open-superior',level:97,...entryOverrides,physiology:S.neutralPhysiology(),
 behavior:{forwardness:.5,settle:.5,tractability:.65}}),inputs=structuredClone([...pool,strong]);
const forecast=S.raceEntryForecast(strong,race),selection=S.selectRaceCohort([...pool,strong],S.mulberry32(17),
 {n:8,tierKey:'g1',race,entryOverrides}),d=selection.diagnostics;
const faster=forecast.feasible&&forecast.seconds<d.predictionWindow.fastSeconds-1e-7,
 eligible=forecast.feasible&&forecast.seconds>=d.predictionWindow.fastSeconds-1e-7&&forecast.seconds<=d.predictionWindow.slowSeconds+1e-7;
assert(faster,'The explicitly superior physical entry should beat the upper-ability reference');assert.equal(eligible,false);
assert(d.eligible>=8);assert.equal(d.fallback,0);assert(!selection.horses.some(h=>h.id===strong.id));
assert.deepEqual([...pool,strong],inputs);
const report={generatedAt:new Date().toISOString(),sourceHash:HASH(source),inputHash:HASH(JSON.stringify(inputs)),
 productionSourceUnchanged:HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8'))===HASH(source),
 scope:'One constructed pre-race counterexample of hard-window eligibility; no simulation and no tail/win-rate fit.',race,
 inputPool:inputs,strongerEntry:{id:strong.id,stats:strong.stats,physiology:strong.physiology,forecast,
 fasterThanWindow:faster,markedEligible:eligible,selected:false},diagnostics:d,
 inference:'A hard upper ability / minimum-time eligibility boundary excludes superior candidates even when no fallback is needed. This is cohort matching, not realistic open-grade qualification.',
 officialSources:[{title:'JRA: how to read G1 entry-selection priority',url:'https://www.jra.go.jp/keiba/tokubetsu/mikata.html'},
  {title:'JRA: race class structure',url:'https://www.jra.go.jp/keiba/rules/class.html'}]};
fs.writeFileSync(path.join(root,'docs/cohort-upper-window-review-v11.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceHash:report.sourceHash,inputHash:report.inputHash,
 window:d.predictionWindow,strongForecast:forecast.seconds,eligible:d.eligible,fallback:d.fallback,
 strongerEntryMarkedEligible:eligible,strongerEntrySelected:false,productionSourceUnchanged:report.productionSourceUnchanged}));
