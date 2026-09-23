import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcryptjs";
process.env.JWT_SECRET=process.env.JWT_SECRET||"test-secret";
process.env.PATIENT_APP_URL="http://localhost:5173/paciente";
const {prisma}=await import("../src/prisma.js");
const {createApp}=await import("../src/app.js");
const app=createApp();
let examType,offer,slot,unit;

before(async()=>{
  await prisma.statusHistory.deleteMany();
  await prisma.patientAccessToken.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.unitAvailability.deleteMany();
  await prisma.unitOffer.deleteMany();
  await prisma.unitMembership.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.dentist.deleteMany();
  await prisma.user.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.radiologyOrganization.deleteMany();
  await prisma.examType.deleteMany();

  examType=await prisma.examType.create({data:{name:"Panorâmica Teste"}});
  const org=await prisma.radiologyOrganization.create({data:{name:"Rádio Teste"}});
  unit=await prisma.unit.create({data:{organizationId:org.id,name:"Unidade Teste",addressLine:"Rua Teste, 1",city:"Rio das Ostras",state:"RJ"}});
  offer=await prisma.unitOffer.create({data:{unitId:unit.id,examTypeId:examType.id,priceClient:100,unitPayout:55,reportPrice:15,platformRevenue:30,reportIncluded:true}});
  const startAt=new Date(Date.now()+86400000);
  slot=await prisma.unitAvailability.create({data:{unitId:unit.id,startAt,endAt:new Date(startAt.getTime()+1800000)}});

  const unitUser=await prisma.user.create({data:{
    name:"Recepção Teste",email:"radio@teste.local",role:"UNIT_USER",passwordHash:await bcrypt.hash("SenhaRadio123",4)
  }});
  await prisma.unitMembership.create({data:{userId:unitUser.id,unitId:unit.id}});
});
after(async()=>prisma.$disconnect());

test("dentista solicita, paciente agenda e radiologia opera atendimento",async()=>{
  const reg=await request(app).post("/api/auth/register-dentist").send({name:"Dra. Teste",email:"dentista@teste.local",password:"SenhaForte123",cro:"12345",uf:"RJ"}).expect(201);
  assert.equal(reg.body.user.role,"DENTIST");
  const auth={Authorization:"Bearer "+reg.body.token};

  const patient=await request(app).post("/api/patients").set(auth).send({name:"Paciente Teste",phone:"22999999999"}).expect(201);
  const order=await request(app).post("/api/orders").set(auth).send({patientId:patient.body.id,examTypeId:examType.id}).expect(201);
  assert.equal(order.body.order.status,"SOLICITADO");

  const token=new URL(order.body.patientAccessUrl).searchParams.get("token");
  assert.ok(token);
  const view=await request(app).get("/api/public/orders/access/"+token).expect(200);
  assert.equal(view.body.offers.length,1);

  const availability=await request(app).get("/api/public/orders/access/"+token+"/availability?offerId="+offer.id).expect(200);
  assert.equal(availability.body.length,1);

  const scheduled=await request(app).post("/api/public/orders/access/"+token+"/schedule").send({offerId:offer.id,availabilityId:slot.id}).expect(201);
  assert.equal(scheduled.body.order.status,"AGENDADO");

  const login=await request(app).post("/api/auth/login").send({email:"radio@teste.local",password:"SenhaRadio123"}).expect(200);
  assert.equal(login.body.user.role,"UNIT_USER");
  assert.equal(login.body.unit.id,unit.id);
  const unitAuth={Authorization:"Bearer "+login.body.token};

  const from=new Date(slot.startAt.getTime()-3600000).toISOString();
  const to=new Date(slot.startAt.getTime()+3600000).toISOString();
  const agenda=await request(app).get("/api/unit/agenda?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to)).set(unitAuth).expect(200);
  assert.equal(agenda.body.orders.length,1);
  assert.equal(agenda.body.orders[0].patient.name,"Paciente Teste");

  const arrived=await request(app).patch("/api/unit/orders/"+order.body.order.id+"/status").set(unitAuth).send({status:"PACIENTE_CHEGOU"}).expect(200);
  assert.equal(arrived.body.order.status,"PACIENTE_CHEGOU");

  const completed=await request(app).patch("/api/unit/orders/"+order.body.order.id+"/status").set(unitAuth).send({status:"EXAME_REALIZADO"}).expect(200);
  assert.equal(completed.body.order.status,"EXAME_REALIZADO");

  const history=await prisma.statusHistory.findMany({where:{orderId:order.body.order.id},orderBy:{createdAt:"asc"}});
  assert.deepEqual(history.map(x=>x.status),["SOLICITADO","AGENDADO","PACIENTE_CHEGOU","EXAME_REALIZADO"]);
});
