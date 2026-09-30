import express from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const EVENT_TYPES=new Set(["PAGE_VIEW","HEARTBEAT","LOGIN","LOGOUT"]);
const ALLOWED_EVENT_FIELDS=new Set(["sessionKey","type","route","referrer","utmSource","utmMedium","utmCampaign","activeSeconds"]);
const DEFAULT_TIME_ZONE="America/Sao_Paulo";

function cleanText(value,max,{nullable=true}={}){
  if(value===null||value===undefined||value==="")return nullable?null:"";
  const text=String(value).replace(/[\u0000-\u001f\u007f]/g," ").trim();
  if(!text)return nullable?null:"";
  return text.length<=max?text:text.slice(0,max);
}
function cleanRoute(value){
  const route=String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").trim();
  if(!route||route.length>240||!route.startsWith("/"))return null;
  return route.split("?")[0].split("#")[0]||"/";
}
function cleanSessionKey(value){
  const key=String(value||"").trim();
  return /^[a-zA-Z0-9_-]{16,96}$/.test(key)?key:null;
}
function validEventPayload(body){
  if(!body||typeof body!=="object"||Array.isArray(body))return null;
  if(Object.keys(body).some(key=>!ALLOWED_EVENT_FIELDS.has(key)))return null;
  const sessionKey=cleanSessionKey(body.sessionKey);
  const type=String(body.type||"").toUpperCase();
  const route=cleanRoute(body.route);
  if(!sessionKey||!EVENT_TYPES.has(type)||!route)return null;
  const activeSeconds=Math.max(0,Math.min(120,Math.round(Number(body.activeSeconds)||0)));
  return {
    sessionKey,type,route,activeSeconds,
    referrer:cleanText(body.referrer,500),
    utmSource:cleanText(body.utmSource,120),
    utmMedium:cleanText(body.utmMedium,120),
    utmCampaign:cleanText(body.utmCampaign,180)
  };
}
function authPayload(req,jwtSecret){
  const header=String(req.headers.authorization||"");
  if(!header.startsWith("Bearer "))return null;
  try{
    const payload=jwt.verify(header.slice(7),jwtSecret);
    return payload&&payload.sub?payload:null;
  }catch{return null;}
}
function requireAdmin(jwtSecret){
  return (req,res,next)=>{
    const header=String(req.headers.authorization||"");
    if(!header.startsWith("Bearer "))return res.status(401).json({error:"Autenticação necessária."});
    try{
      const payload=jwt.verify(header.slice(7),jwtSecret);
      if(payload?.role!=="ADMIN")return res.status(403).json({error:"Acesso restrito ao administrador."});
      req.analyticsAdmin=payload;next();
    }catch{return res.status(401).json({error:"Sessão inválida ou expirada."});}
  };
}
function requestIp(req){
  const value=String(req.headers["x-real-ip"]||req.headers["x-forwarded-for"]||"").split(",")[0].trim();
  return value.slice(0,80)||null;
}
function isPrivateIp(ip){
  if(!ip)return true;
  return /^(127\.|10\.|192\.168\.|169\.254\.|::1$|fc|fd)/i.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}
