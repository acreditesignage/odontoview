import {importExam} from "./ingest.js";

const encoder=new TextEncoder();

export const DEMO_EXAM={
  id:"odontoview-cbct-demo-v2",
  label:"Paciente Demo OdontoView",
  patientName:"Paciente Demo",
  examType:"Tomografia CBCT",
  url:"/api/demo/volume",
  fileName:"odontoview-demo-volume.gz"
};

export const DEMO_VOLUME_META={
  version:2,
  sliceCount:100,
  rows:112,
  columns:112,
  pixelSpacing:[0.7142857142857143,0.7142857142857143],
  sliceSpacing:0.604040404040404,
  imagePosition:[-40,-40,30],
  orientation:[1,0,0,0,1,0],
  storedScale:16,
  rescaleIntercept:-1000,
  rescaleSlope:1
};

function concatBytes(parts){
  const total=parts.reduce((sum,part)=>sum+part.length,0);
  const out=new Uint8Array(total);
  let offset=0;
  for(const part of parts){out.set(part,offset);offset+=part.length;}
  return out;
}
function u16(value){
  const out=new Uint8Array(2);
  new DataView(out.buffer).setUint16(0,value,true);
  return out;
}
function u32(value){
  const out=new Uint8Array(4);
  new DataView(out.buffer).setUint32(0,value,true);
  return out;
}
function dicomElement(group,tag,vr,value){
  let bytes;
  if(vr==="US")bytes=u16(Number(value));
  else if(value instanceof Uint8Array)bytes=value;
  else bytes=encoder.encode(String(value));
  if(bytes.length%2){
    const padded=new Uint8Array(bytes.length+1);
    padded.set(bytes);
    padded[padded.length-1]=vr==="UI"?0:32;
    bytes=padded;
  }
  const long=["OW","OB","SQ","UN","UT"].includes(vr);
  const head=concatBytes([
    u16(group),u16(tag),encoder.encode(vr),
    long?new Uint8Array(2):new Uint8Array(0),
    long?u32(bytes.length):u16(bytes.length)
  ]);
  return concatBytes([head,bytes]);
}
function fileFromParts(parts,name,type){
  if(typeof File==="function")return new File(parts,name,{type,lastModified:Date.now()});
  const blob=new Blob(parts,{type});
  Object.defineProperty(blob,"name",{value:name,enumerable:true});
  Object.defineProperty(blob,"lastModified",{value:Date.now(),enumerable:true});
  return blob;
}
function pixelWordsFromDemoBytes(pixels,scale){
  const out=new Uint8Array(pixels.length*2);
  const view=new DataView(out.buffer);
  for(let index=0;index<pixels.length;index++)view.setUint16(index*2,pixels[index]*scale,true);
  return out;
}
function patientDemoEntries(z,pixels,meta){
  const sop=`1.2.826.0.1.3680043.10.7436.2000.${z+1}`;
  const zPosition=meta.imagePosition[2]-(z*meta.sliceSpacing);
  return [
    dicomElement(0x0002,0x0001,"OB",new Uint8Array([0,1])),
    dicomElement(0x0002,0x0002,"UI","1.2.840.10008.5.1.4.1.1.2"),
    dicomElement(0x0002,0x0003,"UI",sop),
    dicomElement(0x0002,0x0010,"UI","1.2.840.10008.1.2.1"),
    dicomElement(0x0008,0x0016,"UI","1.2.840.10008.5.1.4.1.1.2"),
    dicomElement(0x0008,0x0018,"UI",sop),
    dicomElement(0x0008,0x0060,"CS","CT"),
    dicomElement(0x0008,0x0070,"LO","OdontoView"),
    dicomElement(0x0008,0x1090,"LO","CBCT demo desidentificado"),
    dicomElement(0x0008,0x1030,"LO","OdontoView CBCT Demo"),
    dicomElement(0x0008,0x103e,"LO","Volume demonstrativo desidentificado"),
    dicomElement(0x0010,0x0010,"PN","PACIENTE DEMO"),
    dicomElement(0x0010,0x0020,"LO","DEMO01"),
    dicomElement(0x0018,0x0050,"DS",String(meta.sliceSpacing)),
    dicomElement(0x0018,0x0088,"DS",String(meta.sliceSpacing)),
    dicomElement(0x0020,0x000d,"UI","1.2.826.0.1.3680043.10.7436.2000.1"),
    dicomElement(0x0020,0x000e,"UI","1.2.826.0.1.3680043.10.7436.2000.2"),
    dicomElement(0x0020,0x0013,"IS",String(z+1)),
    dicomElement(0x0020,0x0032,"DS",`${meta.imagePosition[0]}\\${meta.imagePosition[1]}\\${zPosition.toFixed(6)}`),
    dicomElement(0x0020,0x0037,"DS",meta.orientation.join("\\")),
    dicomElement(0x0020,0x0052,"UI","1.2.826.0.1.3680043.10.7436.2000.3"),
    dicomElement(0x0028,0x0002,"US",1),
    dicomElement(0x0028,0x0004,"CS","MONOCHROME2"),
    dicomElement(0x0028,0x0008,"IS","1"),
    dicomElement(0x0028,0x0010,"US",meta.rows),
    dicomElement(0x0028,0x0011,"US",meta.columns),
    dicomElement(0x0028,0x0030,"DS",`${meta.pixelSpacing[0]}\\${meta.pixelSpacing[1]}`),
    dicomElement(0x0028,0x0100,"US",16),
    dicomElement(0x0028,0x0101,"US",16),
    dicomElement(0x0028,0x0102,"US",15),
    dicomElement(0x0028,0x0103,"US",0),
    dicomElement(0x0028,0x1050,"DS","350"),
    dicomElement(0x0028,0x1051,"DS","2200"),
    dicomElement(0x0028,0x1052,"DS",String(meta.rescaleIntercept)),
    dicomElement(0x0028,0x1053,"DS",String(meta.rescaleSlope)),
    dicomElement(0x7fe0,0x0010,"OW",pixelWordsFromDemoBytes(pixels,meta.storedScale))
  ];
}

