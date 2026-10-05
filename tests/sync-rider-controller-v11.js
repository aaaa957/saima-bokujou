#!/usr/bin/env node
'use strict';
// Update review source fixtures only. Never writes the production engine.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{HASH}=require('./system-reality-v9');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'sim.js'),'utf8').replace(/\r\n/g,'\n'),file=path.join(__dirname,'fixtures/rider-controller-v11.js'),fixture=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const from=source.indexOf("    // Only visible motion is extrapolated."),to=source.indexOf('    function headwindAt(',from);assert(from>=0&&to>from);
const code=source.slice(from,to);assert(!code.includes('`')&&!code.includes('${'),'Raw controller fixture cannot contain unescaped template syntax');
const marker='const controller=String.raw`',a=fixture.indexOf(marker)+marker.length,b=fixture.indexOf('`;\n',a);assert(a>=marker.length&&b>a);
fs.writeFileSync(file,fixture.slice(0,a)+code+fixture.slice(b));
const coreFrom=source.indexOf('    // 状态推进共用实际供能'),coreTo=source.indexOf('    // Shared one-way physical stopping/response constraint;',coreFrom);assert(coreFrom>=0&&coreTo>coreFrom);
fs.writeFileSync(path.join(__dirname,'fixtures/race-prediction-v11-core.txt'),source.slice(coreFrom,coreTo));
assert.equal(HASH(fs.readFileSync(path.join(root,'sim.js'),'utf8')),HASH(source),'Production must remain unchanged');console.log(JSON.stringify({productionHash:HASH(source),controllerFixtureHash:HASH(fs.readFileSync(file,'utf8')),productionUnchanged:true}));
