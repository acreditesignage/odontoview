import crypto from "node:crypto";
import {readFile} from "node:fs/promises";
import express from "express";
import jwt from "jsonwebtoken";
import jpeg from "jpeg-js";
import {gunzipSync,gzipSync} from "node:zlib";
import {getPrivateObject,putPrivateObject,storageReady} from "./storage.js";

export const DEMO_VOLUME_KEY="demo/odontoview-demo-volume-real-v2.gz";
export const DEMO_VOLUME_SHA256="bfb65a80a02c26fcc71a559b01f176d0e3bebd4402773267f8324ff11911f339";
export const DEMO_TRANSPORT_META={sliceCount:100,rows:64,columns:64};
export const DEMO_OUTPUT_META={sliceCount:300,rows:192,columns:192};
const DEMO_ASSET_URL=new URL("../assets/demo-transport.enc.json",import.meta.url);

function chunkKey(index){return `DEMO_CBCT_CHUNK_${String(index).padStart(2,"0")}`;}
function digest(buffer){return crypto.createHash("sha256").update(buffer).digest("hex");}

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

function parseJpegBundle(bundle){
  const images=[];
  let offset=0;
  while(offset<bundle.length){
    if(offset+4>bundle.length)throw new Error("Pacote JPEG do demo contém cabeçalho incompleto.");
    const length=bundle.readUInt32BE(offset);offset+=4;
    if(!length||offset+length>bundle.length)throw new Error("Pacote JPEG do demo corrompido.");
    images.push(bundle.subarray(offset,offset+length));offset+=length;
    if(images.length>1000)throw new Error("Pacote JPEG do demo possui cortes demais.");
  }
  if(images.length<2)throw new Error("Pacote JPEG do demo possui poucos cortes.");
  return images;
}

function resizePlaneBilinear(source,srcRows,srcCols,dstRows,dstCols){
  const out=Buffer.alloc(dstRows*dstCols);
  const sx=(srcCols-1)/Math.max(1,dstCols-1), sy=(srcRows-1)/Math.max(1,dstRows-1);
  for(let y=0;y<dstRows;y++){
    const fy=y*sy,y0=Math.floor(fy),y1=Math.min(srcRows-1,y0+1),wy=fy-y0;
    for(let x=0;x<dstCols;x++){
      const fx=x*sx,x0=Math.floor(fx),x1=Math.min(srcCols-1,x0+1),wx=fx-x0;
      const a=source[y0*srcCols+x0]*(1-wx)+source[y0*srcCols+x1]*wx;
      const b=source[y1*srcCols+x0]*(1-wx)+source[y1*srcCols+x1]*wx;
      out[y*dstCols+x]=Math.max(0,Math.min(255,Math.round(a*(1-wy)+b*wy)));
    }
  }
  return out;
}

function resampleVolume(sourcePlanes,sourceMeta,outputMeta){
  if(sourceMeta.sliceCount===outputMeta.sliceCount&&sourceMeta.rows===outputMeta.rows&&sourceMeta.columns===outputMeta.columns){
    return Buffer.concat(sourcePlanes);
  }
  const resized=sourcePlanes.map(plane=>resizePlaneBilinear(plane,sourceMeta.rows,sourceMeta.columns,outputMeta.rows,outputMeta.columns));
  const dstPlane=outputMeta.rows*outputMeta.columns;
  const out=Buffer.alloc(outputMeta.sliceCount*dstPlane);
  const zScale=(sourceMeta.sliceCount-1)/Math.max(1,outputMeta.sliceCount-1);
  for(let z=0;z<outputMeta.sliceCount;z++){
    const fz=z*zScale,z0=Math.floor(fz),z1=Math.min(sourceMeta.sliceCount-1,z0+1),w=fz-z0;
    const a=resized[z0],b=resized[z1],base=z*dstPlane;
    if(z0===z1){a.copy(out,base);continue;}
    for(let i=0;i<dstPlane;i++)out[base+i]=Math.round(a[i]*(1-w)+b[i]*w);
  }
  return out;
}

