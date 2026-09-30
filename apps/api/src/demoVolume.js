import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import {getPrivateObject,putPrivateObject,storageReady} from "./storage.js";

export const DEMO_VOLUME_KEY="demo/odontoview-demo-volume-v1.gz";
export const DEMO_VOLUME_SHA256="d1528780e7a037ce35320b56a238b6dc302d842db602ed0f760d93b26ffa8348";

function chunkKey(index){
  return `DEMO_CBCT_CHUNK_${String(index).padStart(2,"0")}`;
}
function digest(buffer){
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function collectDemoVolumeFromEnv(env=process.env){
  const count=Number(env.DEMO_CBCT_CHUNK_COUNT||0);
  if(!Number.isInteger(count)||count<=0)return null;
  if(count>200)throw new Error("Quantidade de chunks do demo CBCT inválida.");
  const chunks=[];
  for(let index=0;index<count;index++){
    const key=chunkKey(index);
    const value=env[key];
    if(!value)throw new Error(`Demo CBCT chunk ausente: ${key}`);
    chunks.push(String(value));
  }
  const body=Buffer.from(chunks.join(""),"base64");
  if(!body.length)throw new Error("Demo CBCT vazio.");
  return body;
}

export async function bootstrapDemoVolumeFromEnv({env=process.env,putObject=putPrivateObject}={}){
  const body=collectDemoVolumeFromEnv(env);
  if(!body)return {uploaded:false,reason:"no-chunks"};
  const expected=String(env.DEMO_CBCT_SHA256||DEMO_VOLUME_SHA256).trim().toLowerCase();
  const actual=digest(body);
  if(!/^[a-f0-9]{64}$/.test(expected)||actual!==expected){
    throw new Error("Integridade do demo CBCT inválida (sha256 não confere).");
  }
  await putObject({key:DEMO_VOLUME_KEY,body,contentType:"application/gzip"});
  return {uploaded:true,sizeBytes:body.length,sha256:actual,key:DEMO_VOLUME_KEY};
}

async function bodyToBuffer(body){
  if(!body)return Buffer.alloc(0);
  if(typeof body.transformToByteArray==="function")return Buffer.from(await body.transformToByteArray());
  const chunks=[];
  for await(const chunk of body)chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function bearer(req){
  const header=String(req.headers.authorization||"");
  return header.startsWith("Bearer ")?header.slice(7):null;
}

export function createDemoVolumeRouter({
  jwtSecret,
  getObject=getPrivateObject,
  isStorageReady=storageReady
}={}){
  if(!jwtSecret)throw new Error("JWT secret obrigatório para o demo privado.");
  const router=express.Router();
  router.get("/api/demo/volume",async(req,res,next)=>{
    try{
      const token=bearer(req);
      if(!token)return res.status(401).json({error:"Autenticação necessária."});
      let auth;
      try{auth=jwt.verify(token,jwtSecret);}catch{return res.status(401).json({error:"Sessão inválida ou expirada."});}
      if(!["DENTIST","ADMIN"].includes(String(auth?.role||""))){
        return res.status(403).json({error:"Demo disponível apenas para dentistas e administradores."});
      }
      if(!isStorageReady())return res.status(503).json({error:"Volume demo ainda não está disponível."});
      const object=await getObject(DEMO_VOLUME_KEY);
      const bytes=await bodyToBuffer(object?.Body);
      if(!bytes.length)return res.status(503).json({error:"Volume demo vazio ou indisponível."});
      res.set("Content-Type","application/gzip");
      res.set("Content-Length",String(bytes.length));
      res.set("Cache-Control","private, no-store");
      res.set("X-Content-Type-Options","nosniff");
      res.set("Content-Disposition","inline; filename=odontoview-demo-volume.gz");
      res.send(bytes);
    }catch(error){next(error);}
  });
  return router;
}
