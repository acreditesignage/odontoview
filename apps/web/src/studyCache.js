const DB_NAME="odontoview-medical-cache";
const DB_VERSION=1;
const STORE="studyFiles";
const MIN_LIMIT=256*1024*1024;
const DEFAULT_LIMIT=1024*1024*1024;
const MAX_LIMIT=2*1024*1024*1024;

function decodeJwtPayload(token){
  try{
    const part=String(token||"").split(".")[1];
    if(!part)return null;
    const padded=part.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((part.length+3)%4);
    return JSON.parse(decodeURIComponent(Array.from(atob(padded)).map(c=>"%"+c.charCodeAt(0).toString(16).padStart(2,"0")).join("")));
  }catch{return null}
}

export function currentStudyCacheScope(){
  const token=localStorage.getItem("odontoview_token");
  const payload=decodeJwtPayload(token);
  const sub=String(payload?.sub||"").trim();
  if(!sub)return null;
  return sub.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,120);
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in globalThis))return reject(new Error("Cache local indisponível neste navegador."));
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const store=db.createObjectStore(STORE,{keyPath:"key"});
        store.createIndex("scope","scope",{unique:false});
        store.createIndex("scopeTouched",["scope","touchedAt"],{unique:false});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Falha ao abrir cache local."));
  });
}

function idbRequest(req){
  return new Promise((resolve,reject)=>{
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Falha no cache local."));
  });
}

async function cacheLimitBytes(){
  try{
    const estimate=await navigator.storage?.estimate?.();
    const quota=Number(estimate?.quota)||0;
    if(quota>0)return Math.min(MAX_LIMIT,Math.max(MIN_LIMIT,Math.floor(quota*.35)));
  }catch{}
  return DEFAULT_LIMIT;
}

function makeKey(scope,studyId,fileId,version,sizeBytes){
  return [scope,studyId,fileId,version||"v1",Number(sizeBytes)||0].join("|");
}

async function getRecord(key){
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,"readonly");
    return await idbRequest(tx.objectStore(STORE).get(key));
  }finally{db.close()}
}

async function putRecord(record){
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,"readwrite");
    await idbRequest(tx.objectStore(STORE).put(record));
    await new Promise((resolve,reject)=>{
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }finally{db.close()}
}

async function deleteKeys(keys){
  if(!keys.length)return;
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,"readwrite");
    const store=tx.objectStore(STORE);
    keys.forEach(key=>store.delete(key));
    await new Promise((resolve,reject)=>{
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }finally{db.close()}
}

async function recordsForScope(scope){
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,"readonly");
    const index=tx.objectStore(STORE).index("scope");
    return await idbRequest(index.getAll(scope));
  }finally{db.close()}
}

async function evictScope(scope,incomingBytes=0){
  const records=await recordsForScope(scope);
  const limit=await cacheLimitBytes();
  let total=records.reduce((sum,item)=>sum+(Number(item.sizeBytes)||0),0);
  if(total+incomingBytes<=limit)return {total,limit,removed:0};
  const oldest=records.slice().sort((a,b)=>(a.touchedAt||0)-(b.touchedAt||0));
  const remove=[];
  for(const item of oldest){
    if(total+incomingBytes<=limit)break;
    remove.push(item.key);
    total-=Number(item.sizeBytes)||0;
  }
  await deleteKeys(remove);
  return {total,limit,removed:remove.length};
}

async function touchRecord(record){
  try{await putRecord({...record,touchedAt:Date.now()})}catch{}
}

export async function requestPersistentStudyStorage(){
  try{
    if(!navigator.storage?.persist)return false;
    return Boolean(await navigator.storage.persist());
  }catch{return false}
}

export async function cachedStudyBlob({studyId,fileMeta,version,fetcher}){
  const scope=currentStudyCacheScope();
  if(!scope||!studyId||!fileMeta?.id)return fetcher();
  const key=makeKey(scope,studyId,fileMeta.id,version,fileMeta.sizeBytes);
  try{
    const hit=await getRecord(key);
    if(hit?.blob instanceof Blob){
      touchRecord(hit);
      return new Blob([hit.blob],{type:fileMeta.contentType||hit.contentType||hit.blob.type||"application/octet-stream"});
    }
  }catch{}
  const blob=await fetcher();
  try{
    await evictScope(scope,blob.size||fileMeta.sizeBytes||0);
    await putRecord({
      key,scope,studyId,fileId:fileMeta.id,version:version||"v1",
      fileName:fileMeta.fileName||"",contentType:fileMeta.contentType||blob.type||"application/octet-stream",
      sizeBytes:blob.size||fileMeta.sizeBytes||0,touchedAt:Date.now(),blob
    });
  }catch(error){
    if(error?.name==="QuotaExceededError"){
      try{
        const records=await recordsForScope(scope);
        const oldest=records.slice().sort((a,b)=>(a.touchedAt||0)-(b.touchedAt||0));
        await deleteKeys(oldest.slice(0,Math.ceil(oldest.length/2)).map(x=>x.key));
        await putRecord({
          key,scope,studyId,fileId:fileMeta.id,version:version||"v1",
          fileName:fileMeta.fileName||"",contentType:fileMeta.contentType||blob.type||"application/octet-stream",
          sizeBytes:blob.size||fileMeta.sizeBytes||0,touchedAt:Date.now(),blob
        });
      }catch{}
    }
  }
  return blob;
}

export async function getStudyCacheStats(){
  const scope=currentStudyCacheScope();
  if(!scope)return {bytes:0,files:0,limit:0,persistent:false};
  let records=[];
  try{records=await recordsForScope(scope)}catch{}
  let persistent=false;
  try{persistent=Boolean(await navigator.storage?.persisted?.())}catch{}
  return {
    bytes:records.reduce((sum,item)=>sum+(Number(item.sizeBytes)||0),0),
    files:records.length,
    limit:await cacheLimitBytes(),
    persistent
  };
}

export async function clearCurrentUserStudyCache(){
  const scope=currentStudyCacheScope();
  if(!scope)return 0;
  const records=await recordsForScope(scope);
  await deleteKeys(records.map(x=>x.key));
  return records.length;
}
