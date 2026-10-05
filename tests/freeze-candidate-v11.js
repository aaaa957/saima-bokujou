#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),{HASH}=require('./system-reality-v9');
const ROOT=path.resolve(__dirname,'..'),args=process.argv.slice(2),arg=(key,value)=>{const i=args.indexOf(key);return i<0?value:args[i+1];};
const sourcePath=path.resolve(ROOT,arg('--source','sim.js')),output=path.resolve(ROOT,arg('--out','docs/race-validation-v11-mechanism-screen-source.js.gz')),source=fs.readFileSync(sourcePath,'utf8'),expected=arg('--expected-source');
assert(expected,'--expected-source required before preserving a frozen candidate');assert.equal(HASH(source),expected,'Source changed before snapshot');assert(!fs.existsSync(output),'Do not overwrite an archived source; use another output path');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,zlib.gzipSync(source));assert.equal(HASH(zlib.gunzipSync(fs.readFileSync(output)).toString('utf8')),expected);
console.log(JSON.stringify({source:path.relative(ROOT,sourcePath),output:path.relative(ROOT,output),normalizedSha256:expected,steppedRaceExecutions:0}));
