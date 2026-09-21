'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=path.dirname(require.resolve('libarchive-wasm/package.json'));
const destination=path.join(root,'vendor/libarchive');
fs.mkdirSync(destination,{recursive:true});
for(const name of ['libarchive.js','libarchive.wasm']) fs.copyFileSync(path.join(source,'src',name),path.join(destination,name));
