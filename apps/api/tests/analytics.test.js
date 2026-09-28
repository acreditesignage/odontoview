import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {createAnalyticsRouter} from "../src/analytics.js";

const JWT_SECRET="analytics-test-secret";
const NOW=new Date("2026-09-28T02:30:00.000Z");

function fakePrisma({sessions=[],events=[]}={}){
  const state={sessions:[...sessions],events:[...events],writes:[]};
  return {
    state,
    analyticsSession:{
      async findUnique({where}){return state.sessions.find(s=>s.sessionKey===where.sessionKey)||null;},
      async create({data}){
        const row={id:"session-"+(state.sessions.length+1),...data};state.sessions.push(row);state.writes.push({model:"session",op:"create",data});return row;
      },
      async update({where,data}){
        const row=state.sessions.find(s=>s.id===where.id);Object.assign(row,data,{activeSeconds:typeof data.activeSeconds?.increment==="number"?(row.activeSeconds||0)+data.activeSeconds.increment:(data.activeSeconds??row.activeSeconds)});state.writes.push({model:"session",op:"update",data});return row;
      },
      async findMany(args={}){
        let rows=[...state.sessions];
        if(args.where?.lastSeenAt?.gte)rows=rows.filter(r=>new Date(r.lastSeenAt)>=args.where.lastSeenAt.gte);
        rows.sort((a,b)=>new Date(b.lastSeenAt)-new Date(a.lastSeenAt));
        if(args.take)rows=rows.slice(0,args.take);
        return rows;
      }
    },
    analyticsEvent:{
      async create({data}){const row={id:"event-"+(state.events.length+1),...data};state.events.push(row);state.writes.push({model:"event",op:"create",data});return row;},
      async findMany(args={}){
        let rows=[...state.events];
        if(args.where?.occurredAt?.gte)rows=rows.filter(r=>new Date(r.occurredAt)>=args.where.occurredAt.gte);
        if(args.where?.type)rows=rows.filter(r=>r.type===args.where.type);
        return rows;
      }
    }
  };
}

function makeApp(prismaClient){
  const app=express();app.use(express.json());
  app.use(createAnalyticsRouter({
    prismaClient,
    jwtSecret:JWT_SECRET,
    now:()=>new Date(NOW),
    geoLookup:async()=>({country:"BR",region:"RJ",city:"Rio das Ostras"})
  }));
  return app;
}

function token(role,sub="user-1"){return jwt.sign({sub,role,email:role.toLowerCase()+"@teste.local"},JWT_SECRET);}
const validEvent={sessionKey:"11111111-2222-4333-8444-555555555555",type:"PAGE_VIEW",route:"/viewer2",referrer:"https://www.google.com/",utmSource:"google",utmMedium:"organic",utmCampaign:null};

test("anonymous page view is ingested without persisting raw IP",async()=>{
  const prisma=fakePrisma();
  const response=await request(makeApp(prisma)).post("/api/analytics/events").set("X-Real-IP","177.10.20.30").set("User-Agent","Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1").send(validEvent).expect(202);
  assert.equal(response.body.ok,true);
  assert.equal(prisma.state.sessions.length,1);
  assert.equal(prisma.state.sessions[0].userId,null);
  assert.equal(prisma.state.sessions[0].city,"Rio das Ostras");
  assert.equal(prisma.state.sessions[0].deviceClass,"mobile");
  assert.ok(prisma.state.sessions[0].networkFingerprint);
  assert.equal(JSON.stringify(prisma.state.writes).includes("177.10.20.30"),false);
  assert.equal(prisma.state.events[0].type,"PAGE_VIEW");
});

test("valid bearer token associates the browser session with its user",async()=>{
  const prisma=fakePrisma();
  await request(makeApp(prisma)).post("/api/analytics/events").set("Authorization","Bearer "+token("DENTIST","dentist-7")).send(validEvent).expect(202);
  assert.equal(prisma.state.sessions[0].userId,"dentist-7");
});

