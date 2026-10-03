'use strict';
// Historical pre-heading-repair proposal for source provenance only.
// It retains the old route heading defect and must not be used as a release engine.
// Current accepted numeric source is in v9-numeric-snapshot.js.
// This helper never rewrites production.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const BASE_HASH='44b09fc4789ccacf6cf812251effc8f3367e9f4996aa7b597886bd83d85ab6f1';
const OPTIMIZED_HASH='06abcbd557f868584ee2ce7a27357b4affeacaa9b7c0dccdfb06235c49765e90';
const archivePath=path.join(ROOT,'docs/system-numeric-source-44b09f-v9.js.gz');
const patchPath=path.join(ROOT,'tests/fixtures/traffic-optimization-v9.patch');
const hash=source=>crypto.createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
function applyExactPatch(source,patch) {
  source=source.replace(/\r\n/g,'\n');patch=patch.replace(/\r\n/g,'\n');
  const original=source.split('\n'),lines=patch.split('\n'),result=[];let cursor=0,hunks=0;
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].startsWith('@@ '))continue;
    const header=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
    assert(header,'Invalid patch hunk header');hunks++;
    const start=Number(header[1])-1,oldCount=header[2]===undefined?1:Number(header[2]),newCount=header[4]===undefined?1:Number(header[4]);
    assert(start>=cursor,'Overlapping or reordered hunks');
    result.push(...original.slice(cursor,start));cursor=start;
    let removed=0,added=0;
    while(i+1<lines.length&&(removed<oldCount||added<newCount)) {
      const line=lines[++i],kind=line[0],text=line.slice(1);
      assert([' ','+','-'].includes(kind),'Unexpected patch data');
      if(kind!=='+' ){assert.equal(original[cursor],text,'Patch context mismatch at source line '+(cursor+1));cursor++;removed++;}
      if(kind!=='-'){result.push(text);added++;}
    }
    assert.equal(removed,oldCount,'Hunk removal count mismatch');assert.equal(added,newCount,'Hunk insertion count mismatch');
  }
  assert(hunks>0,'Empty patch');result.push(...original.slice(cursor));return result.join('\n');
}
function optimizedSource() {
  const source=zlib.gunzipSync(fs.readFileSync(archivePath)).toString('utf8');
  assert.equal(hash(source),BASE_HASH,'Frozen baseline source changed');
  const optimized=applyExactPatch(source,fs.readFileSync(patchPath,'utf8'));
  assert.equal(hash(optimized),OPTIMIZED_HASH,'Traffic proposal transform changed');return optimized;
}
module.exports={BASE_HASH,OPTIMIZED_HASH,archivePath,patchPath,hash,applyExactPatch,optimizedSource};
if(require.main===module)console.log(JSON.stringify({baseHash:BASE_HASH,optimizedHash:hash(optimizedSource()),productionFileModified:false,patchPath}));
