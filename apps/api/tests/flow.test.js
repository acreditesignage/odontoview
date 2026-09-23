import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
process.env.JWT_SECRET=process.env.JWT_SECRET||"test-secret";
process.env.PATIENT_APP_URL="http://localhost:5173/paciente";
const {prisma}=await import("../src/prisma.js");
const {createApp}=await import("../src/app.js");
const app=createApp();
let examType,offer,slot;

before(async()=>{
  await prisma.statusHistory.deleteMany(); await prisma.patientAccessToken.deleteMany(); await prisma.appointment.deleteMany(); await prisma.order.deleteMany();
  await prisma.unitAvailability.deleteMany(); await prisma.unitOffer.deleteMany(); await prisma.patient.deleteMany(); await prisma.dentist.deleteMany(); await prisma.user.deleteMany();
  await prisma.unit.deleteMany(); await prisma.radiologyOrganization.deleteMany(); await prisma.examType.deleteMany();
  examType=await prisma.examType.create({data:{name:"Panorâmica Teste"}});
  const org=await prisma.radiologyOrganization.create({data:{name:"Rádio Teste"}});
  const unit=await prisma.unit.create({data:{organizationId:org.id,name:"Unidade Teste",addressLine:"Rua Teste, 1",city:"Rio das Ostras",state:"RJ"}});
  offer=await prisma.unitOffer.create({data:{unitId:unit.id,examTypeId:examType.id,priceClient:100,unitPayout:55,reportPrice:15,platformRevenue:30,reportIncluded:true}});
  const startAt=new Date(Date.now()+86400000);
  slot=await prisma.unitAvailability.create({data:{unitId:unit.id,startAt,endAt:new Date(startAt.getTime()+1800000)}});
});
after(async()=>prisma.$disconnect());

test("dentista solicita e paciente agenda",async()=>{
  const reg=await request(app).post("/api/auth/register-dentist").send({name:"Dra. Teste",email:"dentista@teste.local",password:"SenhaForte123",cro:"12345",uf:"RJ"}).expect(201);
  const auth={Authorization:"Bearer "+reg.body.token};
  const patient=await request(app).post("/api/patients").set(auth).send({name:"Paciente Teste"}).expect(201);
  const order=await request(app).post("/api/orders").set(auth).send({patientId:patient.body.id,examTypeId:examType.id}).expect(201);
  assert.equal(order.body.order.status,"SOLICITADO");
  const token=new URL(order.body.patientAccessUrl).searchParams.get("token"); assert.ok(token);
  const view=await request(app).get("/api/public/orders/access/"+token).expect(200); assert.equal(view.body.offers.length,1);
  const availability=await request(app).get("/api/public/orders/access/"+token+"/availability?offerId="+offer.id).expect(200); assert.equal(availability.body.length,1);
  const scheduled=await request(app).post("/api/public/orders/access/"+token+"/schedule").send({offerId:offer.id,availabilityId:slot.id}).expect(201);
  assert.equal(scheduled.body.order.status,"AGENDADO");
  const history=await prisma.statusHistory.findMany({where:{orderId:order.body.order.id},orderBy:{createdAt:"asc"}});
  assert.deepEqual(history.map(x=>x.status),["SOLICITADO","AGENDADO"]);
});
