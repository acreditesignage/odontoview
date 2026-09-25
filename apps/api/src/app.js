import "dotenv/config";
import express from "express";
import path from "node:path";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { prisma } from "./prisma.js";
import { createAccessToken, resolveAccessToken, newToken, hashToken } from "./token.js";
import { deletePrivateObject, getPrivateObject, putPrivateObject, storageReady } from "./storage.js";

const auth=(req,res,next)=>{
  const h=req.headers.authorization||"", token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({error:"Autenticação necessária."});
  try{ req.auth=jwt.verify(token,process.env.JWT_SECRET); next(); }
  catch{ res.status(401).json({error:"Sessão inválida ou expirada."}); }
};
const dentistFor=(userId)=>prisma.dentist.findUnique({where:{userId}});
const unitMembershipFor=(userId)=>prisma.unitMembership.findFirst({
  where:{userId,active:true,unit:{active:true}},
  include:{unit:{include:{organization:true}}}
});
const sign=(user)=>jwt.sign({sub:user.id,role:user.role,email:user.email},process.env.JWT_SECRET,{expiresIn:"8h"});

function cleanOptionalText(value,max=180){
  const text=String(value||"").trim();
  return text?text.slice(0,max):null;
}
function cleanOptionalEmail(value){
  const email=String(value||"").trim().toLowerCase();
  if(!email)return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}
function escapeHtml(value){
  return String(value||"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function requestBaseUrl(req){
  const configured=String(process.env.PUBLIC_APP_URL||"").trim().replace(/\/+$/,"");
  return configured||(`${req.protocol}://${req.get("host")}`);
}
async function resolveStudyDeliveryTarget(study){
  if(study?.order?.dentist){
    const dentist=study.order.dentist;
    return {
      name:dentist.user?.name||"Dentista solicitante",
      cro:[dentist.cro,dentist.uf].filter(Boolean).join("/"),
      email:cleanOptionalEmail(dentist.user?.email)
    };
  }
  const patient=study?.patient||{};
  return {
    name:patient.referringDentistName||"Dentista solicitante",
    cro:patient.referringDentistCro||"",
    email:cleanOptionalEmail(patient.referringDentistEmail)
  };
}
async function buildStudyDentistDelivery(req,studyId,{sendEmail=true}={}){
  const study=await prisma.examStudy.findUnique({
    where:{id:studyId},
    include:{
      patient:true,
      examType:true,
      unit:{include:{organization:true}},
      order:{include:{dentist:{include:{user:true}}}}
    }
  });
  if(!study||study.status!=="READY") return {status:"NOT_READY",error:"Exame ainda não está pronto."};

  const target=await resolveStudyDeliveryTarget(study);
  const rawToken=newToken();
  const expiresAt=new Date(Date.now()+30*24*3600000);
  await prisma.dentistInvite.create({data:{
    patientId:study.patientId,
    studyId:study.id,
    unitId:study.unitId||null,
    tokenHash:hashToken(rawToken),
    expiresAt
  }});
  const viewerUrl=requestBaseUrl(req)+"/acesso-exame?token="+encodeURIComponent(rawToken);
  const qrDataUrl=await QRCode.toDataURL(viewerUrl,{width:360,margin:1,errorCorrectionLevel:"M"});
  const email=target.email;

  if(!email){
    await prisma.examStudy.update({where:{id:study.id},data:{
      dentistDeliveryStatus:"NO_EMAIL",dentistDeliveryEmail:null,dentistDeliverySentAt:null,
      dentistDeliveryError:"Dentista solicitante sem e-mail cadastrado."
    }});
    return {status:"NO_EMAIL",viewerUrl,qrDataUrl,expiresAt,target};
  }

  const apiKey=String(process.env.RESEND_API_KEY||"").trim();
  const from=String(process.env.ODONTOVIEW_FROM_EMAIL||"").trim();
  if(!sendEmail||!apiKey||!from){
    await prisma.examStudy.update({where:{id:study.id},data:{
      dentistDeliveryStatus:"READY",dentistDeliveryEmail:email,dentistDeliverySentAt:null,
      dentistDeliveryError:sendEmail?"Envio automático aguardando configuração de e-mail.":null
    }});
    return {status:"READY",viewerUrl,qrDataUrl,expiresAt,target,emailConfigured:Boolean(apiKey&&from)};
  }

  const patientName=escapeHtml(study.patient?.name||"Paciente");
  const examName=escapeHtml(study.examType?.name||study.modality||"Exame odontológico");
  const dentistName=escapeHtml(target.name||"Doutor(a)");
  const unitName=escapeHtml(study.unit?.name||study.unit?.organization?.name||"OdontoView");
  const html=`<!doctype html><html><body style="margin:0;background:#f2f7fa;font-family:Arial,sans-serif;color:#15364d">
    <div style="max-width:620px;margin:0 auto;padding:28px 18px">
      <div style="background:#ffffff;border:1px solid #dce8ef;border-radius:18px;padding:26px">
        <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#168bd2">ODONTOVIEW</div>
        <h1 style="font-size:24px;margin:10px 0 8px">Exame disponível no Viewer</h1>
        <p style="font-size:15px;line-height:1.55;margin:0 0 18px">Olá, ${dentistName}. O exame de <strong>${patientName}</strong> já está disponível.</p>
        <div style="padding:14px 16px;border-radius:12px;background:#f6fafc;margin-bottom:18px">
          <div><strong>Exame:</strong> ${examName}</div>
          <div style="margin-top:5px"><strong>Radiologia:</strong> ${unitName}</div>
        </div>
        <a href="${viewerUrl}" style="display:inline-block;padding:13px 20px;border-radius:11px;background:#168bd2;color:#fff;text-decoration:none;font-weight:800">Abrir no OdontoView Viewer</a>
        <p style="font-size:12px;color:#718696;line-height:1.5;margin:18px 0 0">O QR Code para o mesmo acesso está anexado a este e-mail. O link é pessoal e expira em 30 dias.</p>
      </div>
    </div></body></html>`;

  try{
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({
        from,
        to:[email],
        subject:"Exame disponível no OdontoView — "+(study.patient?.name||"Paciente"),
        html,
        attachments:[{filename:"odontoview-qr.png",content:String(qrDataUrl).split(",")[1]||""}]
      })
    });
    if(!response.ok){
      const detail=await response.text();
      throw new Error("Falha no serviço de e-mail ("+response.status+"): "+detail.slice(0,240));
    }
    await prisma.examStudy.update({where:{id:study.id},data:{
      dentistDeliveryStatus:"SENT",dentistDeliveryEmail:email,dentistDeliverySentAt:new Date(),dentistDeliveryError:null
    }});
    return {status:"SENT",viewerUrl,qrDataUrl,expiresAt,target,emailConfigured:true};
  }catch(error){
    await prisma.examStudy.update({where:{id:study.id},data:{
      dentistDeliveryStatus:"FAILED",dentistDeliveryEmail:email,dentistDeliverySentAt:null,
      dentistDeliveryError:String(error?.message||"Falha no envio.").slice(0,500)
    }});
    return {status:"FAILED",viewerUrl,qrDataUrl,expiresAt,target,error:String(error?.message||"Falha no envio.")};
  }
}
const dentistPatientWhere=(dentistId,patientId)=>({
  id:patientId,
  OR:[
    {createdByDentistId:dentistId},
    {dentistAccess:{some:{dentistId}}}
  ]
});
function isDicomSource(value){
  return ["DICOM","ZIP","RAR"].includes(String(value||"").toUpperCase());
}
function sanitizeDocumentationLayout(value,files=[]){
  if(!value||typeof value!=="object"||Array.isArray(value)) return null;
  const templates=new Set(["PERIAPICAL_14_BW_4","PERIAPICAL_14"]);
  const template=templates.has(String(value.template||""))?String(value.template):"PERIAPICAL_14_BW_4";
  const validFiles=new Set((files||[]).map(file=>file.id));
  const slots={};
  const raw=value.slots&&typeof value.slots==="object"&&!Array.isArray(value.slots)?value.slots:{};
  for(const [slotId,fileId] of Object.entries(raw)){
    const safeSlot=String(slotId||"").slice(0,40);
    const safeFile=String(fileId||"");
    if(/^[a-z0-9_-]+$/i.test(safeSlot)&&validFiles.has(safeFile)) slots[safeSlot]=safeFile;
  }
  const complementaryTypes={};
  const allowedComplementaryTypes=new Set(["BOARD","RADIOGRAPH","OTHER"]);
  const rawComplementary=value.complementaryTypes&&typeof value.complementaryTypes==="object"&&!Array.isArray(value.complementaryTypes)?value.complementaryTypes:{};
  for(const [fileId,type] of Object.entries(rawComplementary)){
    const safeFile=String(fileId||"");
    const safeType=String(type||"").toUpperCase();
    if(validFiles.has(safeFile)&&allowedComplementaryTypes.has(safeType)) complementaryTypes[safeFile]=safeType;
  }
  return {version:1,template,slots,complementaryTypes};
}
function safeUploadContentType(value){
  const raw=String(value||"application/octet-stream").trim().toLowerCase().slice(0,120);
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(raw)?raw:"application/octet-stream";
}
function safeUploadExtension(fileName,contentType){
  const match=String(fileName||"").match(/\.([a-z0-9]{1,10})$/i);
  if(match)return "."+match[1].toLowerCase();
  if(contentType==="application/dicom")return ".dcm";
  if(contentType==="application/pdf")return ".pdf";
  if(contentType==="image/jpeg")return ".jpg";
  if(contentType==="image/png")return ".png";
  if(contentType==="image/webp")return ".webp";
  return ".bin";
}


