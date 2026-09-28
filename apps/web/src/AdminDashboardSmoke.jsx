import React from "react";
import AdminDashboard from "./AdminDashboard.jsx";

const overview={
  onlineNow:12,uniqueToday:87,unique7d:426,unique30d:1384,pageViews:2918,
  dailySeries:[
    {day:"2026-09-22",sessions:42,pageViews:173},{day:"2026-09-23",sessions:51,pageViews:224},
    {day:"2026-09-24",sessions:68,pageViews:318},{day:"2026-09-25",sessions:61,pageViews:287},
    {day:"2026-09-26",sessions:74,pageViews:364},{day:"2026-09-27",sessions:83,pageViews:441},
    {day:"2026-09-28",sessions:47,pageViews:259}
  ],
  topRoutes:[{label:"/viewer2",count:1268},{label:"/dentista",count:692},{label:"/acesso-exame",count:483},{label:"/radiologia",count:312}],
  topRegions:[{label:"Rio das Ostras / RJ / BR",count:142},{label:"Rio de Janeiro / RJ / BR",count:103},{label:"Macaé / RJ / BR",count:74},{label:"São Paulo / SP / BR",count:51}],
  deviceBreakdown:[{label:"desktop",count:277},{label:"mobile",count:118},{label:"tablet",count:31}],
  sourceBreakdown:[{label:"direct",count:191},{label:"google",count:102},{label:"instagram",count:76},{label:"wa.me",count:57}]
};
const recent=[
  {online:true,user:{id:"u1",name:"Dra. Rebeca Amaral",email:"rebeca@demo.local"},role:"DENTIST",route:"/viewer2",location:{city:"Rio das Ostras",region:"RJ",country:"BR"},device:{class:"desktop",browser:"Chrome",os:"Windows"},source:"direct",lastSeen:new Date().toISOString(),durationSeconds:1380},
  {online:true,user:{id:"u2",name:"Radiologia Centro",email:"recepcao@demo.local"},role:"UNIT_USER",route:"/radiologia",location:{city:"Macaé",region:"RJ",country:"BR"},device:{class:"desktop",browser:"Edge",os:"Windows"},source:"google",lastSeen:new Date(Date.now()-60000).toISOString(),durationSeconds:820},
  {online:true,user:null,role:"ANONYMOUS",route:"/acesso-exame",location:{city:"Rio de Janeiro",region:"RJ",country:"BR"},device:{class:"mobile",browser:"Safari",os:"iOS"},source:"instagram",lastSeen:new Date(Date.now()-120000).toISOString(),durationSeconds:180},
  {online:false,user:{id:"u3",name:"Dr. Gabriel Campos",email:"gabriel@demo.local"},role:"DENTIST",route:"/dentista",location:{city:"São Paulo",region:"SP",country:"BR"},device:{class:"mobile",browser:"Chrome",os:"Android"},source:"google",lastSeen:new Date(Date.now()-900000).toISOString(),durationSeconds:540},
  {online:false,user:null,role:"ANONYMOUS",route:"/",location:{city:"Niterói",region:"RJ",country:"BR"},device:{class:"tablet",browser:"Safari",os:"iOS"},source:"direct",lastSeen:new Date(Date.now()-2100000).toISOString(),durationSeconds:120}
];

export default function AdminDashboardSmoke(){return <AdminDashboard fixture={{overview,recent}}/>}
