'use strict';
// Historical diagnostics always load the published baseline in memory. They do
// not replace the current checkout or silently measure a newer engine.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),COMMIT='582ce9046dd8552d950d0296e8500a8234388eff';
const source=execFileSync('git',['show',COMMIT+':sim.js'],{cwd:ROOT,encoding:'utf8',maxBuffer:2e6});
const engineHash=()=>crypto.createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
if(engineHash()!=='9b2cd208dd8d2e8415452d973a1bf76549222272accf1372bb616af14a2eeb8e')throw new Error('Historical engine hash mismatch');
const filename=path.join(ROOT,'frozen-v8.snapshot.js'),m=new Module(filename,module);m.filename=filename;m.paths=module.paths;m._compile(source,filename);
function readArchived(file){return fs.existsSync(file)?fs.readFileSync(file):zlib.gunzipSync(fs.readFileSync(file+'.gz'));}
module.exports={S:m.exports,source,engineHash,readArchived,COMMIT};