function cleanAiText(value,max=180){
  return String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
function sanitizeAiBox(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const n=(key)=>Math.max(0,Math.min(1,Number(value[key])||0));
  const x=n("x"),y=n("y"),w=n("w"),h=n("h");
  if(w<=0||h<=0)return null;
  return {x,y,w,h};
}
function sanitizeAiFindings(findings,files=[]){
  const validFiles=new Set((files||[]).map(file=>file.id));
  return (Array.isArray(findings)?findings:[]).slice(0,100).map((finding,index)=>{
    const fileId=String(finding?.fileId||"");
    if(!validFiles.has(fileId))return null;
    const confidence=Math.max(0,Math.min(1,Number(finding?.confidence)||0));
    return {
      id:cleanAiText(finding?.id,80)||("finding-"+String(index+1).padStart(3,"0")),
      fileId,
      label:cleanAiText(finding?.label,140)||"Região para revisão",
      category:cleanAiText(finding?.category,80)||"REVIEW",
      summary:cleanAiText(finding?.summary,320),
      confidence,
      bbox:sanitizeAiBox(finding?.bbox),
      status:["CONFIRMED","REJECTED","EDITED"].includes(String(finding?.status||"").toUpperCase())
        ? String(finding.status).toUpperCase()
        : "SUGGESTED"
    };
  }).filter(Boolean);
}
function aiAnalysisPayload({status,provider=null,model=null,findings=[],message=null,requestedAt=null,completedAt=null}={}){
  return {
    version:1,
    status:cleanAiText(status,40)||"IDLE",
    provider:provider?cleanAiText(provider,80):null,
    model:model?cleanAiText(model,120):null,
    findings,
    message:message?cleanAiText(message,500):null,
    requestedAt:requestedAt||null,
    completedAt:completedAt||null,
    professionalReviewRequired:true
  };
}
function demoFileByCode(files,codes=[]){
  const list=(files||[]).filter(file=>String(file.contentType||"").startsWith("image/"));
  for(const code of codes){
    const rx=new RegExp("(^|\\D)"+String(code)+"(\\D|$)");
    const hit=list.find(file=>rx.test(String(file.fileName||"")));
    if(hit)return hit;
  }
  return null;
}
function buildDemoAiFindings(study){
  const files=(study.files||[]).filter(file=>String(file.contentType||"").startsWith("image/"));
  if(!files.length)return [];

  const byCode=(...codes)=>demoFileByCode(files,codes);
  const fallback=index=>files[Math.max(0,Math.min(files.length-1,index))]||files[0];
  const implantPosterior=byCode("38","48","47")||fallback(files.length-1);
  const implantBitewing=byCode("04","03")||fallback(Math.max(0,files.length-3));
  const restoration=byCode("01","02","17","28")||fallback(0);
  const endo=byCode("21","32","13","33")||fallback(Math.min(2,files.length-1));

  const raw=[
    {
      id:"demo-implant-posterior",
      fileId:implantPosterior?.id,
      label:"Implante dentário",
      category:"IMPLANT",
      summary:"DEMO: estrutura radiopaca compatível visualmente com implante. Exemplo de marcação, não é análise clínica.",
      confidence:0.98,
      bbox:{x:0.48,y:0.15,w:0.34,h:0.70},
      status:"SUGGESTED",
      demo:true
    },
    {
      id:"demo-implant-bitewing",
      fileId:implantBitewing?.id,
      label:"Implante dentário",
      category:"IMPLANT",
      summary:"DEMO: exemplo de reconhecimento de implante em radiografia posterior.",
      confidence:0.96,
      bbox:{x:0.58,y:0.28,w:0.25,h:0.58},
      status:"SUGGESTED",
      demo:true
    },
    {
      id:"demo-restoration",
      fileId:restoration?.id,
      label:"Restauração radiopaca",
      category:"RESTORATION",
      summary:"DEMO: material restaurador radiopaco destacado para demonstrar o fluxo de achados.",
      confidence:0.91,
      bbox:{x:0.18,y:0.20,w:0.34,h:0.27},
      status:"SUGGESTED",
      demo:true
    },
    {
      id:"demo-endo",
      fileId:endo?.id,
      label:"Tratamento endodôntico",
      category:"ENDO",
      summary:"DEMO: região destacada apenas para demonstrar a experiência de revisão profissional.",
      confidence:0.88,
      bbox:{x:0.34,y:0.16,w:0.24,h:0.62},
      status:"SUGGESTED",
      demo:true
    }
  ];
  const seen=new Set();
  return raw.filter(item=>{
    if(!item.fileId)return false;
    const key=item.id+"::"+item.fileId;
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}

async function requestExternalDentalAi(study){
  const endpoint=String(process.env.ODONTOVIEW_AI_ENDPOINT||"").trim();
  if(!endpoint)return {configured:false};
  const token=String(process.env.ODONTOVIEW_AI_TOKEN||"").trim();
  const form=new FormData();
  const imageFiles=(study.files||[]).filter(file=>String(file.contentType||"").startsWith("image/")).slice(0,40);
  if(!imageFiles.length)throw new Error("A análise inicial do OdontoView AI aceita documentações 2D em formato de imagem.");
  const metadata={studyId:study.id,examType:study.examType?.name||null,files:imageFiles.map(file=>({id:file.id,fileName:file.fileName,contentType:file.contentType}))};
  form.append("metadata",JSON.stringify(metadata));
  for(const file of imageFiles){
    const object=await getPrivateObject(file.objectKey);
    const bytes=await object.Body.transformToByteArray();
    form.append("file_"+file.id,new Blob([bytes],{type:file.contentType||"application/octet-stream"}),file.fileName||file.id+".bin");
  }
  const response=await fetch(endpoint,{
    method:"POST",
    headers:token?{Authorization:"Bearer "+token}:undefined,
    body:form,
    signal:AbortSignal.timeout(120000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(cleanAiText(data?.error||data?.message||("Motor de IA respondeu "+response.status),300));
  return {
    configured:true,
    provider:cleanAiText(data?.provider||"external-dental-ai",80),
    model:cleanAiText(data?.model||"",120)||null,
    findings:sanitizeAiFindings(data?.findings,study.files)
  };
}

export function createApp(){
  const app=express();
  app.set("trust proxy",1);
  app.disable("x-powered-by");
  app.use(cors({origin:process.env.CORS_ORIGIN||"http://localhost:5173"}));
  app.use(express.json({limit:"1mb"}));
  app.get("/health",(_req,res)=>res.json({ok:true,service:"odontoview-network-api"}));

  app.post("/api/auth/register-dentist",async(req,res,next)=>{
    try{
      const {name,email,password,phone,cro,uf}=req.body;
      if(!name||!email||!password||!cro||!uf) return res.status(400).json({error:"Nome, email, senha, CRO e UF são obrigatórios."});
      if(password.length<8) return res.status(400).json({error:"A senha deve ter pelo menos 8 caracteres."});
      const user=await prisma.user.create({data:{
        name,email:email.toLowerCase().trim(),phone:phone||null,passwordHash:await bcrypt.hash(password,12),role:"DENTIST",
        dentist:{create:{cro:String(cro).trim(),uf:String(uf).trim().toUpperCase()}}
      },include:{dentist:true}});
      res.status(201).json({
        token:sign(user),
        user:{id:user.id,name:user.name,email:user.email,role:user.role},
        dentist:user.dentist
      });
    }catch(e){ if(e?.code==="P2002") return res.status(409).json({error:"Email ou CRO já cadastrado."}); next(e); }
  });

  app.post("/api/auth/login",async(req,res,next)=>{
    try{
      const user=await prisma.user.findUnique({
        where:{email:String(req.body.email||"").toLowerCase().trim()},
        include:{dentist:true,unitMemberships:{where:{active:true},take:1,include:{unit:{include:{organization:true}}}}}
      });
      if(!user||!(await bcrypt.compare(req.body.password||"",user.passwordHash))) return res.status(401).json({error:"Email ou senha inválidos."});
      if(!["DENTIST","UNIT_USER"].includes(user.role)) return res.status(403).json({error:"Perfil ainda não possui acesso a esta aplicação."});
      const membership=user.unitMemberships?.[0]||null;
      if(user.role==="UNIT_USER"&&!membership) return res.status(403).json({error:"Usuário da radiologia sem unidade ativa."});
      res.json({
        token:sign(user),
        user:{id:user.id,name:user.name,email:user.email,role:user.role},
        dentist:user.dentist,
        unit:membership?.unit||null
      });
    }catch(e){next(e);}
  });

  app.get("/api/catalog/exam-types",async(_req,res,next)=>{
    try{res.json(await prisma.examType.findMany({where:{active:true},orderBy:{name:"asc"}}));}catch(e){next(e);}
  });

  app.get("/api/patients",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub); if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      res.json(await prisma.patient.findMany({where:{createdByDentistId:dentist.id},orderBy:{name:"asc"}}));
    }catch(e){next(e);}
  });

  app.post("/api/patients",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub); if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      if(!req.body.name) return res.status(400).json({error:"Nome do paciente é obrigatório."});
      const patient=await prisma.patient.create({data:{
        name:req.body.name.trim(),birthDate:req.body.birthDate?new Date(req.body.birthDate):null,phone:req.body.phone||null,email:req.body.email||null,createdByDentistId:dentist.id
      }});
      res.status(201).json(patient);
    }catch(e){next(e);}
  });

  app.get("/api/dentist/dashboard",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await prisma.dentist.findUnique({
        where:{userId:req.auth.sub},
        include:{user:{select:{id:true,name:true,email:true,phone:true}}}
      });
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const [patients,orders,directStudies]=await Promise.all([
        prisma.patient.findMany({
          where:{OR:[
            {createdByDentistId:dentist.id},
            {dentistAccess:{some:{dentistId:dentist.id}}}
          ]},
          orderBy:{createdAt:"desc"},
          take:150
        }),
        prisma.order.findMany({
          where:{dentistId:dentist.id},
          include:{
            patient:{select:{id:true,name:true,phone:true,birthDate:true}},
            examType:true,
            unit:{include:{organization:true}},
            appointment:{include:{availability:true}},
            study:{select:{id:true,status:true,modality:true,manufacturer:true,model:true,seriesCount:true,fileCount:true,totalBytes:true,completedAt:true}}
          },
          orderBy:{requestedAt:"desc"},
          take:100
        }),
        prisma.examStudy.findMany({
          where:{ownerDentistId:dentist.id,status:"READY"},
          include:{patient:{select:{id:true,name:true,phone:true,birthDate:true}},examType:true},
          orderBy:{createdAt:"desc"},
          take:100
        })
      ]);
      res.json({
        dentist:{id:dentist.id,cro:dentist.cro,uf:dentist.uf,user:dentist.user},
        patients,
        orders,
        directStudies
      });
    }catch(e){next(e);}
  });

  app.post("/api/orders",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub); if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const [patient,examType]=await Promise.all([
        prisma.patient.findFirst({where:dentistPatientWhere(dentist.id,req.body.patientId)}),
        prisma.examType.findFirst({where:{id:req.body.examTypeId,active:true}})
      ]);
      if(!patient) return res.status(404).json({error:"Paciente não encontrado."});
      if(!examType) return res.status(404).json({error:"Tipo de exame não encontrado."});
      const order=await prisma.$transaction(async tx=>{
        const created=await tx.order.create({data:{dentistId:dentist.id,patientId:patient.id,examTypeId:examType.id}});
        await tx.statusHistory.create({data:{orderId:created.id,status:"SOLICITADO",actorType:"DENTIST",actorId:dentist.id}});
        return created;
      });
      const access=await createAccessToken(prisma,order.id);
      const base=process.env.PATIENT_APP_URL||(`${req.protocol}://${req.get("host")}/paciente`);
      res.status(201).json({order,patientAccessUrl:base+"?token="+encodeURIComponent(access.rawToken),accessExpiresAt:access.expiresAt});
    }catch(e){next(e);}
  });

  app.get("/api/unit/me",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      res.json({
        user:{id:req.auth.sub,email:req.auth.email,role:req.auth.role},
        unit:membership.unit
      });
    }catch(e){next(e);}
  });

  app.get("/api/unit/patients",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const q=String(req.query.q||"").trim();
      const nameFilter=q?{contains:q,mode:"insensitive"}:undefined;

      const [localPatients,networkOrders]=await Promise.all([
        prisma.patient.findMany({
          where:{createdByUnitId:membership.unitId,...(nameFilter?{name:nameFilter}:{})},
          orderBy:{createdAt:"desc"},
          take:100
        }),
        prisma.order.findMany({
          where:{unitId:membership.unitId,...(nameFilter?{patient:{name:nameFilter}}:{})},
          select:{
            patient:true,
            requestedAt:true,
            dentist:{include:{user:{select:{name:true}}}}
          },
          orderBy:{requestedAt:"desc"},
          take:150
        })
      ]);

      const byId=new Map();
      for(const p of localPatients){
        byId.set(p.id,{...p,source:"RADIOLOGIA",sourceLabel:"Radiologia",dentist:null,lastNetworkAt:null});
      }
      for(const o of networkOrders){
        const current=byId.get(o.patient.id);
        const entry={
          ...o.patient,
          source:"ODONTOVIEW",
          sourceLabel:"OdontoView",
          dentist:{name:o.dentist.user.name,cro:o.dentist.cro,uf:o.dentist.uf},
          lastNetworkAt:o.requestedAt
        };
        if(!current||current.source!=="ODONTOVIEW") byId.set(o.patient.id,entry);
      }

      const patients=[...byId.values()].sort((a,b)=>{
        if(a.source!==b.source)return a.source==="ODONTOVIEW"?-1:1;
        return a.name.localeCompare(b.name,"pt-BR");
      });
      res.json({unit:membership.unit,patients});
    }catch(e){next(e);}
  });

  app.post("/api/unit/patients",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const name=String(req.body.name||"").trim();
      if(!name) return res.status(400).json({error:"Nome do paciente é obrigatório."});
      const patient=await prisma.patient.create({data:{
        name,
        birthDate:req.body.birthDate?new Date(req.body.birthDate):null,
        phone:req.body.phone||null,
        email:req.body.email||null,
        createdByUnitId:membership.unitId
      }});
      res.status(201).json({...patient,source:"RADIOLOGIA",sourceLabel:"Radiologia"});
    }catch(e){next(e);}
  });

  app.get("/api/unit/patients/:id",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const patient=await prisma.patient.findFirst({
        where:{
          id:req.params.id,
          OR:[
            {createdByUnitId:membership.unitId},
            {orders:{some:{unitId:membership.unitId}}}
          ]
        }
      });
      if(!patient) return res.status(404).json({error:"Paciente não encontrado nesta unidade."});
      const [orders,studies,examTypes]=await Promise.all([
        prisma.order.findMany({
          where:{patientId:patient.id,unitId:membership.unitId},
          include:{
            examType:true,
            dentist:{include:{user:{select:{name:true}}}},
            study:{select:{id:true,status:true,sourceType:true,modality:true,fileCount:true,totalBytes:true,completedAt:true}}
          },
          orderBy:{requestedAt:"desc"}
        }),
        prisma.examStudy.findMany({
          where:{patientId:patient.id,unitId:membership.unitId,status:"READY"},
          include:{examType:true},
          orderBy:{createdAt:"desc"}
        }),
        prisma.examType.findMany({where:{active:true},orderBy:{name:"asc"}})
      ]);
      res.json({
        patient,
        source:patient.createdByUnitId===membership.unitId?"RADIOLOGIA":"ODONTOVIEW",
        orders:orders.map(o=>({
          id:o.id,status:o.status,requestedAt:o.requestedAt,examType:o.examType,
          dentist:{name:o.dentist.user.name,cro:o.dentist.cro,uf:o.dentist.uf},
          study:o.study
        })),
        studies,
        examTypes
      });
    }catch(e){next(e);}
  });

  app.post("/api/unit/patients/:id/dentist-invite",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const patient=await prisma.patient.findFirst({
        where:{id:req.params.id,OR:[{createdByUnitId:membership.unitId},{orders:{some:{unitId:membership.unitId}}}]}
      });
      if(!patient) return res.status(404).json({error:"Paciente não encontrado nesta unidade."});
      let studyId=null;
      if(req.body?.studyId){
        const study=await prisma.examStudy.findFirst({where:{id:String(req.body.studyId),patientId:patient.id,unitId:membership.unitId,status:"READY"}});
        if(!study) return res.status(404).json({error:"Exame não encontrado para este paciente."});
        studyId=study.id;
      }
      const rawToken=newToken(),expiresAt=new Date(Date.now()+7*24*3600000);
      await prisma.dentistInvite.create({data:{
        patientId:patient.id,studyId,unitId:membership.unitId,tokenHash:hashToken(rawToken),expiresAt
      }});
      const base=`${req.protocol}://${req.get("host")}`;
      res.status(201).json({inviteUrl:base+"/convite-dentista?token="+encodeURIComponent(rawToken),expiresAt});
    }catch(e){next(e);}
  });

  app.post("/api/unit/patients/:id/studies",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const patient=await prisma.patient.findFirst({where:{id:req.params.id,createdByUnitId:membership.unitId}});
      if(!patient) return res.status(404).json({error:"Paciente local não encontrado nesta unidade."});
      const meta=req.body||{};
      const examType=meta.examTypeId?await prisma.examType.findFirst({where:{id:String(meta.examTypeId),active:true}}):null;
      const study=await prisma.examStudy.create({data:{
        patientId:patient.id,
        unitId:membership.unitId,
        examTypeId:examType?.id||null,
        sourceType:String(meta.sourceType||"DICOM").slice(0,24),
        sourceName:meta.sourceName?String(meta.sourceName).slice(0,180):null,
        modality:meta.modality?String(meta.modality).slice(0,32):null,
        manufacturer:meta.manufacturer?String(meta.manufacturer).slice(0,120):null,
        model:meta.model?String(meta.model).slice(0,120):null,
        seriesCount:Math.max(0,Number(meta.seriesCount)||0)
      }});
      res.status(201).json({study});
    }catch(e){next(e);}
  });

  app.get("/api/unit/agenda",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const from=new Date(String(req.query.from||""));
      const to=new Date(String(req.query.to||""));
      if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||to<=from) return res.status(400).json({error:"Período da agenda inválido."});

      const orders=await prisma.order.findMany({
        where:{
          unitId:membership.unitId,
          status:{in:["AGENDADO","PACIENTE_CHEGOU","EXAME_REALIZADO","IMAGENS_RECEBIDAS"]},
          appointment:{availability:{startAt:{gte:from,lt:to}}}
        },
        include:{
          patient:{select:{id:true,name:true,birthDate:true,phone:true}},
          examType:true,
          dentist:{include:{user:{select:{name:true}}}},
          appointment:{include:{availability:true}},
          study:{select:{id:true,status:true,sourceType:true,fileCount:true,totalBytes:true}}
        }
      });
      orders.sort((a,b)=>new Date(a.appointment.availability.startAt)-new Date(b.appointment.availability.startAt));
      res.json({
        unit:membership.unit,
        orders:orders.map(o=>({
          id:o.id,
          status:o.status,
          patient:o.patient,
          examType:o.examType,
          dentist:{name:o.dentist.user.name,cro:o.dentist.cro,uf:o.dentist.uf},
          appointment:o.appointment,
          study:o.study
        }))
      });
    }catch(e){next(e);}
  });

  app.patch("/api/unit/orders/:id/status",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const nextStatus=String(req.body.status||"");
      const transitions={
        AGENDADO:"PACIENTE_CHEGOU",
        PACIENTE_CHEGOU:"EXAME_REALIZADO"
      };
      const result=await prisma.$transaction(async tx=>{
        const order=await tx.order.findFirst({where:{id:req.params.id,unitId:membership.unitId}});
        if(!order){const e=new Error("Pedido não encontrado nesta unidade.");e.status=404;throw e;}
        if(transitions[order.status]!==nextStatus){
          const e=new Error("Transição de status inválida.");e.status=409;throw e;
        }
        const updated=await tx.order.update({where:{id:order.id},data:{status:nextStatus}});
        await tx.statusHistory.create({
          data:{orderId:order.id,status:nextStatus,actorType:"UNIT_USER",actorId:req.auth.sub}
        });
        return updated;
      });
      res.json({order:result});
    }catch(e){next(e);}
  });

  app.post("/api/unit/orders/:id/study",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const order=await prisma.order.findFirst({
        where:{id:req.params.id,unitId:membership.unitId},
        include:{study:true}
      });
      if(!order) return res.status(404).json({error:"Pedido não encontrado nesta unidade."});
      if(!["EXAME_REALIZADO","IMAGENS_RECEBIDAS"].includes(order.status)) return res.status(409).json({error:"O exame precisa estar marcado como realizado antes do envio."});
      if(order.study?.status==="READY") return res.status(409).json({error:"Este pedido já possui um exame enviado."});

      const meta=req.body||{};
      const study=order.study
        ? await prisma.examStudy.update({where:{id:order.study.id},data:{
            sourceType:String(meta.sourceType||"DICOM").slice(0,24),
            sourceName:meta.sourceName?String(meta.sourceName).slice(0,180):null,
            modality:meta.modality?String(meta.modality).slice(0,32):null,
            manufacturer:meta.manufacturer?String(meta.manufacturer).slice(0,120):null,
            model:meta.model?String(meta.model).slice(0,120):null,
            seriesCount:Math.max(0,Number(meta.seriesCount)||0),
            status:"UPLOADING"
          }})
        : await prisma.examStudy.create({data:{
            orderId:order.id,
            patientId:order.patientId,
            unitId:membership.unitId,
            examTypeId:order.examTypeId,
            sourceType:String(meta.sourceType||"DICOM").slice(0,24),
            modality:meta.modality?String(meta.modality).slice(0,32):null,
            manufacturer:meta.manufacturer?String(meta.manufacturer).slice(0,120):null,
            model:meta.model?String(meta.model).slice(0,120):null,
            seriesCount:Math.max(0,Number(meta.seriesCount)||0)
          }});
      res.status(order.study?200:201).json({study});
    }catch(e){next(e);}
  });

  app.put("/api/unit/studies/:studyId/files/:index",auth,express.raw({type:"application/octet-stream",limit:"64mb"}),async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const index=Number(req.params.index);
      if(!Number.isInteger(index)||index<0||index>10000) return res.status(400).json({error:"Índice de arquivo inválido."});
      const study=await prisma.examStudy.findFirst({where:{id:req.params.studyId,unitId:membership.unitId,status:"UPLOADING"}});
      if(!study) return res.status(404).json({error:"Estudo em envio não encontrado."});
      if(!Buffer.isBuffer(req.body)||!req.body.length) return res.status(400).json({error:"Arquivo vazio."});
      const dicomLike=isDicomSource(study.sourceType);
      let fileName=dicomLike?"dicom-"+String(index+1).padStart(4,"0")+".dcm":"arquivo-"+String(index+1).padStart(4,"0")+".bin";
      try{
        const raw=String(req.headers["x-file-name"]||"");
        if(raw) fileName=decodeURIComponent(raw).replace(/[\\/]+/g,"_").slice(-180)||fileName;
      }catch{}
      const contentType=safeUploadContentType(req.headers["x-file-content-type"]||(dicomLike?"application/dicom":"application/octet-stream"));
      const objectKey="studies/"+study.id+"/"+String(index).padStart(6,"0")+safeUploadExtension(fileName,contentType);
      await putPrivateObject({key:objectKey,body:req.body,contentType});
      const file=await prisma.studyFile.upsert({
        where:{studyId_index:{studyId:study.id,index}},
        create:{studyId:study.id,index,fileName,objectKey,sizeBytes:req.body.length,contentType},
        update:{fileName,objectKey,sizeBytes:req.body.length,contentType}
      });
      res.status(201).json({file:{id:file.id,index:file.index,sizeBytes:file.sizeBytes}});
    }catch(e){next(e);}
  });

  app.post("/api/unit/studies/:studyId/complete",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,unitId:membership.unitId},
        include:{files:true,order:true}
      });
      if(!study) return res.status(404).json({error:"Estudo não encontrado."});
      if(study.status==="READY") return res.json({study});
      if(study.orderId&&study.order?.status!=="EXAME_REALIZADO") return res.status(409).json({error:"O pedido não está pronto para receber imagens."});
      if(!study.files.length) return res.status(409).json({error:"Nenhum arquivo foi enviado."});
      const totalBytes=study.files.reduce((sum,f)=>sum+f.sizeBytes,0);
      const completed=await prisma.$transaction(async tx=>{
        const updated=await tx.examStudy.update({
          where:{id:study.id},
          data:{status:"READY",fileCount:study.files.length,totalBytes,completedAt:new Date()}
        });
        if(study.orderId){
          await tx.order.update({where:{id:study.orderId},data:{status:"IMAGENS_RECEBIDAS"}});
          await tx.statusHistory.create({
            data:{orderId:study.orderId,status:"IMAGENS_RECEBIDAS",actorType:"UNIT_USER",actorId:req.auth.sub,note:"Exame salvo no storage privado do OdontoView."}
          });
        }
        return updated;
      });
      res.json({study:completed});
    }catch(e){next(e);}
  });

  app.get("/api/unit/studies/:studyId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,unitId:membership.unitId,status:"READY"},
        include:{
          files:{orderBy:{index:"asc"},select:{id:true,index:true,fileName:true,sizeBytes:true,contentType:true}},
          patient:{select:{id:true,name:true,birthDate:true}},
          examType:true,
          unit:{select:{id:true,name:true}},
          order:{select:{id:true,status:true,dentist:{select:{user:{select:{name:true}}}}}}
        }
      });
      if(!study) return res.status(404).json({error:"Exame não encontrado nesta unidade."});
      res.set("Cache-Control","no-store");
      res.json({
        study:{
          id:study.id,status:study.status,sourceType:study.sourceType,modality:study.modality,
          manufacturer:study.manufacturer,model:study.model,seriesCount:study.seriesCount,
          fileCount:study.fileCount,totalBytes:study.totalBytes,completedAt:study.completedAt,
          documentationLayout:study.documentationLayout||null,
          aiAnalysis:study.aiAnalysis||null,
          canDelete:true,canEditLayout:true,canManageAi:true
        },
        patient:study.patient,
        examType:study.examType,
        unit:study.unit,
        order:study.order,
        files:study.files
      });
    }catch(e){next(e);}
  });

  app.put("/api/unit/studies/:studyId/layout",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,unitId:membership.unitId,status:"READY"},
        include:{files:{select:{id:true}}}
      });
      if(!study) return res.status(404).json({error:"Exame não encontrado nesta unidade."});
      if(isDicomSource(study.sourceType)) return res.status(409).json({error:"O template radiográfico é destinado às documentações 2D."});
      const layout=sanitizeDocumentationLayout(req.body?.layout,study.files);
      if(!layout) return res.status(400).json({error:"Organização do template inválida."});
      const updated=await prisma.examStudy.update({where:{id:study.id},data:{documentationLayout:layout}});
      res.json({layout:updated.documentationLayout});
    }catch(e){next(e);}
  });

  app.post("/api/unit/studies/:studyId/ai-analysis",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,unitId:membership.unitId,status:"READY"},
        include:{files:true,examType:true}
      });
      if(!study) return res.status(404).json({error:"Exame não encontrado nesta unidade."});
      if(isDicomSource(study.sourceType)) return res.status(409).json({error:"OdontoView AI 3.0 Alpha está habilitado inicialmente apenas para radiografias 2D."});
      const requestedAt=new Date().toISOString();
      await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:aiAnalysisPayload({status:"RUNNING",requestedAt,message:"Análise assistiva em processamento."})}});
      try{
        const result=await requestExternalDentalAi(study);
        if(!result.configured){
          const demoMode=String(process.env.ODONTOVIEW_AI_DEMO||"false").toLowerCase()==="true";
          if(demoMode){
            const analysis=aiAnalysisPayload({
              status:"COMPLETED",
              provider:"OdontoView AI Demo",
              model:"demo-radiographic-markers-v1",
              findings:buildDemoAiFindings(study),
              requestedAt,
              completedAt:new Date().toISOString(),
              message:"DEMO visual: achados simulados para validar a experiência do OdontoView AI. Não usar como interpretação clínica."
            });
            analysis.demo=true;
            await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
            return res.json({analysis});
          }
          const analysis=aiAnalysisPayload({
            status:"NOT_CONFIGURED",
            requestedAt,
            message:"Infraestrutura do OdontoView AI 3.0 Alpha pronta. O motor clínico validado ainda não foi conectado neste ambiente."
          });
          await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
          return res.json({analysis});
        }
        const analysis=aiAnalysisPayload({
          status:"COMPLETED",
          provider:result.provider,
          model:result.model,
          findings:result.findings,
          requestedAt,
          completedAt:new Date().toISOString(),
          message:"Achados sugeridos para revisão profissional."
        });
        await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
        res.json({analysis});
      }catch(error){
        const analysis=aiAnalysisPayload({status:"FAILED",requestedAt,completedAt:new Date().toISOString(),message:error.message||"Falha no motor de IA."});
        await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
        res.status(502).json({error:analysis.message,analysis});
      }
    }catch(e){next(e);}
  });

  app.patch("/api/unit/studies/:studyId/ai-analysis/findings/:findingId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const study=await prisma.examStudy.findFirst({where:{id:req.params.studyId,unitId:membership.unitId,status:"READY"}});
      if(!study) return res.status(404).json({error:"Exame não encontrado nesta unidade."});
      const current=study.aiAnalysis&&typeof study.aiAnalysis==="object"?study.aiAnalysis:null;
      if(!current||!Array.isArray(current.findings)) return res.status(409).json({error:"Este exame ainda não possui achados de IA."});
      const status=String(req.body?.status||"").toUpperCase();
      if(!["CONFIRMED","REJECTED","SUGGESTED"].includes(status)) return res.status(400).json({error:"Status de revisão inválido."});
      let found=false;
      const findings=current.findings.map(finding=>{
        if(String(finding.id)!==String(req.params.findingId))return finding;
        found=true;return {...finding,status};
      });
      if(!found)return res.status(404).json({error:"Achado não encontrado."});
      const analysis={...current,findings};
      await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
      res.json({analysis});
    }catch(e){next(e);}
  });

  app.get("/api/unit/studies/:studyId/files/:fileId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const file=await prisma.studyFile.findFirst({
        where:{id:req.params.fileId,studyId:req.params.studyId,study:{unitId:membership.unitId,status:"READY"}}
      });
      if(!file) return res.status(404).json({error:"Arquivo não encontrado."});
      const object=await getPrivateObject(file.objectKey);
      let bytes;
      if(object.Body?.transformToByteArray) bytes=await object.Body.transformToByteArray();
      else{
        const chunks=[];
        for await (const chunk of object.Body||[]) chunks.push(Buffer.from(chunk));
        bytes=Buffer.concat(chunks);
      }
      res.set("Content-Type",file.contentType||"application/dicom");
      res.set("Content-Length",String(file.sizeBytes));
      res.set("Cache-Control","private, no-store");
      res.set("X-Content-Type-Options","nosniff");
      res.send(Buffer.from(bytes));
    }catch(e){next(e);}
  });

  app.delete("/api/unit/studies/:studyId/files/:fileId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,unitId:membership.unitId,status:"READY"},
        include:{files:{orderBy:{index:"asc"}}}
      });
      if(!study) return res.status(404).json({error:"Exame não encontrado nesta unidade."});
      if(isDicomSource(study.sourceType)) return res.status(409).json({error:"Em tomografia/DICOM, exclua o conjunto completo para preservar a integridade da série."});
      if(study.files.length<=1) return res.status(409).json({error:"Esta é a última imagem. Para removê-la, exclua a documentação inteira."});
      const file=study.files.find(item=>item.id===req.params.fileId);
      if(!file) return res.status(404).json({error:"Imagem não encontrada."});
      await deletePrivateObject(file.objectKey);
      const remaining=study.files.filter(item=>item.id!==file.id);
      const totalBytes=remaining.reduce((sum,item)=>sum+item.sizeBytes,0);
      await prisma.$transaction([
        prisma.studyFile.delete({where:{id:file.id}}),
        prisma.examStudy.update({where:{id:study.id},data:{fileCount:remaining.length,totalBytes}})
      ]);
      res.json({ok:true,study:{id:study.id,fileCount:remaining.length,totalBytes}});
    }catch(e){next(e);}
  });

  app.delete("/api/unit/studies/:studyId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="UNIT_USER") return res.status(403).json({error:"Acesso restrito à radiologia."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const membership=await unitMembershipFor(req.auth.sub);
      if(!membership) return res.status(403).json({error:"Unidade ativa não encontrada."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,unitId:membership.unitId},
        include:{files:true,order:true}
      });
      if(!study) return res.status(404).json({error:"Exame não encontrado nesta unidade."});
      for(const file of study.files) await deletePrivateObject(file.objectKey);
      await prisma.$transaction(async tx=>{
        await tx.examStudy.delete({where:{id:study.id}});
        if(study.orderId){
          await tx.order.update({where:{id:study.orderId},data:{status:"EXAME_REALIZADO"}});
          await tx.statusHistory.create({
            data:{orderId:study.orderId,status:"EXAME_REALIZADO",actorType:"UNIT_USER",actorId:req.auth.sub,note:"Documentação excluída pela radiologia; pedido liberado para novo exame."}
          });
        }
      });
      res.json({ok:true,orderId:study.orderId||null});
    }catch(e){next(e);}
  });

  app.post("/api/dentist/patients/:id/studies",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const patient=await prisma.patient.findFirst({where:dentistPatientWhere(dentist.id,req.params.id)});
      if(!patient) return res.status(404).json({error:"Paciente não encontrado ou não compartilhado com você."});
      const meta=req.body||{};
      const examType=meta.examTypeId?await prisma.examType.findFirst({where:{id:String(meta.examTypeId),active:true}}):null;
      const study=await prisma.examStudy.create({data:{
        patientId:patient.id,
        ownerDentistId:dentist.id,
        examTypeId:examType?.id||null,
        sourceType:String(meta.sourceType||"DICOM").slice(0,24),
        sourceName:meta.sourceName?String(meta.sourceName).slice(0,180):null,
        modality:meta.modality?String(meta.modality).slice(0,32):null,
        manufacturer:meta.manufacturer?String(meta.manufacturer).slice(0,120):null,
        model:meta.model?String(meta.model).slice(0,120):null,
        seriesCount:Math.max(0,Number(meta.seriesCount)||0)
      }});
      res.status(201).json({study});
    }catch(e){next(e);}
  });

  app.put("/api/dentist/studies/:studyId/files/:index",auth,express.raw({type:"application/octet-stream",limit:"64mb"}),async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const index=Number(req.params.index);
      if(!Number.isInteger(index)||index<0||index>10000) return res.status(400).json({error:"Índice de arquivo inválido."});
      const study=await prisma.examStudy.findFirst({where:{id:req.params.studyId,ownerDentistId:dentist.id,status:"UPLOADING"}});
      if(!study) return res.status(404).json({error:"Estudo em envio não encontrado."});
      if(!Buffer.isBuffer(req.body)||!req.body.length) return res.status(400).json({error:"Arquivo vazio."});
      const dicomLike=isDicomSource(study.sourceType);
      let fileName=dicomLike?"dicom-"+String(index+1).padStart(4,"0")+".dcm":"arquivo-"+String(index+1).padStart(4,"0")+".bin";
      try{
        const raw=String(req.headers["x-file-name"]||"");
        if(raw) fileName=decodeURIComponent(raw).replace(/[\\/]+/g,"_").slice(-180)||fileName;
      }catch{}
      const contentType=safeUploadContentType(req.headers["x-file-content-type"]||(dicomLike?"application/dicom":"application/octet-stream"));
      const objectKey="studies/"+study.id+"/"+String(index).padStart(6,"0")+safeUploadExtension(fileName,contentType);
      await putPrivateObject({key:objectKey,body:req.body,contentType});
      const file=await prisma.studyFile.upsert({
        where:{studyId_index:{studyId:study.id,index}},
        create:{studyId:study.id,index,fileName,objectKey,sizeBytes:req.body.length,contentType},
        update:{fileName,objectKey,sizeBytes:req.body.length,contentType}
      });
      res.status(201).json({file:{id:file.id,index:file.index,sizeBytes:file.sizeBytes}});
    }catch(e){next(e);}
  });

  app.post("/api/dentist/studies/:studyId/complete",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,ownerDentistId:dentist.id},
        include:{files:true}
      });
      if(!study) return res.status(404).json({error:"Estudo não encontrado."});
      if(study.status==="READY") return res.json({study});
      if(!study.files.length) return res.status(409).json({error:"Nenhum arquivo foi enviado."});
      const totalBytes=study.files.reduce((sum,f)=>sum+f.sizeBytes,0);
      const completed=await prisma.examStudy.update({
        where:{id:study.id},
        data:{status:"READY",fileCount:study.files.length,totalBytes,completedAt:new Date()}
      });
      res.json({study:completed});
    }catch(e){next(e);}
  });

  app.get("/api/dentist/studies/:studyId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const study=await prisma.examStudy.findFirst({
        where:{
          id:req.params.studyId,
          status:"READY",
          OR:[
            {ownerDentistId:dentist.id},
            {order:{dentistId:dentist.id}},
            {patient:{dentistAccess:{some:{dentistId:dentist.id}}}}
          ]
        },
        include:{
          files:{orderBy:{index:"asc"},select:{id:true,index:true,fileName:true,sizeBytes:true,contentType:true}},
          patient:{select:{id:true,name:true,birthDate:true}},
          examType:true,
          unit:true,
          order:{include:{patient:{select:{id:true,name:true,birthDate:true}},examType:true,unit:true,dentist:{select:{user:{select:{name:true}}}}}}
        }
      });
      if(!study) return res.status(404).json({error:"Exame não encontrado."});
      res.set("Cache-Control","no-store");
      res.json({
        study:{
          id:study.id,status:study.status,sourceType:study.sourceType,modality:study.modality,
          manufacturer:study.manufacturer,model:study.model,seriesCount:study.seriesCount,
          fileCount:study.fileCount,totalBytes:study.totalBytes,completedAt:study.completedAt,
          documentationLayout:study.documentationLayout||null,
          aiAnalysis:study.aiAnalysis||null,
          canDelete:study.ownerDentistId===dentist.id,
          canEditLayout:study.ownerDentistId===dentist.id,
          canManageAi:study.ownerDentistId===dentist.id
        },
        order:study.order
          ? {id:study.order.id,patient:study.order.patient,examType:study.order.examType,unit:study.order.unit}
          : {id:null,patient:study.patient,examType:study.examType||{name:"Exame DICOM"},unit:study.unit},
        files:study.files
      });
    }catch(e){next(e);}
  });

  app.put("/api/dentist/studies/:studyId/layout",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,ownerDentistId:dentist.id,status:"READY"},
        include:{files:{select:{id:true}}}
      });
      if(!study) return res.status(403).json({error:"A organização oficial desta documentação pertence à radiologia que enviou o exame."});
      if(isDicomSource(study.sourceType)) return res.status(409).json({error:"O template radiográfico é destinado às documentações 2D."});
      const layout=sanitizeDocumentationLayout(req.body?.layout,study.files);
      if(!layout) return res.status(400).json({error:"Organização do template inválida."});
      const updated=await prisma.examStudy.update({where:{id:study.id},data:{documentationLayout:layout}});
      res.json({layout:updated.documentationLayout});
    }catch(e){next(e);}
  });

  app.post("/api/dentist/studies/:studyId/ai-analysis",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,ownerDentistId:dentist.id,status:"READY"},
        include:{files:true,examType:true}
      });
      if(!study) return res.status(403).json({error:"A análise oficial deste exame pertence à radiologia que enviou a documentação."});
      if(isDicomSource(study.sourceType)) return res.status(409).json({error:"OdontoView AI 3.0 Alpha está habilitado inicialmente apenas para radiografias 2D."});
      const requestedAt=new Date().toISOString();
      await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:aiAnalysisPayload({status:"RUNNING",requestedAt,message:"Análise assistiva em processamento."})}});
      try{
        const result=await requestExternalDentalAi(study);
        if(!result.configured){
          const demoMode=String(process.env.ODONTOVIEW_AI_DEMO||"false").toLowerCase()==="true";
          if(demoMode){
            const analysis=aiAnalysisPayload({
              status:"COMPLETED",
              provider:"OdontoView AI Demo",
              model:"demo-radiographic-markers-v1",
              findings:buildDemoAiFindings(study),
              requestedAt,
              completedAt:new Date().toISOString(),
              message:"DEMO visual: achados simulados para validar a experiência do OdontoView AI. Não usar como interpretação clínica."
            });
            analysis.demo=true;
            await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
            return res.json({analysis});
          }
          const analysis=aiAnalysisPayload({
            status:"NOT_CONFIGURED",
            requestedAt,
            message:"Infraestrutura do OdontoView AI 3.0 Alpha pronta. O motor clínico validado ainda não foi conectado neste ambiente."
          });
          await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
          return res.json({analysis});
        }
        const analysis=aiAnalysisPayload({
          status:"COMPLETED",
          provider:result.provider,
          model:result.model,
          findings:result.findings,
          requestedAt,
          completedAt:new Date().toISOString(),
          message:"Achados sugeridos para revisão profissional."
        });
        await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
        res.json({analysis});
      }catch(error){
        const analysis=aiAnalysisPayload({status:"FAILED",requestedAt,completedAt:new Date().toISOString(),message:error.message||"Falha no motor de IA."});
        await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
        res.status(502).json({error:analysis.message,analysis});
      }
    }catch(e){next(e);}
  });

  app.patch("/api/dentist/studies/:studyId/ai-analysis/findings/:findingId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const study=await prisma.examStudy.findFirst({where:{id:req.params.studyId,ownerDentistId:dentist.id,status:"READY"}});
      if(!study) return res.status(403).json({error:"A revisão dos achados deste exame pertence à radiologia que enviou a documentação."});
      const current=study.aiAnalysis&&typeof study.aiAnalysis==="object"?study.aiAnalysis:null;
      if(!current||!Array.isArray(current.findings)) return res.status(409).json({error:"Este exame ainda não possui achados de IA."});
      const status=String(req.body?.status||"").toUpperCase();
      if(!["CONFIRMED","REJECTED","SUGGESTED"].includes(status)) return res.status(400).json({error:"Status de revisão inválido."});
      let found=false;
      const findings=current.findings.map(finding=>{
        if(String(finding.id)!==String(req.params.findingId))return finding;
        found=true;return {...finding,status};
      });
      if(!found)return res.status(404).json({error:"Achado não encontrado."});
      const analysis={...current,findings};
      await prisma.examStudy.update({where:{id:study.id},data:{aiAnalysis:analysis}});
      res.json({analysis});
    }catch(e){next(e);}
  });

  app.get("/api/dentist/studies/:studyId/files/:fileId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const file=await prisma.studyFile.findFirst({
        where:{
          id:req.params.fileId,
          studyId:req.params.studyId,
          study:{
            status:"READY",
            OR:[
              {ownerDentistId:dentist.id},
              {order:{dentistId:dentist.id}},
              {patient:{dentistAccess:{some:{dentistId:dentist.id}}}}
            ]
          }
        }
      });
      if(!file) return res.status(404).json({error:"Arquivo não encontrado."});
      const object=await getPrivateObject(file.objectKey);
      let bytes;
      if(object.Body?.transformToByteArray) bytes=await object.Body.transformToByteArray();
      else{
        const chunks=[];
        for await (const chunk of object.Body||[]) chunks.push(Buffer.from(chunk));
        bytes=Buffer.concat(chunks);
      }
      res.set("Content-Type",file.contentType||"application/dicom");
      res.set("Content-Length",String(file.sizeBytes));
      res.set("Cache-Control","private, no-store");
      res.set("X-Content-Type-Options","nosniff");
      res.send(Buffer.from(bytes));
    }catch(e){next(e);}
  });

  app.delete("/api/dentist/studies/:studyId/files/:fileId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,ownerDentistId:dentist.id,status:"READY"},
        include:{files:{orderBy:{index:"asc"}}}
      });
      if(!study) return res.status(403).json({error:"Você só pode excluir imagens de exames enviados por você."});
      if(isDicomSource(study.sourceType)) return res.status(409).json({error:"Em tomografia/DICOM, exclua o conjunto completo para preservar a integridade da série."});
      if(study.files.length<=1) return res.status(409).json({error:"Esta é a última imagem. Para removê-la, exclua a documentação inteira."});
      const file=study.files.find(item=>item.id===req.params.fileId);
      if(!file) return res.status(404).json({error:"Imagem não encontrada."});
      await deletePrivateObject(file.objectKey);
      const remaining=study.files.filter(item=>item.id!==file.id);
      const totalBytes=remaining.reduce((sum,item)=>sum+item.sizeBytes,0);
      await prisma.$transaction([
        prisma.studyFile.delete({where:{id:file.id}}),
        prisma.examStudy.update({where:{id:study.id},data:{fileCount:remaining.length,totalBytes}})
      ]);
      res.json({ok:true,study:{id:study.id,fileCount:remaining.length,totalBytes}});
    }catch(e){next(e);}
  });

  app.delete("/api/dentist/studies/:studyId",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      if(!storageReady()) return res.status(503).json({error:"Storage privado ainda não está disponível."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const study=await prisma.examStudy.findFirst({
        where:{id:req.params.studyId,ownerDentistId:dentist.id},
        include:{files:true}
      });
      if(!study) return res.status(403).json({error:"Você só pode excluir exames enviados por você."});
      for(const file of study.files) await deletePrivateObject(file.objectKey);
      await prisma.examStudy.delete({where:{id:study.id}});
      res.json({ok:true});
    }catch(e){next(e);}
  });

  app.use("/api/public/orders/access",(_req,res,next)=>{
    res.set("Cache-Control","no-store");
    res.set("Referrer-Policy","no-referrer");
    next();
  });

  app.get("/api/public/dentist-invites/:token",async(req,res,next)=>{
    try{
      const invite=await prisma.dentistInvite.findUnique({
        where:{tokenHash:hashToken(req.params.token)},
        include:{
          patient:{select:{id:true,name:true}},
          study:{select:{id:true,status:true,fileCount:true,totalBytes:true,examType:true}},
          unit:{include:{organization:true}},
          claimedByDentist:{include:{user:{select:{name:true,email:true}}}}
        }
      });
      if(!invite||invite.expiresAt<=new Date()) return res.status(401).json({error:"Convite inválido ou expirado."});
      res.set("Cache-Control","no-store");
      res.json({
        invite:{
          patient:invite.patient,
          study:invite.study,
          unit:invite.unit?{id:invite.unit.id,name:invite.unit.name,organization:invite.unit.organization.name}:null,
          claimed:Boolean(invite.claimedAt),
          claimedBy:invite.claimedByDentist?.user||null,
          expiresAt:invite.expiresAt
        }
      });
    }catch(e){next(e);}
  });

  app.post("/api/dentist/invites/:token/claim",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub);
      if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const invite=await prisma.dentistInvite.findUnique({where:{tokenHash:hashToken(req.params.token)}});
      if(!invite||invite.expiresAt<=new Date()) return res.status(401).json({error:"Convite inválido ou expirado."});
      if(invite.claimedByDentistId&&invite.claimedByDentistId!==dentist.id) return res.status(409).json({error:"Este convite já foi utilizado por outro dentista."});
      await prisma.$transaction([
        prisma.dentistPatientAccess.upsert({
          where:{dentistId_patientId:{dentistId:dentist.id,patientId:invite.patientId}},
          create:{dentistId:dentist.id,patientId:invite.patientId,source:"INVITE"},
          update:{}
        }),
        prisma.dentistInvite.update({
          where:{id:invite.id},
          data:{claimedByDentistId:dentist.id,claimedAt:invite.claimedAt||new Date()}
        })
      ]);
      res.json({ok:true,patientId:invite.patientId,studyId:invite.studyId||null});
    }catch(e){next(e);}
  });

  app.post("/api/public/orders/access/:token/dentist-invite",async(req,res,next)=>{
    try{
      const access=await resolveAccessToken(prisma,req.params.token);
      if(!access) return res.status(401).json({error:"Link inválido ou expirado."});
      const order=await prisma.order.findUnique({where:{id:access.orderId},include:{study:true}});
      if(!order) return res.status(404).json({error:"Pedido não encontrado."});
      const rawToken=newToken(),expiresAt=new Date(Date.now()+7*24*3600000);
      await prisma.dentistInvite.create({data:{
        patientId:order.patientId,
        studyId:order.study?.status==="READY"?order.study.id:null,
        unitId:order.unitId||null,
        tokenHash:hashToken(rawToken),
        expiresAt
      }});
      const base=`${req.protocol}://${req.get("host")}`;
      res.status(201).json({inviteUrl:base+"/convite-dentista?token="+encodeURIComponent(rawToken),expiresAt});
    }catch(e){next(e);}
  });

  app.get("/api/public/orders/access/:token",async(req,res,next)=>{
    try{
      const access=await resolveAccessToken(prisma,req.params.token); if(!access) return res.status(401).json({error:"Link inválido ou expirado."});
      const order=await prisma.order.findUnique({where:{id:access.orderId},include:{
        patient:{select:{id:true,name:true}},examType:true,dentist:{include:{user:{select:{name:true}}}},unit:true,appointment:{include:{availability:true}}
      }});
      const offers=await prisma.unitOffer.findMany({where:{examTypeId:order.examTypeId,active:true,unit:{active:true}},include:{unit:{include:{organization:true}}},orderBy:{priceClient:"asc"}});
      res.json({order:{id:order.id,status:order.status,patient:order.patient,examType:order.examType,dentist:{name:order.dentist.user.name,cro:order.dentist.cro,uf:order.dentist.uf},unit:order.unit,appointment:order.appointment},offers});
    }catch(e){next(e);}
  });

  app.get("/api/public/orders/access/:token/availability",async(req,res,next)=>{
    try{
      const access=await resolveAccessToken(prisma,req.params.token); if(!access) return res.status(401).json({error:"Link inválido ou expirado."});
      const offer=await prisma.unitOffer.findFirst({where:{id:String(req.query.offerId||""),examTypeId:access.order.examTypeId,active:true}});
      if(!offer) return res.status(404).json({error:"Oferta não encontrada."});
      res.json(await prisma.unitAvailability.findMany({where:{unitId:offer.unitId,status:"AVAILABLE",startAt:{gte:new Date()}},orderBy:{startAt:"asc"},take:40}));
    }catch(e){next(e);}
  });

  app.post("/api/public/orders/access/:token/schedule",async(req,res,next)=>{
    try{
      const access=await resolveAccessToken(prisma,req.params.token); if(!access) return res.status(401).json({error:"Link inválido ou expirado."});
      const {offerId,availabilityId}=req.body;
      const result=await prisma.$transaction(async tx=>{
        const order=await tx.order.findUnique({where:{id:access.orderId}});
        if(!order||order.status!=="SOLICITADO") { const e=new Error("Pedido não está disponível para agendamento.");e.status=409;throw e; }
        const offer=await tx.unitOffer.findFirst({where:{id:offerId,examTypeId:order.examTypeId,active:true}});
        if(!offer){const e=new Error("Oferta inválida.");e.status=404;throw e;}
        const reserved=await tx.unitAvailability.updateMany({where:{id:availabilityId,unitId:offer.unitId,status:"AVAILABLE",startAt:{gte:new Date()}},data:{status:"RESERVED"}});
        if(reserved.count!==1){const e=new Error("Este horário não está mais disponível.");e.status=409;throw e;}
        const appointment=await tx.appointment.create({data:{orderId:order.id,availabilityId}});
        const updated=await tx.order.update({where:{id:order.id},data:{
          unitId:offer.unitId,offerId:offer.id,valueClient:offer.priceClient,unitPayout:offer.unitPayout,reportPrice:offer.reportPrice,platformRevenue:offer.platformRevenue,reportIncluded:offer.reportIncluded,status:"AGENDADO"
        }});
        await tx.statusHistory.create({data:{orderId:order.id,status:"AGENDADO",actorType:"PATIENT",note:"Unidade e horário escolhidos pelo link seguro."}});
        return {order:updated,appointment};
      });
      res.status(201).json(result);
    }catch(e){next(e);}
  });

  if(process.env.WEB_DIST){
    app.use(express.static(process.env.WEB_DIST));
    app.get("*",(req,res,next)=>{
      if(req.path.startsWith("/api/")||req.path==="/health") return next();
      res.sendFile(path.join(process.env.WEB_DIST,"index.html"));
    });
  }

  app.use((err,_req,res,_next)=>{console.error(err);res.status(err.status||500).json({error:err.status?err.message:"Erro interno do servidor."});});
  return app;
}