export function decodeDemoJpegTransport(body,sourceMeta=DEMO_TRANSPORT_META,outputMeta=null){
  const bundle=gunzipSync(body);
  const images=parseJpegBundle(bundle);
  const actualSourceMeta={...sourceMeta,sliceCount:images.length};
  const sourcePlanes=images.map(image=>{
    const decoded=jpeg.decode(image,{useTArray:true,formatAsRGBA:true});
    if(decoded.width!==sourceMeta.columns||decoded.height!==sourceMeta.rows)throw new Error("Dimensão JPEG do demo inválida.");
    const plane=Buffer.alloc(sourceMeta.rows*sourceMeta.columns);
    for(let i=0;i<plane.length;i++)plane[i]=decoded.data[i*4];
    return plane;
  });
  const target=outputMeta||((sourceMeta===DEMO_TRANSPORT_META)?DEMO_OUTPUT_META:actualSourceMeta);
  return gzipSync(resampleVolume(sourcePlanes,actualSourceMeta,target),{level:6});
}

export async function bootstrapDemoVolumeFromEnv({env=process.env,putObject=putPrivateObject,decodeTransport=decodeDemoJpegTransport,decryptAsset=decryptDemoTransportAsset}={}){
  let transport=collectDemoVolumeFromEnv(env),source="env";
  if(!transport&&env.DEMO_CBCT_ASSET_KEY){transport=await decryptAsset({keyHex:env.DEMO_CBCT_ASSET_KEY});source="encrypted-asset";}
  if(!transport)return {uploaded:false,reason:"no-demo-source"};
  const expected=String(env.DEMO_CBCT_SHA256||DEMO_VOLUME_SHA256).trim().toLowerCase();
  const actual=digest(transport);
  if(!/^[a-f0-9]{64}$/.test(expected)||actual!==expected)throw new Error("Integridade do demo CBCT inválida (sha256 não confere).");
  const body=Buffer.from(await decodeTransport(transport));
  if(!body.length)throw new Error("Volume demo decodificado vazio.");
  await putObject({key:DEMO_VOLUME_KEY,body,contentType:"application/gzip"});
  return {uploaded:true,source,sizeBytes:body.length,transportSizeBytes:transport.length,sha256:actual,key:DEMO_VOLUME_KEY};
}

async function bodyToBuffer(body){
  if(!body)return Buffer.alloc(0);
  if(typeof body.transformToByteArray==="function")return Buffer.from(await body.transformToByteArray());
  const chunks=[];for await(const chunk of body)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);
}
function bearer(req){const header=String(req.headers.authorization||"");return header.startsWith("Bearer ")?header.slice(7):null;}

export function createDemoVolumeRouter({jwtSecret,getObject=getPrivateObject,isStorageReady=storageReady}={}){
  if(!jwtSecret)throw new Error("JWT secret obrigatório para o demo privado.");
  const router=express.Router();
  router.get("/api/demo/volume",async(req,res,next)=>{
    try{
      const token=bearer(req);if(!token)return res.status(401).json({error:"Autenticação necessária."});
      let auth;try{auth=jwt.verify(token,jwtSecret);}catch{return res.status(401).json({error:"Sessão inválida ou expirada."});}
      if(!["DENTIST","ADMIN"].includes(String(auth?.role||"")))return res.status(403).json({error:"Demo disponível apenas para dentistas e administradores."});
      if(!isStorageReady())return res.status(503).json({error:"Volume demo ainda não está disponível."});
      const object=await getObject(DEMO_VOLUME_KEY),bytes=await bodyToBuffer(object?.Body);
      if(!bytes.length)return res.status(503).json({error:"Volume demo vazio ou indisponível."});
      res.set("Content-Type","application/gzip");res.set("Content-Length",String(bytes.length));res.set("Cache-Control","private, no-store");res.set("X-Content-Type-Options","nosniff");res.set("Content-Disposition","inline; filename=odontoview-demo-volume.gz");res.send(bytes);
    }catch(error){next(error);}
  });
  return router;
}
