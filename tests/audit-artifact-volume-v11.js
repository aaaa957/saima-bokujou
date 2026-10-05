#!/usr/bin/env node
'use strict';
// Read-only Git/file inventory. No reports, checkpoints or source are changed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),many=flag=>args.flatMap((x,i)=>x===flag?[args[i+1]]:[]),out=many('--out')[0]||'docs/artifact-volume-v11.json',
 active=new Set(many('--active')),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),
 list=opts=>execFileSync('git',['ls-files',...opts,'-z','--','docs','tests'],{cwd:root}).toString('utf8').split('\0').filter(Boolean),
 tracked=new Set(list(['--cached'])),pending=new Set(list(['--others','--exclude-standard'])),changed=new Set(execFileSync('git',['diff','--name-only','-z','HEAD','--','docs','tests'],{cwd:root}).toString('utf8').split('\0').filter(Boolean)),
 entries=[...new Set([...tracked,...pending])].filter(f=>f!==out).map(file=>{const filename=path.join(root,file),bytes=fs.statSync(filename).size,isActive=active.has(file),
  data=isActive?null:fs.readFileSync(filename);return {file,bytes,tracked:tracked.has(file),pendingAddition:pending.has(file),changed:changed.has(file),
   active:isActive,byteSha256:data?sha(data):null,rawGzipSibling:!file.endsWith('.gz')&&fs.existsSync(filename+'.gz')};}).sort((a,b)=>b.bytes-a.bytes),
 pendingEntries=entries.filter(e=>e.pendingAddition||e.changed),sum=a=>a.reduce((n,e)=>n+e.bytes,0),unique=new Map();
for(const e of entries)if(e.byteSha256&&!unique.has(e.byteSha256))unique.set(e.byteSha256,e);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/validation-archives-v11.json'),'utf8')),report={generatedAt:new Date().toISOString(),
 scope:'Current Git-tracked and unignored docs/tests inventory; active files are size-only snapshots without content hashes. Existing unchanged artifacts are separated from pending additions/changes. Stage/commit/push untouched.',
 total:{files:entries.length,fileBytes:sum(entries),hashedUniqueContents:unique.size,uniqueContentBytes:sum([...unique.values()]),activeUnhashedBytes:sum(entries.filter(e=>e.active))},
 pending:{files:pendingEntries.length,fileBytes:sum(pendingEntries),large:pendingEntries.filter(e=>e.bytes>500000)},
 existingUnchangedLargeRaw:entries.filter(e=>e.tracked&&!e.changed&&!e.file.endsWith('.gz')&&e.bytes>500000),
 over50MiB:entries.filter(e=>e.bytes>50*1024*1024),rawAndGzipBothTrackedOrUnignored:entries.filter(e=>e.rawGzipSibling),
 activeSkipped:[...active],archive:{proofs:manifest.proofs.length,rawBytes:manifest.proofs.reduce((n,p)=>n+p.uncompressedBytes,0),
  gzipBytes:manifest.proofs.reduce((n,p)=>n+p.compressedBytes,0),allLossless:manifest.proofs.every(p=>p.verifiedLossless&&p.inputUnchanged),localOnlyExactDuplicates:manifest.localOnlyExactDuplicates||[]},
 recommendation:'Do not migrate unchanged pre-v11 tracked raw reports merely to add another gzip copy: exact ignore patterns do not untrack existing Git paths, so a separate root-reviewed cached removal/link migration would be needed. Active training and changing formal-summary inputs must finish before archival.',
 entries};
fs.writeFileSync(path.resolve(root,out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:out,total:report.total,pending:report.pending,archive:report.archive,
 over50MiB:report.over50MiB,rawAndGzipBothTrackedOrUnignored:report.rawAndGzipBothTrackedOrUnignored,existingUnchangedLargeRaw:report.existingUnchangedLargeRaw},null,2));
