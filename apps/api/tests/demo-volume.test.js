import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import {
  collectDemoVolumeFromEnv,
  bootstrapDemoVolumeFromEnv,
  createDemoVolumeRouter,
  DEMO_VOLUME_KEY
} from "../src/demoVolume.js";

const jwtSecret="demo-volume-test-secret";
const sha256=buffer=>crypto.createHash("sha256").update(buffer).digest("hex");

function envFor(buffer,{chunkSize=5,hash=sha256(buffer)}={}){
  const encoded=buffer.toString("base64");
  const chunks=[];
  for(let i=0;i<encoded.length;i+=chunkSize)chunks.push(encoded.slice(i,i+chunkSize));
  const env={DEMO_CBCT_CHUNK_COUNT:String(chunks.length),DEMO_CBCT_SHA256:hash};
  chunks.forEach((chunk,index)=>{env[`DEMO_CBCT_CHUNK_${String(index).padStart(2,"0")}`]=chunk;});
  return env;
}

test("collectDemoVolumeFromEnv reconstructs the exact private gzip payload",()=>{
  const expected=Buffer.from([31,139,8,0,10,20,30,40,50,60,70,80]);
  const actual=collectDemoVolumeFromEnv(envFor(expected));
  assert.deepEqual(actual,expected);
});

test("bootstrapDemoVolumeFromEnv verifies sha256 before writing to private storage",async()=>{
  const expected=Buffer.from([31,139,8,0,1,2,3,4,5,6,7,8,9]);
  let stored=null;
  const result=await bootstrapDemoVolumeFromEnv({
    env:envFor(expected),
    putObject:async input=>{stored=input;}
  });
  assert.equal(result.uploaded,true);
  assert.equal(result.sizeBytes,expected.length);
  assert.equal(stored.key,DEMO_VOLUME_KEY);
  assert.equal(stored.contentType,"application/gzip");
  assert.deepEqual(stored.body,expected);

  await assert.rejects(
    ()=>bootstrapDemoVolumeFromEnv({env:envFor(expected,{hash:"0".repeat(64)}),putObject:async()=>{}}),
    /integridade|sha256|inválido/i
  );
});

test("private demo volume endpoint requires DENTIST or ADMIN authentication",async()=>{
  const payload=Uint8Array.from([31,139,8,0,1,2,3]);
  const app=express();
  app.use(createDemoVolumeRouter({
    jwtSecret,
    isStorageReady:()=>true,
    getObject:async()=>({Body:{transformToByteArray:async()=>payload}})
  }));

  await request(app).get("/api/demo/volume").expect(401);
  const unitToken=jwt.sign({sub:"unit-1",role:"UNIT_USER",email:"unit@example.com"},jwtSecret);
  await request(app).get("/api/demo/volume").set("Authorization","Bearer "+unitToken).expect(403);

  for(const role of ["DENTIST","ADMIN"]){
    const token=jwt.sign({sub:role.toLowerCase()+"-1",role,email:role.toLowerCase()+"@example.com"},jwtSecret);
    const response=await request(app)
      .get("/api/demo/volume")
      .set("Authorization","Bearer "+token)
      .expect(200)
      .expect("Content-Type",/application\/gzip/)
      .expect("Cache-Control",/private/);
    assert.deepEqual(Buffer.from(response.body),Buffer.from(payload));
  }
});
