'use strict';
const fs=require('node:fs'),path=require('node:path'),{HASH}=require('../system-reality-v9');
const file=path.resolve(__dirname,'../../sim.js'),before=fs.readFileSync(file,'utf8');
const source=require('./race-cohort-player-entry-v11').applyPlayerEntryPatch(before);
fs.writeFileSync(file,source);
console.log(JSON.stringify({before:HASH(before),after:HASH(source)}));
