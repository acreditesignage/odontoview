import "dotenv/config";
import express from "express";
import path from "node:path";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { createAccessToken, resolveAccessToken, newToken, hashToken } from "./token.js";
import { getPrivateObject, putPrivateObject, storageReady } from "./storage.js";

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
const dentistPatientWhere=(dentistId,patientId)=>({
  id:patientId,
  OR:[
    {createdByDentistId:dentistId},
    {dentistAccess:{some:{dentistId}}}
  ]
});
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
          appointment:{include:{availability:true}}
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
          appointment:o.appointment
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
      const dicomLike=["DICOM","ZIP","RAR"].includes(String(study.sourceType||"").toUpperCase());
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
            data:{orderId:study.orderId,status:"IMAGENS_RECEBIDAS",actorType:"UNIT_USER",actorId:req.auth.sub,note:"Exame enviado ao storage privado do OdontoView."}
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
          patient:{select:{id:true,name:true}},
          examType:true,
          order:{select:{id:true,status:true}}
        }
      });
      if(!study) return res.status(404).json({error:"Exame não encontrado nesta unidade."});
      res.set("Cache-Control","no-store");
      res.json({
        study:{
          id:study.id,status:study.status,sourceType:study.sourceType,modality:study.modality,
          manufacturer:study.manufacturer,model:study.model,seriesCount:study.seriesCount,
          fileCount:study.fileCount,totalBytes:study.totalBytes,completedAt:study.completedAt
        },
        patient:study.patient,
        examType:study.examType,
        order:study.order,
        files:study.files
      });
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
      const dicomLike=["DICOM","ZIP","RAR"].includes(String(study.sourceType||"").toUpperCase());
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
          patient:{select:{id:true,name:true}},
          examType:true,
          unit:true,
          order:{include:{patient:{select:{id:true,name:true}},examType:true,unit:true}}
        }
      });
      if(!study) return res.status(404).json({error:"Exame não encontrado."});
      res.set("Cache-Control","no-store");
      res.json({
        study:{
          id:study.id,status:study.status,sourceType:study.sourceType,modality:study.modality,
          manufacturer:study.manufacturer,model:study.model,seriesCount:study.seriesCount,
          fileCount:study.fileCount,totalBytes:study.totalBytes,completedAt:study.completedAt
        },
        order:study.order
          ? {id:study.order.id,patient:study.order.patient,examType:study.order.examType,unit:study.order.unit}
          : {id:null,patient:study.patient,examType:study.examType||{name:"Exame DICOM"},unit:study.unit},
        files:study.files
      });
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