function fingerprintIp(ip,secret){
  if(!ip)return null;
  return crypto.createHmac("sha256",secret).update(ip).digest("hex").slice(0,32);
}
function parseUserAgent(value){
  const ua=String(value||"");
  let deviceClass="desktop";
  if(/iPad|Tablet|Android(?!.*Mobile)/i.test(ua))deviceClass="tablet";
  else if(/Mobi|iPhone|Android.*Mobile/i.test(ua))deviceClass="mobile";
  let browser="Other";
  if(/Edg\//i.test(ua))browser="Edge";
  else if(/Firefox\//i.test(ua))browser="Firefox";
  else if(/Chrome\//i.test(ua)||/CriOS\//i.test(ua))browser="Chrome";
  else if(/Safari\//i.test(ua))browser="Safari";
  let operatingSystem="Other";
  if(/iPhone|iPad|iPod/i.test(ua))operatingSystem="iOS";
  else if(/Android/i.test(ua))operatingSystem="Android";
  else if(/Windows NT/i.test(ua))operatingSystem="Windows";
  else if(/Mac OS X/i.test(ua))operatingSystem="macOS";
  else if(/Linux/i.test(ua))operatingSystem="Linux";
  return {deviceClass,browser,operatingSystem};
}
function sourceFor(session){
  if(session?.utmSource)return session.utmSource;
  if(session?.referrer){
    try{return new URL(session.referrer).hostname.replace(/^www\./,"")||"referral";}catch{return "referral";}
  }
  return "direct";
}
function dayKey(date,timeZone=DEFAULT_TIME_ZONE){
  try{return new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(date));}
  catch{return new Date(date).toISOString().slice(0,10);}
}
function bucket(list,keyFn){
  const map=new Map();
  for(const item of list){const key=keyFn(item)||"Não informado";map.set(key,(map.get(key)||0)+1);}
  return [...map.entries()].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||String(a.label).localeCompare(String(b.label)));
}
function dateMinus(now,days){return new Date(now.getTime()-days*86400000);}
function safeGeo(value){return cleanText(value,120);}

export async function configuredGeoLookup(ip){
  const template=String(process.env.ANALYTICS_GEO_LOOKUP_URL||"").trim();
  if(!template||!ip||isPrivateIp(ip))return null;
  const url=template.includes("{ip}")?template.replace("{ip}",encodeURIComponent(ip)):template.replace(/\/$/,"")+"/"+encodeURIComponent(ip);
  let timer;
  try{
    const controller=new AbortController();
    timer=setTimeout(()=>controller.abort(),1200);
    const response=await fetch(url,{headers:{Accept:"application/json"},signal:controller.signal});
    if(!response.ok)return null;
    const data=await response.json();
    if(data?.success===false)return null;
    return {
      country:safeGeo(data.country_code||data.countryCode||data.country),
      region:safeGeo(data.region||data.regionName||data.state),
      city:safeGeo(data.city)
    };
  }catch{return null;}
  finally{if(timer)clearTimeout(timer);}
}

function adminOverview({sessions,events,now,rangeDays,timeZone}){
  const onlineCutoff=new Date(now.getTime()-5*60000);
  const sevenCutoff=dateMinus(now,7),thirtyCutoff=dateMinus(now,30),rangeCutoff=dateMinus(now,rangeDays);
  const todayKey=dayKey(now,timeZone);
  const pageEvents=events.filter(event=>event.type==="PAGE_VIEW"&&new Date(event.occurredAt)>=rangeCutoff);
  const inRangeSessions=sessions.filter(session=>new Date(session.lastSeenAt)>=rangeCutoff);
  const dailyMap=new Map();
  for(let i=rangeDays-1;i>=0;i--){const date=dateMinus(now,i);dailyMap.set(dayKey(date,timeZone),{day:dayKey(date,timeZone),sessions:0,pageViews:0});}
  for(const session of inRangeSessions){const key=dayKey(session.startedAt||session.lastSeenAt,timeZone);if(dailyMap.has(key))dailyMap.get(key).sessions++;}
  for(const event of pageEvents){const key=dayKey(event.occurredAt,timeZone);if(dailyMap.has(key))dailyMap.get(key).pageViews++;}
  const regionLabel=session=>[session.city,session.region,session.country].filter(Boolean).join(" / ")||"Não informado";
  return {
    onlineNow:sessions.filter(session=>new Date(session.lastSeenAt)>=onlineCutoff).length,
    uniqueToday:sessions.filter(session=>dayKey(session.lastSeenAt,timeZone)===todayKey).length,
    unique7d:sessions.filter(session=>new Date(session.lastSeenAt)>=sevenCutoff).length,
    unique30d:sessions.filter(session=>new Date(session.lastSeenAt)>=thirtyCutoff).length,
    pageViews:pageEvents.length,
    dailySeries:[...dailyMap.values()],
    topRoutes:bucket(pageEvents,event=>event.route).slice(0,10),
    topRegions:bucket(inRangeSessions,regionLabel).slice(0,10),
    deviceBreakdown:bucket(inRangeSessions,session=>session.deviceClass||"unknown"),
    sourceBreakdown:bucket(inRangeSessions,sourceFor)
  };
}
function publicSession(session,now){
  return {
    user:session.user?{id:session.user.id,name:session.user.name,email:session.user.email,role:session.user.role}:null,
    role:session.user?.role||"ANONYMOUS",
    route:session.currentRoute,
    location:{country:session.country||null,region:session.region||null,city:session.city||null},
    device:{class:session.deviceClass||"unknown",browser:session.browser||"Other",os:session.operatingSystem||"Other"},
    source:sourceFor(session),
    firstSeen:session.startedAt,
    lastSeen:session.lastSeenAt,
    durationSeconds:Math.max(0,Number(session.activeSeconds)||0),
    online:new Date(session.lastSeenAt)>=new Date(now.getTime()-5*60000)
  };
}

export function createAnalyticsRouter({prismaClient,jwtSecret,geoLookup=configuredGeoLookup,now=()=>new Date(),timeZone=process.env.ANALYTICS_TIME_ZONE||DEFAULT_TIME_ZONE}={}){
  if(!prismaClient)throw new Error("prismaClient é obrigatório para analytics.");
  if(!jwtSecret)throw new Error("jwtSecret é obrigatório para analytics.");
  const router=express.Router();
  const admin=requireAdmin(jwtSecret);
  const rate=new Map();
  const safe=handler=>async(req,res)=>{try{await handler(req,res);}catch(error){console.error("analytics",error);if(!res.headersSent)res.status(500).json({error:"Analytics temporariamente indisponível."});}};

  router.post("/api/analytics/events",safe(async(req,res)=>{
    const payload=validEventPayload(req.body);
    if(!payload)return res.status(400).json({error:"Evento de analytics inválido."});
    const minute=Math.floor(now().getTime()/60000),rateKey=payload.sessionKey+":"+minute,count=(rate.get(rateKey)||0)+1;
    rate.set(rateKey,count);
    if(rate.size>2000)for(const key of rate.keys())if(!key.endsWith(":"+minute))rate.delete(key);
    if(count>120)return res.status(429).json({error:"Muitos eventos de analytics."});

    const seenAt=now();
    const auth=authPayload(req,jwtSecret);
    const existing=await prismaClient.analyticsSession.findUnique({where:{sessionKey:payload.sessionKey}});
    let session;
    if(existing){
      session=await prismaClient.analyticsSession.update({
        where:{id:existing.id},
        data:{
          lastSeenAt:seenAt,currentRoute:payload.route,
          ...(auth?.sub?{userId:String(auth.sub)}:{}),
          ...(payload.activeSeconds>0?{activeSeconds:{increment:payload.activeSeconds}}:{})
        }
      });
    }else{
      const ip=requestIp(req);
      let geo=null;
      try{geo=await geoLookup(ip,req);}catch{}
      const agent=parseUserAgent(req.headers["user-agent"]);
      session=await prismaClient.analyticsSession.create({data:{
        sessionKey:payload.sessionKey,userId:auth?.sub?String(auth.sub):null,
        startedAt:seenAt,lastSeenAt:seenAt,firstRoute:payload.route,currentRoute:payload.route,
        referrer:payload.referrer,utmSource:payload.utmSource,utmMedium:payload.utmMedium,utmCampaign:payload.utmCampaign,
        ...agent,country:safeGeo(geo?.country),region:safeGeo(geo?.region),city:safeGeo(geo?.city),
        networkFingerprint:fingerprintIp(ip,process.env.ANALYTICS_HMAC_SECRET||jwtSecret),activeSeconds:payload.activeSeconds
      }});
    }
    await prismaClient.analyticsEvent.create({data:{sessionId:session.id,type:payload.type,route:payload.route,occurredAt:seenAt}});
    return res.status(202).json({ok:true});
  }));

  router.get("/api/admin/analytics/overview",admin,safe(async(req,res)=>{
    const rangeDays=String(req.query.range||"7d")==="30d"?30:7;
    const nowValue=now(),thirtyCutoff=dateMinus(nowValue,30);
    const [sessions,events]=await Promise.all([
      prismaClient.analyticsSession.findMany({where:{lastSeenAt:{gte:thirtyCutoff}},include:{user:{select:{id:true,name:true,email:true,role:true}}}}),
      prismaClient.analyticsEvent.findMany({where:{occurredAt:{gte:dateMinus(nowValue,rangeDays)},type:"PAGE_VIEW"}})
    ]);
    res.set("Cache-Control","no-store");
    res.json(adminOverview({sessions,events,now:nowValue,rangeDays,timeZone}));
  }));

  router.get("/api/admin/analytics/recent",admin,safe(async(req,res)=>{
    const limit=Math.max(1,Math.min(100,Number(req.query.limit)||50)),nowValue=now();
    const sessions=await prismaClient.analyticsSession.findMany({orderBy:{lastSeenAt:"desc"},take:limit,include:{user:{select:{id:true,name:true,email:true,role:true}}}});
    res.set("Cache-Control","no-store");
    res.json({sessions:sessions.map(session=>publicSession(session,nowValue))});
  }));

  return router;
}

export const __analyticsTest={validEventPayload,parseUserAgent,sourceFor,dayKey,adminOverview,publicSession,fingerprintIp};
