import {GetObjectCommand,PutObjectCommand,S3Client} from "@aws-sdk/client-s3";

let client=null;

function required(name){
  const value=process.env[name];
  if(!value) throw new Error("Storage privado não configurado: "+name);
  return value;
}

function storage(){
  if(client)return client;
  client=new S3Client({
    region:required("S3_REGION"),
    endpoint:required("S3_ENDPOINT"),
    forcePathStyle:true,
    credentials:{
      accessKeyId:required("S3_ACCESS_KEY_ID"),
      secretAccessKey:required("S3_SECRET_ACCESS_KEY")
    }
  });
  return client;
}

export function storageReady(){
  return Boolean(
    process.env.S3_BUCKET&&process.env.S3_REGION&&process.env.S3_ENDPOINT&&
    process.env.S3_ACCESS_KEY_ID&&process.env.S3_SECRET_ACCESS_KEY
  );
}

export async function putPrivateObject({key,body,contentType="application/dicom"}){
  await storage().send(new PutObjectCommand({
    Bucket:required("S3_BUCKET"),
    Key:key,
    Body:body,
    ContentType:contentType,
    CacheControl:"private, no-store"
  }));
}

export async function getPrivateObject(key){
  const out=await storage().send(new GetObjectCommand({
    Bucket:required("S3_BUCKET"),
    Key:key
  }));
  return out;
}
