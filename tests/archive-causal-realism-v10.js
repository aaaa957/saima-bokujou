#!/usr/bin/env node
'use strict';
// Lossless storage only. Raw files stay available locally and are Git-ignored.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),names=['causal-controller-start-v10.json','causal-population-paths-v10.json'];
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),rows=[];
for(const name of names){
 const rawPath=path.join(ROOT,'docs',name),gzPath=rawPath+'.gz';
 const raw=fs.existsSync(rawPath)?fs.readFileSync(rawPath):zlib.gunzipSync(fs.readFileSync(gzPath));
 const data=JSON.parse(raw);assert(data.integrity.complete&&data.integrity.sourceUnchanged);
 const archive=zlib.gzipSync(raw,{level:9});assert.deepEqual(zlib.gunzipSync(archive),raw);
 fs.writeFileSync(gzPath,archive);
 assert.deepEqual(zlib.gunzipSync(fs.readFileSync(gzPath)),raw);
 rows.push({rawFile:'docs/'+name,archiveFile:'docs/'+name+'.gz',rawBytes:raw.length,archiveBytes:archive.length,
  rawSha256:sha(raw),archiveSha256:sha(archive),productionEngineHash:data.engineHash||data.productionEngineHash,
  executionEngineHash:data.numericalEngineHash||data.engineHash,exactBytesRoundTrip:true});
}
const report={protocol:'Gzip lossless byte storage only; original execution source identities retained. Existing raw file is authoritative when present, else restore exact bytes from its archive.',archives:rows,integrity:{complete:rows.length===2,allExact:rows.every(x=>x.exactBytesRoundTrip)}};
fs.writeFileSync(path.join(ROOT,'docs/causal-realism-archives-v10.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
