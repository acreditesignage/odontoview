import {importExam} from "./ingest.js";

const encoder=new TextEncoder();

export const DEMO_EXAM={
  id:"odontoview-cbct-demo-v1",
  label:"Paciente Demo OdontoView",
  patientName:"Paciente Demo",
  examType:"Tomografia CBCT",
  url:"/demo/odontoview-demo.zip",
  fileName:"odontoview-demo.zip",
  fallbackSliceCount:100
};

function concatBytes(parts){
  const total=parts.reduce((sum,part)=>sum+part.length,0);
  const out=new Uint8Array(total);
  let offset=0;
  for(const part of parts){out.set(part,offset);offset+=part.length}
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
function pixelsForSlice(rows,columns,z){
  const out=new Uint8Array(rows*columns*2);
  const view=new DataView(out.buffer);
  const cx=(columns-1)/2,cy=(rows-1)/2;
  for(let y=0;y<rows;y++){
    for(let x=0;x<columns;x++){
      const dx=(x-cx)/columns,dy=(y-cy)/rows;
      const radius=Math.sqrt(dx*dx+dy*dy);
      const arch=Math.exp(-Math.pow(radius-.24,2)/.0035)*1050;
      const detail=(Math.sin((x+z)*.28)+Math.cos((y-z)*.31))*120;
      const core=Math.exp(-(dx*dx+dy*dy)/.04)*650;
      const value=Math.max(0,Math.min(3000,Math.round(420+arch+core+detail+z*3)));
      view.setUint16((y*columns+x)*2,value,true);
    }
  }
  return out;
}
function fileFromParts(parts,name,type){
  if(typeof File==="function")return new File(parts,name,{type,lastModified:Date.now()});
  const blob=new Blob(parts,{type});
  Object.defineProperty(blob,"name",{value:name,enumerable:true});
  Object.defineProperty(blob,"lastModified",{value:Date.now(),enumerable:true});
  return blob;
}

export function buildSyntheticDemoDicomSlice(z,{rows=96,columns=96,spacingZ=.5}={}){
  const sop=`1.2.826.0.1.3680043.10.7436.${z+1000}`;
  const entries=[
    dicomElement(0x0002,0x0001,"OB",new Uint8Array([0,1])),
    dicomElement(0x0002,0x0002,"UI","1.2.840.10008.5.1.4.1.1.2"),
    dicomElement(0x0002,0x0003,"UI",sop),
    dicomElement(0x0002,0x0010,"UI","1.2.840.10008.1.2.1"),
    dicomElement(0x0008,0x0016,"UI","1.2.840.10008.5.1.4.1.1.2"),
    dicomElement(0x0008,0x0018,"UI",sop),
    dicomElement(0x0008,0x0060,"CS","CT"),
    dicomElement(0x0008,0x0070,"LO","OdontoView"),
    dicomElement(0x0008,0x1090,"LO","Paciente Demo Sintetico"),
    dicomElement(0x0008,0x1030,"LO","OdontoView CBCT Demo"),
    dicomElement(0x0008,0x103e,"LO","Serie demonstrativa desidentificada"),
    dicomElement(0x0010,0x0010,"PN","PACIENTE DEMO"),
    dicomElement(0x0010,0x0020,"LO","DEMO01"),
    dicomElement(0x0018,0x0050,"DS",String(spacingZ)),
    dicomElement(0x0018,0x0088,"DS",String(spacingZ)),
    dicomElement(0x0020,0x000d,"UI","1.2.826.0.1.3680043.10.7436.1"),
    dicomElement(0x0020,0x000e,"UI","1.2.826.0.1.3680043.10.7436.2"),
    dicomElement(0x0020,0x0013,"IS",String(z+1)),
    dicomElement(0x0020,0x0032,"DS",`0\\0\\${(z*spacingZ).toFixed(3)}`),
    dicomElement(0x0020,0x0037,"DS","1\\0\\0\\0\\1\\0"),
    dicomElement(0x0020,0x0052,"UI","1.2.826.0.1.3680043.10.7436.3"),
    dicomElement(0x0028,0x0002,"US",1),
    dicomElement(0x0028,0x0004,"CS","MONOCHROME2"),
    dicomElement(0x0028,0x0008,"IS","1"),
    dicomElement(0x0028,0x0010,"US",rows),
    dicomElement(0x0028,0x0011,"US",columns),
    dicomElement(0x0028,0x0030,"DS","0.3\\0.3"),
    dicomElement(0x0028,0x0100,"US",16),
    dicomElement(0x0028,0x0101,"US",16),
    dicomElement(0x0028,0x0102,"US",15),
    dicomElement(0x0028,0x0103,"US",0),
    dicomElement(0x0028,0x1050,"DS","1000"),
    dicomElement(0x0028,0x1051,"DS","2200"),
    dicomElement(0x0028,0x1052,"DS","0"),
    dicomElement(0x0028,0x1053,"DS","1"),
    dicomElement(0x7fe0,0x0010,"OW",pixelsForSlice(rows,columns,z))
  ];
  return concatBytes([new Uint8Array(128),encoder.encode("DICM"),...entries]);
}

export function createSyntheticDemoFiles(count=DEMO_EXAM.fallbackSliceCount){
  return Array.from({length:count},(_,z)=>fileFromParts(
    [buildSyntheticDemoDicomSlice(z)],
    `demo-${String(z+1).padStart(3,"0")}.dcm`,
    "application/dicom"
  ));
}

async function loadPublishedDemo(fetcher){
  if(typeof fetcher!=="function")return null;
  try{
    const response=await fetcher(DEMO_EXAM.url,{cache:"no-store"});
    if(!response?.ok)return null;
    const type=(response.headers?.get?.("content-type")||"").toLowerCase();
    if(type.includes("text/html")||typeof response.blob!=="function")return null;
    const blob=await response.blob();
    if(!blob?.size)return null;
    return fileFromParts([blob],DEMO_EXAM.fileName,"application/zip");
  }catch{
    return null;
  }
}

export async function checkDemoExamAvailability(){
  return true;
}

export async function loadDemoExam({onProgress,fetcher=globalThis.fetch,importer=importExam}={}){
  onProgress?.({phase:"download",label:"Preparando exame demo…"});
  const published=await loadPublishedDemo(fetcher);
  if(published){
    onProgress?.({phase:"download",label:"Abrindo exame demo…",source:"published"});
    return importer([published],{onProgress});
  }
  onProgress?.({phase:"download",label:"Gerando CBCT demo local…",source:"synthetic"});
  return importer(createSyntheticDemoFiles(),{onProgress});
}
