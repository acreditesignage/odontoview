const SESSION_STORAGE_KEY="odontoview_analytics_session";
const API_BASE=import.meta.env?.VITE_API_URL||(import.meta.env?.PROD?"":"http://localhost:3001");

function cleanOptional(value,max){
  const text=String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").trim();
  if(!text)return null;
  return text.slice(0,max);
}

export function sanitizeReferrer(value){
  const raw=String(value||"").trim();
  if(!raw)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="http:"&&url.protocol!=="https:")return null;
    return url.origin+url.pathname;
  }catch{return null;}
}

export function buildAnalyticsPayload({sessionKey,type,pathname="/",search="",referrer="",activeSeconds=0}={}){
  const rawPath=String(pathname||"/").trim();
  const route=rawPath.startsWith("/")&&rawPath.length<=240?rawPath:"/";
  const params=new URLSearchParams(String(search||""));
  return {
    sessionKey:String(sessionKey||"").slice(0,96),
    type:String(type||"PAGE_VIEW").toUpperCase(),
    route,
    referrer:sanitizeReferrer(referrer),
    utmSource:cleanOptional(params.get("utm_source"),120),
    utmMedium:cleanOptional(params.get("utm_medium"),120),
    utmCampaign:cleanOptional(params.get("utm_campaign"),180),
    activeSeconds:Math.max(0,Math.min(120,Math.round(Number(activeSeconds)||0)))
  };
}

function randomSessionKey(){
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  const random=Math.random().toString(36).slice(2);
  return "ov-"+Date.now().toString(36)+"-"+random+Math.random().toString(36).slice(2);
}

export function getAnalyticsSessionKey(storage=globalThis.sessionStorage){
  try{
    const existing=storage?.getItem?.(SESSION_STORAGE_KEY);
    if(existing&&existing.length>=16&&existing.length<=96)return existing;
    const created=randomSessionKey();
    storage?.setItem?.(SESSION_STORAGE_KEY,created);
    return created;
  }catch{return randomSessionKey();}
}

export async function trackAnalyticsEvent(type,{pathname,search,activeSeconds=0,referrer}={}){
  try{
    if(typeof window==="undefined")return false;
    const payload=buildAnalyticsPayload({
      sessionKey:getAnalyticsSessionKey(),
      type,
      pathname:pathname??window.location.pathname,
      search:search??window.location.search,
      referrer:referrer??document.referrer,
      activeSeconds
    });
    const headers={"Content-Type":"application/json"};
    const token=localStorage.getItem("odontoview_token");
    if(token)headers.Authorization="Bearer "+token;
    const response=await fetch(API_BASE+"/api/analytics/events",{
      method:"POST",headers,body:JSON.stringify(payload),keepalive:true,credentials:"same-origin"
    });
    return response.ok;
  }catch{return false;}
}

export const __analyticsClientTest={SESSION_STORAGE_KEY};
