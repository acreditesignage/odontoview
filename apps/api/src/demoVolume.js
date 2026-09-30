import crypto from "node:crypto";
import {readFile} from "node:fs/promises";
import express from "express";
import jwt from "jsonwebtoken";
import jpeg from "jpeg-js";
import {gunzipSync,gzipSync} from "node:zlib";
import {getPrivateObject,putPrivateObject,storageReady} from "./storage.js";

export const DEMO_VOLUME_KEY="demo/odontoview-demo-volume-real-v1.gz";
export const DEMO_VOLUME_SHA256="3345318ff2487500cd5ce973a8c4555181074396533fe8ce7505a4279b7e1369";
export const DEMO_TRANSPORT_META={sliceCount:100,rows:112,columns:112};
const DEMO_ASSET_URL=new URL("../assets/demo-transport.enc.json",import.meta.url);

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

export async function decryptDemoTransportAsset({keyHex,readAsset=async()=>JSON.parse(await readFile(DEMO_ASSET_URL,"utf8"))}={}){
  const key=Buffer.from(String(keyHex||""),"hex");
  if(key.length!==32)throw new Error("Chave do demo CBCT inválida.");
  const asset=await readAsset();
  if(asset?.algorithm!=="AES-256-GCM")throw new Error("Formato criptografado do demo CBCT inválido.");
  const iv=Buffer.from(String(asset.iv||""),"base64");
  const tag=Buffer.from(String(asset.tag||""),"base64");
  const encrypted=Buffer.from(String(asset.ciphertext||""),"base64");
  if(iv.length!==12||tag.length!==16||!encrypted.length)throw new Error("Pacote criptografado do demo CBCT inválido.");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,iv);
  decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(encrypted),decipher.final()]);
  const expected=String(asset.sha256Plain||DEMO_VOLUME_SHA256).toLowerCase();
  if(digest(plain)!==expected)throw new Error("Integridade do demo CBCT inválida após descriptografia.");
  return plain;
}

function parseJpegBundle(bundle,sliceCount){
  const images=[];
  let offset=0;
  for(let index=0;index<sliceCount;index++){
    if(offset+4>bundle.length)throw new Error("Pacote JPEG do demo incompleto.");
    const length=bundle.readUInt32BE(offset);offset+=4;
    if(!length||offset+length>bundle.length)throw new Error("Pacote JPEG do demo corrompido.");
    images.push(bundle.subarray(offset,offset+length));
    offset+=length;
  }
  if(offset!==bundle.length)throw new Error("Pacote JPEG do demo contém dados inesperados.");
  return images;
}

export function decodeDemoJpegTransport(body,meta=DEMO_TRANSPORT_META){
  const bundle=gunzipSync(body);
  const images=parseJpegBundle(bundle,meta.sliceCount);
  const plane=meta.rows*meta.columns;
  const raw=Buffer.alloc(meta.sliceCount*plane);
  images.forEach((image,z)=>{
    const decoded=jpeg.decode(image,{useTArray:true,formatAsRGBA:true});
    if(decoded.width!==meta.columns||decoded.height!==meta.rows)throw new Error("Dimensão JPEG do demo inválida.");
    for(let i=0;i<plane;i++)raw[z*plane+i]=decoded.data[i*4];
  });
  return gzipSync(raw,{level:9});
}

export async function bootstrapDemoVolumeFromEnv({
  env=process.env,
  putObject=putPrivateObject,
  decodeTransport=decodeDemoJpegTransport,
  decryptAsset=decryptDemoTransportAsset
}={}){
  let transport=collectDemoVolumeFromEnv(env);
  let source="env";
  if(!transport&&env.DEMO_CBCT_ASSET_KEY){
    transport=await decryptAsset({keyHex:env.DEMO_CBCT_ASSET_KEY});
    source="encrypted-asset";
  }
  if(!transport)return {uploaded:false,reason:"no-demo-source"};
  const expected=String(env.DEMO_CBCT_SHA256||DEMO_VOLUME_SHA256).trim().toLowerCase();
  const actual=digest(transport);
  if(!/^[a-f0-9]{64}$/.test(expected)||actual!==expected){
    throw new Error("Integridade do demo CBCT inválida (sha256 não confere).");
  }
  const body=Buffer.from(await decodeTransport(transport));
  if(!body.length)throw new Error("Volume demo decodificado vazio.");
  await putObject({key:DEMO_VOLUME_KEY,body,contentType:"application/gzip"});
  return {uploaded:true,source,sizeBytes:body.length,transportSizeBytes:transport.length,sha256:actual,key:DEMO_VOLUME_KEY};
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