test("unknown or oversized analytics fields are rejected",async()=>{
  const prisma=fakePrisma();
  await request(makeApp(prisma)).post("/api/analytics/events").send({...validEvent,patientName:"não pode entrar"}).expect(400);
  await request(makeApp(prisma)).post("/api/analytics/events").send({...validEvent,route:"/"+"x".repeat(300)}).expect(400);
  assert.equal(prisma.state.sessions.length,0);
});

test("admin overview uses five-minute online window and never exposes network fingerprint",async()=>{
  const prisma=fakePrisma({
    sessions:[
      {id:"s1",sessionKey:"a",userId:"u1",startedAt:new Date("2026-09-28T02:00:00Z"),lastSeenAt:new Date("2026-09-28T02:29:00Z"),firstRoute:"/dentista",currentRoute:"/viewer2",country:"BR",region:"RJ",city:"Rio das Ostras",deviceClass:"desktop",browser:"Chrome",operatingSystem:"Windows",utmSource:"google",referrer:null,activeSeconds:120,networkFingerprint:"secret-a",user:{id:"u1",name:"Dra. Ana",email:"ana@teste.local",role:"DENTIST"}},
      {id:"s2",sessionKey:"b",userId:null,startedAt:new Date("2026-09-28T01:00:00Z"),lastSeenAt:new Date("2026-09-28T02:20:00Z"),firstRoute:"/acesso-exame",currentRoute:"/acesso-exame",country:"BR",region:"SP",city:"São Paulo",deviceClass:"mobile",browser:"Safari",operatingSystem:"iOS",utmSource:null,referrer:"https://wa.me/",activeSeconds:60,networkFingerprint:"secret-b",user:null}
    ],
    events:[
      {id:"e1",sessionId:"s1",type:"PAGE_VIEW",route:"/viewer2",occurredAt:new Date("2026-09-28T02:10:00Z")},
      {id:"e2",sessionId:"s2",type:"PAGE_VIEW",route:"/acesso-exame",occurredAt:new Date("2026-09-28T02:11:00Z")}
    ]
  });
  const response=await request(makeApp(prisma)).get("/api/admin/analytics/overview?range=7d").set("Authorization","Bearer "+token("ADMIN","admin-1")).expect(200);
  assert.equal(response.body.onlineNow,1);
  assert.equal(response.body.uniqueToday,2);
  assert.equal(response.body.pageViews,2);
  assert.equal(JSON.stringify(response.body).includes("secret-a"),false);
});

test("recent activity is admin-only and projects identity without private fingerprint",async()=>{
  const prisma=fakePrisma({sessions:[{id:"s1",sessionKey:"a",userId:"u1",startedAt:new Date("2026-09-28T02:00:00Z"),lastSeenAt:new Date("2026-09-28T02:29:00Z"),firstRoute:"/dentista",currentRoute:"/viewer2",country:"BR",region:"RJ",city:"Rio das Ostras",deviceClass:"desktop",browser:"Chrome",operatingSystem:"Windows",utmSource:null,referrer:null,activeSeconds:120,networkFingerprint:"must-not-leak",user:{id:"u1",name:"Dra. Ana",email:"ana@teste.local",role:"DENTIST"}}]});
  await request(makeApp(prisma)).get("/api/admin/analytics/recent").set("Authorization","Bearer "+token("DENTIST")).expect(403);
  await request(makeApp(prisma)).get("/api/admin/analytics/recent").set("Authorization","Bearer "+token("UNIT_USER")).expect(403);
  const response=await request(makeApp(prisma)).get("/api/admin/analytics/recent?limit=50").set("Authorization","Bearer "+token("ADMIN")).expect(200);
  assert.equal(response.body.sessions[0].user.name,"Dra. Ana");
  assert.equal(response.body.sessions[0].online,true);
  assert.equal(JSON.stringify(response.body).includes("must-not-leak"),false);
});
