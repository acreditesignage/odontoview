import test from "node:test";
import assert from "node:assert/strict";
import {DEMO_EXAM,decodeBase64Chunks} from "./demoExam.js";

test("demo exam points to the bundled manifest",()=>{
  assert.equal(DEMO_EXAM.manifestUrl,"/demo/odontoview-demo.manifest.json");
});

test("base64 demo chunks reconstruct the original byte stream",()=>{
  const bytes=decodeBase64Chunks(["UEsD","BAUG"]);
  assert.deepEqual(Array.from(bytes),[80,75,3,4,5,6]);
});
