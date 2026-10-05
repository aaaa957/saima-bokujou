#!/usr/bin/env node
'use strict';
// Add lossless, byte-verified gzip copies. Never rename, move or delete inputs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),{pipeline}=require('node:stream/promises');
const ROOT=path.resolve(__dirname,'..'),absolute=f=>path.resolve(ROOT,f),rel=f=>path.relative(ROOT,absolute(f)).replace(/\\/g,'/');
async function digest(stream){const h=crypto.createHash('sha256');let bytes=0;for await(const chunk of stream){h.update(chunk);bytes+=chunk.length;}return {bytes,sha256:h.digest('hex')};}
async function archive(file){const input=absolute(file),output=input+'.gz',before=await digest(fs.createReadStream(input));
 let reused=false;
 if(fs.existsSync(output))reused=true;
 else{
  const temporary=output+'.archive-tmp-'+process.pid;
  await pipeline(fs.createReadStream(input),zlib.createGzip({level:9}),fs.createWriteStream(temporary,{flags:'wx'}));
  const decoded=await digest(fs.createReadStream(temporary).pipe(zlib.createGunzip()));
  if(decoded.bytes!==before.bytes||decoded.sha256!==before.sha256)throw new Error('Compression verification failed; original preserved: '+file);
  // This is our newly created temporary output. The original is never touched.
  fs.renameSync(temporary,output);
 }
 const decoded=await digest(fs.createReadStream(output).pipe(zlib.createGunzip())),after=await digest(fs.createReadStream(input)),compressed=await digest(fs.createReadStream(output));
 if(decoded.bytes!==before.bytes||decoded.sha256!==before.sha256||after.sha256!==before.sha256||after.bytes!==before.bytes)
  throw new Error('Archive is stale or the live input changed; original preserved: '+file);
 return {file:rel(input),gzipFile:rel(output),uncompressedBytes:before.bytes,uncompressedByteSha256:before.sha256,
  compressedBytes:compressed.bytes,compressedByteSha256:compressed.sha256,decodedByteSha256:decoded.sha256,
  ratio:compressed.bytes/before.bytes,verifiedLossless:true,inputUnchanged:true,reused};
}
async function main(args){const files=args.flatMap((arg,i)=>arg==='--input'?[args[i+1]]:[]);if(!files.length||files.some(f=>!f||f.startsWith('--')))throw new Error('Supply --input raw report path (repeatable)');
 const i=args.indexOf('--out'),out=absolute(i<0?'docs/validation-archives-v11.json':args[i+1]),proofs=[];
 for(const file of files){const proof=await archive(file);proofs.push(proof);console.log(JSON.stringify(proof));}
 const previous=fs.existsSync(out)?JSON.parse(fs.readFileSync(out,'utf8')):null,byFile=new Map((previous?.proofs||[]).map(p=>[p.file,p]));for(const proof of proofs)byFile.set(proof.file,proof);
 const report={generatedAt:new Date().toISOString(),scope:'Additive lossless copies of original raw bytes. No input moves/deletions and no loss of traces, failures or metadata.',proofs:[...byFile.values()]};
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');return report;
}
module.exports={archive,digest,main};
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.stack);process.exitCode=1;});
