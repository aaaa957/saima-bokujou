'use strict';
const fs=require('node:fs'),path=require('node:path'),{HASH}=require('../system-reality-v9');
const file=path.resolve(__dirname,'../../sim.js');
const before=fs.readFileSync(file,'utf8');
let source=require('./prediction-visible-prior-v11').applyVisiblePriorPatch(before);
source=require('./rider-controller-v11').applyController(source);
fs.writeFileSync(file,source);
console.log(JSON.stringify({before:HASH(before),after:HASH(source)}));
