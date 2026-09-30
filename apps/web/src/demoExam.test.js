import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {DEMO_EXAM,decodeBase64Chunks} from "./demoExam.js";

test("demo exam points to the bundled manifest",()=>{
  assert.equal(DEMO_EXAM.manifestUrl,"/demo/odontoview-demo.manifest.json");
});

test("base64 demo chunks reconstruct the original byte stream",()=>{
  const bytes=decodeBase64Chunks(["UEsD","BAUG"]);
  assert.deepEqual(Array.from(bytes),[80,75,3,4,5,6]);
});

test("bundled dentist demo reconstructs the approved 100-slice ZIP exactly",async()=>{
  const manifestUrl=new URL("../public/demo/odontoview-demo.manifest.json",import.meta.url);
  const manifest=JSON.parse(await readFile(manifestUrl,"utf8"));
  assert.equal(manifest.encoding,"base64-chunks");
  assert.equal(manifest.fileCount,100);
  assert.equal(manifest.byteLength,2267479);
  assert.equal(manifest.sha256,"90407f7be8e9ab399688378a9a85c75b3c29be1a9e7c260482ecaac04da37227");
  assert.equal(manifest.chunks.length,4);
  const chunks=[];
  for(const name of manifest.chunks){
    chunks.push((await readFile(new URL(`../public/demo/${name}`,import.meta.url),"utf8")).trim());
  }
  const bytes=decodeBase64Chunks(chunks);
  assert.equal(bytes.byteLength,manifest.byteLength);
  assert.deepEqual(Array.from(bytes.slice(0,4)),[80,75,3,4]);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),manifest.sha256);
});
