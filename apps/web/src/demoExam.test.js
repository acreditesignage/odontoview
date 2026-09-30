import test from "node:test";
import assert from "node:assert/strict";
import {DEMO_EXAM,buildSyntheticDemoDicomSlice,checkDemoExamAvailability,loadDemoExam} from "./demoExam.js";

test("dentist demo stays available even when published ZIP is unavailable",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:false,headers:{get:()=>"text/html"}});
  try{
    assert.equal(await checkDemoExamAvailability(),true);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test("synthetic fallback produces a valid DICOM Part 10 header and demo identity",()=>{
  const bytes=buildSyntheticDemoDicomSlice(0);
  assert.equal(bytes[128],68);
  assert.equal(bytes[129],73);
  assert.equal(bytes[130],67);
  assert.equal(bytes[131],77);
  const text=new TextDecoder().decode(bytes);
  assert.match(text,/PACIENTE DEMO/);
  assert.match(text,/DEMO01/);
});

test("loadDemoExam falls back to a 100-slice local CBCT when the ZIP cannot be loaded",async()=>{
  let receivedFiles=[];
  const result=await loadDemoExam({
    fetcher:async()=>({ok:false,headers:{get:()=>"text/html"}}),
    importer:async files=>{
      receivedFiles=Array.from(files);
      return {validSeriesCount:1,totalFiles:receivedFiles.length,files:receivedFiles};
    }
  });
  assert.equal(DEMO_EXAM.fallbackSliceCount,100);
  assert.equal(receivedFiles.length,100);
  assert.equal(receivedFiles[0].name,"demo-001.dcm");
  assert.equal(receivedFiles[99].name,"demo-100.dcm");
  assert.equal(result.validSeriesCount,1);
});
