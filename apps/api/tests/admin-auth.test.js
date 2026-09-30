import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
process.env.JWT_SECRET=process.env.JWT_SECRET||"test-secret";
const {prisma}=await import("../src/prisma.js");
const {createAdminAuthRouter}=await import("../src/adminAuth.js");

const email="admin-login@odontoview.test";
let app;

before(async()=>{
  await prisma.user.deleteMany({where:{email}});
  await prisma.user.create({data:{
    name:"Admin Teste",
    email,
    role:"ADMIN",
    passwordHash:await bcrypt.hash("AdminPass123",4)
  }});
  app=express();
  app.use(createAdminAuthRouter({prismaClient:prisma,jwtSecret:process.env.JWT_SECRET}));
  app.post("/api/auth/login",(_req,res)=>res.status(418).json({legacy:true}));
});

after(async()=>{
  await prisma.user.deleteMany({where:{email}});
  await prisma.$disconnect();
});

test("ADMIN authenticates through isolated router and receives ADMIN token",async()=>{
  const response=await request(app).post("/api/auth/login").send({email,password:"AdminPass123"}).expect(200);
  assert.equal(response.body.user.role,"ADMIN");
  const payload=jwt.verify(response.body.token,process.env.JWT_SECRET);
  assert.equal(payload.role,"ADMIN");
  assert.equal(payload.email,email);
});

test("non-admin/unknown login falls through to legacy auth route",async()=>{
  const response=await request(app).post("/api/auth/login").send({email:"nobody@odontoview.test",password:"x"}).expect(418);
  assert.equal(response.body.legacy,true);
});
