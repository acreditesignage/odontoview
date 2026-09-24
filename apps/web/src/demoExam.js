import {importExam} from "./ingest.js";

export const DEMO_EXAM={
  id:"odontoview-cbct-demo-v1",
  label:"Paciente Demo OdontoView",
  patientName:"Paciente Demo",
  examType:"Tomografia CBCT",
  url:"/demo/odontoview-demo.zip",
  fileName:"odontoview-demo.zip"
};

export async function checkDemoExamAvailability(){
  try{
    const response=await fetch(DEMO_EXAM.url,{method:"HEAD",cache:"no-store"});
    if(!response.ok)return false;
    const type=(response.headers.get("content-type")||"").toLowerCase();
    return !type.includes("text/html");
  }catch{
    return false;
  }
}

export async function loadDemoExam({onProgress}={}){
  onProgress?.({phase:"download",label:"Baixando exame demo…"});
  const response=await fetch(DEMO_EXAM.url,{cache:"no-store"});
  if(!response.ok)throw new Error("O exame demo ainda não foi publicado.");
  const type=(response.headers.get("content-type")||"").toLowerCase();
  if(type.includes("text/html"))throw new Error("O exame demo ainda não foi publicado.");
  const blob=await response.blob();
  if(!blob.size)throw new Error("O arquivo demo está vazio.");
  const file=new File([blob],DEMO_EXAM.fileName,{type:"application/zip",lastModified:Date.now()});
  return importExam([file],{onProgress});
}
