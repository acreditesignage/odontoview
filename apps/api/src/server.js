import "dotenv/config";
import { createApp } from "./app.js";
if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET é obrigatório.");
const port=Number(process.env.PORT||3001);
createApp().listen(port,()=>console.log("OdontoView Network API na porta "+port));
