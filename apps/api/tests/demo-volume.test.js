import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import jpeg from "jpeg-js";
import {gunzipSync,gzipSync} from "node:zlib";
import request from "supertest";
import {
  collectDemoVolumeFromEnv,
  bootstrapDemoVolumeFromEnv,
  createDemoVolumeRouter,
  decodeDemoJpegTransport,
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

function jpegBundle(values,{rows=2,columns=2}={}){
  const parts=[];
  for(const value of values){
    const rgba=Buffer.alloc(rows*columns*4);
    for(let i=0;i<rows*columns;i++){
      rgba[i*4]=value; rgba[i*4+1]=value; rgba[i*4+2]=value; rgba[i*4+3]=255;
    }
    const image=jpeg.encode({data:rgba,width:columns,height:rows},90).data;
    const length=Buffer.alloc(4); length.writeUInt32BE(image.length);
    parts.push(length,image);
  }
  return gzipSync(Buffer.concat(parts));
}

test("collectDemoVolumeFromEnv reconstructs the exact private gzip payload",()=>{
  const expected=Buffer.from([31,139,8,0,10,20,30,40,50,60,70,80]);
  const actual=collectDemoVolumeFromEnv(envFor(expected));
  assert.deepEqual(actual,expected);
});

test("JPEG transport is decoded server-side into a raw gzip volume",()=>{
  const transport=jpegBundle([40,180]);
  const stored=decodeDemoJpegTransport(transport,{sliceCount:2,rows:2,columns:2});
  const raw=gunzipSync(stored);
  assert.equal(raw.length,8);
  for(const value of raw.subarray(0,4))assert.ok(Math.abs(value-40)<=4);
  for(const value of raw.subarray(4,8))assert.ok(Math.abs(value-180)<=4);
});

test("bootstrapDemoVolumeFromEnv verifies sha256 and stores only decoded private data",async()=>{
  const transport=Buffer.from([31,139,8,0,1,2,3,4,5,6,7,8,9]);
  const decoded=Buffer.from([31,139,8,0,99,88,77]);
  let stored=null;
  const result=await bootstrapDemoVolumeFromEnv({
    env:envFor(transport),
    decodeTransport:async body=>{
      assert.deepEqual(body,transport);
      return decoded;
    },
    putObject:async input=>{stored=input;}
  });
  assert.equal(result.uploaded,true);
  assert.equal(result.sizeBytes,decoded.length);
  assert.equal(result.transportSizeBytes,transport.length);
  assert.equal(stored.key,DEMO_VOLUME_KEY);
  assert.equal(stored.contentType,"application/gzip");
  assert.deepEqual(stored.body,decoded);

  await assert.rejects(
    ()=>bootstrapDemoVolumeFromEnv({
      env:envFor(transport,{hash:"0".repeat(64)}),
      decodeTransport:async()=>decoded,
      putObject:async()=>{}
    }),
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
