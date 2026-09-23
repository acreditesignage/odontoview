import "dotenv/config";
import express from "express";
import path from "node:path";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { createAccessToken, resolveAccessToken } from "./token.js";

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

  app.post("/api/orders",auth,async(req,res,next)=>{
    try{
      if(req.auth.role!=="DENTIST") return res.status(403).json({error:"Acesso restrito a dentistas."});
      const dentist=await dentistFor(req.auth.sub); if(!dentist) return res.status(403).json({error:"Perfil de dentista não encontrado."});
      const [patient,examType]=await Promise.all([
        prisma.patient.findFirst({where:{id:req.body.patientId,createdByDentistId:dentist.id}}),
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

  app.use("/api/public/orders/access",(_req,res,next)=>{
    res.set("Cache-Control","no-store");
    res.set("Referrer-Policy","no-referrer");
    next();
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
