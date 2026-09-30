import "dotenv/config";
import express from "express";
import { createApp } from "./app.js";
import { prisma } from "./prisma.js";
import { createAdminAuthRouter } from "./adminAuth.js";
import { createAnalyticsRouter } from "./analytics.js";
import { bootstrapDemoVolumeFromEnv, createDemoVolumeRouter, DEMO_TRANSPORT_META } from "./demoVolume.js";
if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET é obrigatório.");
const positiveInt=(value,fallback)=>{const n=Number(value);return Number.isInteger(n)&&n>0?n:fallback;};
DEMO_TRANSPORT_META.sliceCount=positiveInt(process.env.DEMO_CBCT_SLICE_COUNT,DEMO_TRANSPORT_META.sliceCount);
DEMO_TRANSPORT_META.rows=positiveInt(process.env.DEMO_CBCT_ROWS,DEMO_TRANSPORT_META.rows);
DEMO_TRANSPORT_META.columns=positiveInt(process.env.DEMO_CBCT_COLUMNS,DEMO_TRANSPORT_META.columns);
const port=Number(process.env.PORT||3001);
const app=express();
app.use(createAdminAuthRouter({prismaClient:prisma,jwtSecret:process.env.JWT_SECRET}));
app.use(createDemoVolumeRouter({jwtSecret:process.env.JWT_SECRET}));
app.use(createApp());
app.use(createAnalyticsRouter({prismaClient:prisma,jwtSecret:process.env.JWT_SECRET}));
try{
  const demoBootstrap=await bootstrapDemoVolumeFromEnv();
  if(demoBootstrap.uploaded)console.log(`Demo CBCT privado sincronizado (${demoBootstrap.sizeBytes} bytes, ${DEMO_TRANSPORT_META.sliceCount} cortes ${DEMO_TRANSPORT_META.rows}x${DEMO_TRANSPORT_META.columns}).`);
}catch(error){
  console.error("Falha ao sincronizar demo CBCT privado:",error?.message||error);
}
app.listen(port,()=>console.log("OdontoView Network API na porta "+port));
