'use strict';
const fs=require('node:fs'),zlib=require('node:zlib');
// Resolve only an exact raw path or its additive lossless .gz sibling.
// Never materialize a raw file or rewrite an archived report while reading.
function resolveReportFile(file){if(fs.existsSync(file))return file;
 if(!file.endsWith('.gz')&&fs.existsSync(file+'.gz'))return file+'.gz';
 throw new Error('Report/archive is missing: '+file);}
function readArchive(file){const resolved=resolveReportFile(file),bytes=fs.readFileSync(resolved),decoded=bytes[0]===0x1f&&bytes[1]===0x8b?zlib.gunzipSync(bytes):bytes;
 return {file:resolved,bytes,decoded,text:decoded.toString('utf8')};}
function readJson(file){return JSON.parse(readArchive(file).text);}
module.exports={resolveReportFile,readArchive,readJson};
