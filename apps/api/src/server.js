import "dotenv/config";
import { createApp } from "./app.js";
import { prisma } from "./prisma.js";
import { createAnalyticsRouter } from "./analytics.js";
if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET é obrigatório.");
const port=Number(process.env.PORT||3001);
const app=createApp();
app.use(createAnalyticsRouter({prismaClient:prisma,jwtSecret:process.env.JWT_SECRET}));
app.listen(port,()=>console.log("OdontoView Network API na porta "+port));
