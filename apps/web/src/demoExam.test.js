import test from "node:test";
import assert from "node:assert/strict";
import {gzipSync} from "node:zlib";
import {
  DEMO_EXAM,
  DEMO_VOLUME_META,
  buildPatientDemoDicomSlice,
  createPatientDemoFiles,
  checkDemoExamAvailability,
  loadDemoExam
} from "./demoExam.js";

test("dentist demo remains visible while the private volume is fetched on demand",async()=>{
  assert.equal(await checkDemoExamAvailability(),true);
  assert.equal(DEMO_EXAM.url,"/api/demo/volume");
  assert.equal(DEMO_VOLUME_META.sliceCount,100);
});

test("real demo pixels are wrapped in a deidentified DICOM Part 10 slice",()=>{
  const pixels=new Uint8Array(DEMO_VOLUME_META.rows*DEMO_VOLUME_META.columns);
  pixels.fill(90);
  const bytes=buildPatientDemoDicomSlice(0,pixels);
  assert.equal(bytes[128],68);
  assert.equal(bytes[129],73);
  assert.equal(bytes[130],67);
  assert.equal(bytes[131],77);
  const text=new TextDecoder().decode(bytes);
  assert.match(text,/PACIENTE DEMO/);
  assert.match(text,/DEMO01/);
  assert.doesNotMatch(text,/ROGERIO|ROGÉRIO/i);
});

test("createPatientDemoFiles rebuilds exactly 100 DICOM slices from the private pixel volume",()=>{
  const raw=new Uint8Array(DEMO_VOLUME_META.sliceCount*DEMO_VOLUME_META.rows*DEMO_VOLUME_META.columns);
  const files=createPatientDemoFiles(raw);
  assert.equal(files.length,100);
  assert.equal(files[0].name,"demo-001.dcm");
  assert.equal(files[99].name,"demo-100.dcm");
});

test("loadDemoExam downloads the authenticated private volume and never uses the synthetic fallback",async()=>{
  const raw=new Uint8Array(DEMO_VOLUME_META.sliceCount*DEMO_VOLUME_META.rows*DEMO_VOLUME_META.columns);
  for(let i=0;i<raw.length;i++)raw[i]=i%251;
  const gz=gzipSync(raw);
  let requestUrl=null,requestOptions=null,receivedFiles=[];
  const result=await loadDemoExam({
    token:"dentist-test-token",
    fetcher:async(url,options)=>{
      requestUrl=url;requestOptions=options;
      return {
        ok:true,
        status:200,
        headers:{get:()=>"application/gzip"},
        arrayBuffer:async()=>gz.buffer.slice(gz.byteOffset,gz.byteOffset+gz.byteLength)
      };
    },
    importer:async files=>{
      receivedFiles=Array.from(files);
      return {validSeriesCount:1,totalFiles:receivedFiles.length,files:receivedFiles};
    }
  });
  assert.equal(requestUrl,"/api/demo/volume");
  assert.equal(requestOptions.headers.Authorization,"Bearer dentist-test-token");
  assert.equal(receivedFiles.length,100);
  assert.equal(result.validSeriesCount,1);
});

test("loadDemoExam reports private-demo failure instead of fabricating another patient",async()=>{
  let importerCalled=false;
  await assert.rejects(
    ()=>loadDemoExam({
      token:"dentist-test-token",
      fetcher:async()=>({ok:false,status:404,headers:{get:()=>"application/json"}}),
      importer:async()=>{importerCalled=true;}
    }),
    /demo|volume|indisponível|carregar/i
  );
  assert.equal(importerCalled,false);
});
