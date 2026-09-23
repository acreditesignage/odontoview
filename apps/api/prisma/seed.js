import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const addMinutes = (date, min) => new Date(date.getTime() + min * 60000);

async function main() {
  const panoramic = await prisma.examType.upsert({where:{name:"Panorâmica"},update:{active:true},create:{name:"Panorâmica"}});
  const cbct = await prisma.examType.upsert({where:{name:"Tomografia CBCT"},update:{active:true},create:{name:"Tomografia CBCT"}});
  let org = await prisma.radiologyOrganization.findFirst({where:{name:"Radiologia Parceira Demo"}});
  if (!org) org = await prisma.radiologyOrganization.create({data:{name:"Radiologia Parceira Demo"}});
  let unit = await prisma.unit.findFirst({where:{organizationId:org.id,name:"Unidade Centro"}});
  if (!unit) unit = await prisma.unit.create({data:{organizationId:org.id,name:"Unidade Centro",addressLine:"Rua Exemplo, 100",city:"Rio das Ostras",state:"RJ"}});
  for (const item of [
    {examTypeId:panoramic.id,priceClient:99,unitPayout:55,reportPrice:14,platformRevenue:30,reportIncluded:true},
    {examTypeId:cbct.id,priceClient:249,unitPayout:135,reportPrice:39,platformRevenue:75,reportIncluded:true}
  ]) {
    await prisma.unitOffer.upsert({where:{unitId_examTypeId:{unitId:unit.id,examTypeId:item.examTypeId}},update:item,create:{unitId:unit.id,...item}});
  }
  const start = new Date(Date.now()+86400000); start.setHours(9,0,0,0);
  for (const offset of [0,60,120]) {
    const startAt=addMinutes(start,offset), endAt=addMinutes(startAt,30);
    await prisma.unitAvailability.upsert({where:{unitId_startAt_endAt:{unitId:unit.id,startAt,endAt}},update:{status:"AVAILABLE"},create:{unitId:unit.id,startAt,endAt}});
  }
  console.log("Seed OdontoView Network concluído.");
}
main().finally(()=>prisma.$disconnect());
