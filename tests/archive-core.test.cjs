const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {zipSync}=require('fflate');
const createModule=require('libarchive-wasm/dist/libarchive.js');
const {dicomFixture}=require('./helpers/dicom-fixture.cjs');
const corePath=path.join(__dirname,'../js/archive-core.js');
const core=fs.existsSync(corePath)?require(corePath):{};
const modulePromise=createModule();
const zip=entries=>zipSync(entries);
const extract=async(data,limits)=>core.extract(await modulePromise,data,{limits});

test('ZIP extracts DICOM from subfolders including extensionless objects and ignores ancillary files',async()=>{
  const result=await extract(zip({'exam/a/1.dcm':dicomFixture(0),'exam/b/IM0002':dicomFixture(1),'manual.txt':Buffer.from('notes'),'DICOMDIR':dicomFixture(2)}));
  assert.deepEqual(result.files.map(f=>f.name),['exam/a/1.dcm','exam/b/IM0002']);
  assert.deepEqual(Buffer.from(result.files[1].buffer),dicomFixture(1));
});
test('RAR4 and RAR5 stored fixtures extract DICOM',async()=>{
  const {rar4Fixture,rar5Fixture}=require('./helpers/rar-fixture.cjs');
  for(const archive of [rar4Fixture({'exam/a.dcm':dicomFixture(0)}),rar5Fixture({'exam/a.dcm':dicomFixture(0)})]){
    const result=await extract(archive);
    assert.equal(result.files.length,1);
    assert.deepEqual(Buffer.from(result.files[0].buffer),dicomFixture(0));
  }
});
test('archive without DICOM returns empty files, not unrelated images as a volume',async()=>{
  assert.deepEqual((await extract(zip({'readme.txt':Buffer.from('hello')}))).files,[]);
});
test('known DICOM extension with corrupt contents is retained for metadata validation to reject',async()=>{
  assert.equal((await extract(zip({'corrupt.dcm':Buffer.from('bad')}))).files.length,1);
});
test('rejects compressed size before copying to WASM memory',async()=>{
  await assert.rejects(extract(zip({'a.dcm':dicomFixture(0)}),{maxInputBytes:10}),/limite/i);
});
test('rejects large declared entry before extracting it',async()=>{
  await assert.rejects(extract(zip({'a.dcm':dicomFixture(0)}),{maxEntryBytes:10}),/limite/i);
});
test('total expanded limit applies across files',async()=>{
  await assert.rejects(extract(zip({'a.dcm':dicomFixture(0),'b.dcm':dicomFixture(1)}),{maxOutputBytes:dicomFixture(0).length+1}),/limite/i);
});
test('rejects too many entries, including non-DICOM files',async()=>{
  await assert.rejects(extract(zip({'a.txt':Buffer.from('a'),'b.txt':Buffer.from('b')}),{maxEntries:1}),/limite/i);
});
test('rejects unsafe archive paths without writing to disk',async()=>{
  await assert.rejects(extract(zip({'../escape.dcm':dicomFixture(0)})),/caminho/i);
});
test('rejects invalid signatures and truncated archive headers',async()=>{
  await assert.rejects(extract(Buffer.from('not an archive')),/ZIP|RAR|compactado/i);
  await assert.rejects(extract(Buffer.from([0x50,0x4b,3,4,0])),/extrair|corrompido|compactado/i);
});
test('rejects corrupt compressed data rather than returning partial DICOM',async()=>{
  const data=zip({'a.dcm':dicomFixture(0)});data[50]^=0xff;
  await assert.rejects(extract(data),/extrair|corrompido/i);
});
test('rejects password protected ZIP and header-encrypted RAR before returning files',async()=>{
  for(const name of ['deflate-encrypted.zip','v4-encrypted.rar']) {
    await assert.rejects(extract(fs.readFileSync(path.join(__dirname,'fixtures',name))),/senha/i);
  }
});
test('rejects a ZIP missing its central directory end rather than silently accepting a partial archive',async()=>{
  const data=zip({'a.dcm':dicomFixture(0)});
  for(const missing of [1,22,50]) await assert.rejects(extract(data.subarray(0,data.length-missing)),/corrompido|incompleto/i);
});
test('rejects RAR4 and RAR5 with truncated or missing end headers',async()=>{
  const {rar4Fixture,rar5Fixture}=require('./helpers/rar-fixture.cjs');
  for(const pack of [rar4Fixture,rar5Fixture]) {
    const data=pack({'a.dcm':dicomFixture(0)});
    for(const missing of [1,7]) await assert.rejects(extract(data.subarray(0,data.length-missing)),/corrompido|incompleto/i);
  }
});
