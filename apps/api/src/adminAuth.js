import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

function signAdmin(user,jwtSecret){
  return jwt.sign({sub:user.id,role:user.role,email:user.email},jwtSecret,{expiresIn:"8h"});
}

export function createAdminAuthRouter({prismaClient,jwtSecret}){
  if(!prismaClient) throw new Error("prismaClient é obrigatório.");
  if(!jwtSecret) throw new Error("jwtSecret é obrigatório.");

  const router=express.Router();
  router.use(express.json({limit:"256kb"}));

  router.post("/api/auth/login",async(req,res,next)=>{
    try{
      const email=String(req.body?.email||"").toLowerCase().trim();
      if(!email) return next();

      const user=await prismaClient.user.findUnique({where:{email}});
      if(!user||user.role!=="ADMIN") return next();

      const valid=await bcrypt.compare(String(req.body?.password||""),user.passwordHash);
      if(!valid) return res.status(401).json({error:"Email ou senha inválidos."});

      return res.json({
        token:signAdmin(user,jwtSecret),
        user:{id:user.id,name:user.name,email:user.email,role:user.role},
        dentist:null,
        unit:null
      });
    }catch(error){
      next(error);
    }
  });

  return router;
}