export function buildPatientDemoDicomSlice(z,pixels,meta=DEMO_VOLUME_META){
  if(!Number.isInteger(z)||z<0||z>=meta.sliceCount)throw new Error("Índice do corte demo inválido.");
  const expected=meta.rows*meta.columns;
  if(!(pixels instanceof Uint8Array)||pixels.length!==expected)throw new Error("Pixels do corte demo inválidos.");
  return concatBytes([new Uint8Array(128),encoder.encode("DICM"),...patientDemoEntries(z,pixels,meta)]);
}

export function createPatientDemoFiles(raw,meta=DEMO_VOLUME_META){
  const bytes=raw instanceof Uint8Array?raw:new Uint8Array(raw||0);
  const plane=meta.rows*meta.columns;
  const expected=meta.sliceCount*plane;
  if(bytes.length!==expected)throw new Error(`Volume demo inválido: esperado ${expected} bytes, recebido ${bytes.length}.`);
  return Array.from({length:meta.sliceCount},(_,z)=>{
    const pixels=bytes.subarray(z*plane,(z+1)*plane);
    return fileFromParts(
      [buildPatientDemoDicomSlice(z,pixels,meta)],
      `demo-${String(z+1).padStart(3,"0")}.dcm`,
      "application/dicom"
    );
  });
}

// Mantidos somente para compatibilidade de testes/labs antigos. O fluxo de produção não usa fallback sintético.
function syntheticPixels(rows,columns,z){
  const out=new Uint8Array(rows*columns);
  const cx=(columns-1)/2,cy=(rows-1)/2;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const dx=(x-cx)/columns,dy=(y-cy)/rows;
    const radius=Math.sqrt(dx*dx+dy*dy);
    out[y*columns+x]=Math.max(0,Math.min(255,Math.round(50+150*Math.exp(-Math.pow(radius-.24,2)/.0035)+25*Math.sin((x+y+z)*.18))));
  }
  return out;
}
export function buildSyntheticDemoDicomSlice(z,{rows=96,columns=96}={}){
  const meta={...DEMO_VOLUME_META,sliceCount:100,rows,columns,pixelSpacing:[0.3,0.3],sliceSpacing:0.5,imagePosition:[0,0,0],storedScale:16};
  return buildPatientDemoDicomSlice(z,syntheticPixels(rows,columns,z),meta);
}
export function createSyntheticDemoFiles(count=100){
  return Array.from({length:count},(_,z)=>fileFromParts([buildSyntheticDemoDicomSlice(z)],`demo-${String(z+1).padStart(3,"0")}.dcm`,"application/dicom"));
}

async function gunzipBytes(bytes){
  if(typeof DecompressionStream!=="function")throw new Error("Este navegador não suporta a descompressão do exame demo.");
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function storedToken(explicitToken){
  if(explicitToken)return explicitToken;
  try{return globalThis.localStorage?.getItem?.("odontoview_token")||null;}catch{return null;}
}

export async function checkDemoExamAvailability(){
  return true;
}

export async function loadDemoExam({onProgress,fetcher=globalThis.fetch,importer=importExam,token=null}={}){
  const authToken=storedToken(token);
  if(!authToken)throw new Error("Entre no OdontoView para abrir o paciente demo.");
  if(typeof fetcher!=="function")throw new Error("Não foi possível carregar o volume demo.");
  onProgress?.({phase:"download",label:"Carregando CBCT demo…",source:"private-real-demo"});
  let response;
  try{
    response=await fetcher(DEMO_EXAM.url,{
      cache:"no-store",
      headers:{Authorization:"Bearer "+authToken,Accept:"application/gzip"}
    });
  }catch{
    throw new Error("Volume demo indisponível no momento.");
  }
  if(!response?.ok)throw new Error(`Volume demo indisponível (${response?.status||"erro"}).`);
  if(typeof response.arrayBuffer!=="function")throw new Error("Resposta inválida ao carregar o volume demo.");
  const compressed=new Uint8Array(await response.arrayBuffer());
  if(!compressed.length)throw new Error("Volume demo vazio.");
  onProgress?.({phase:"extract",label:"Preparando cortes DICOM demo…",source:"private-real-demo"});
  const raw=await gunzipBytes(compressed);
  const files=createPatientDemoFiles(raw);
  onProgress?.({phase:"metadata",label:"Abrindo CBCT demo…",current:0,total:files.length,source:"private-real-demo"});
  return importer(files,{onProgress});
}
