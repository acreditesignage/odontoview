import React,{useEffect,useState} from "react";
import Viewer2 from "./Viewer2.jsx";
import {importExam} from "./ingest.js";
import {clearViewerSession,setViewerSession} from "./viewerSession.js";

const encoder=new TextEncoder();

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
function element(group,tag,vr,value){
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
      const value=Math.max(0,Math.min(3000,Math.round(420+arch+core+detail+z*4)));
      view.setUint16((y*columns+x)*2,value,true);
    }
  }
  return out;
}
function dicomSlice(z,{rows=96,columns=96,spacingZ=.5}={}){
  const sop=`1.2.826.0.1.3680043.10.543.${z+1000}`;
  const entries=[
    element(0x0002,0x0001,"OB",new Uint8Array([0,1])),
    element(0x0002,0x0002,"UI","1.2.840.10008.5.1.4.1.1.2"),
    element(0x0002,0x0003,"UI",sop),
    element(0x0002,0x0010,"UI","1.2.840.10008.1.2.1"),
    element(0x0008,0x0016,"UI","1.2.840.10008.5.1.4.1.1.2"),
    element(0x0008,0x0018,"UI",sop),
    element(0x0008,0x0060,"CS","CT"),
    element(0x0008,0x0070,"LO","OdontoView Synthetic"),
    element(0x0008,0x1090,"LO","Layout Smoke Fixture"),
    element(0x0008,0x1030,"LO","Synthetic CBCT layout study"),
    element(0x0008,0x103e,"LO","Synthetic planning series"),
    element(0x0018,0x0050,"DS",String(spacingZ)),
    element(0x0018,0x0088,"DS",String(spacingZ)),
    element(0x0020,0x000d,"UI","1.2.826.0.1.3680043.10.543.1"),
    element(0x0020,0x000e,"UI","1.2.826.0.1.3680043.10.543.2"),
    element(0x0020,0x0013,"IS",String(z+1)),
    element(0x0020,0x0032,"DS",`0\\0\\${(z*spacingZ).toFixed(3)}`),
    element(0x0020,0x0037,"DS","1\\0\\0\\0\\1\\0"),
    element(0x0020,0x0052,"UI","1.2.826.0.1.3680043.10.543.3"),
    element(0x0028,0x0002,"US",1),
    element(0x0028,0x0004,"CS","MONOCHROME2"),
    element(0x0028,0x0008,"IS","1"),
    element(0x0028,0x0010,"US",rows),
    element(0x0028,0x0011,"US",columns),
    element(0x0028,0x0030,"DS","0.3\\0.3"),
    element(0x0028,0x0100,"US",16),
    element(0x0028,0x0101,"US",16),
    element(0x0028,0x0102,"US",15),
    element(0x0028,0x0103,"US",0),
    element(0x0028,0x1050,"DS","1000"),
    element(0x0028,0x1051,"DS","2200"),
    element(0x0028,0x1052,"DS","0"),
    element(0x0028,0x1053,"DS","1"),
    element(0x7fe0,0x0010,"OW",pixelsForSlice(rows,columns,z))
  ];
  return concatBytes([new Uint8Array(128),encoder.encode("DICM"),...entries]);
}
function syntheticSeries(count=48){
  return Array.from({length:count},(_,z)=>{
    const bytes=dicomSlice(z);
    return new File([bytes],`layout-${String(z+1).padStart(3,"0")}.dcm`,{type:"application/dicom"});
  });
}

export default function Viewer2LayoutSmoke(){
  const [ready,setReady]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        clearViewerSession();
        const result=await importExam(syntheticSeries());
        if(!result?.validSeriesCount)throw new Error("Synthetic DICOM series was not accepted.");
        setViewerSession({
          result,
          isDemo:false,
          order:{
            patient:{name:"Paciente sintético"},
            examType:{name:"CBCT • validação visual"}
          }
        });
        if(active)setReady(true);
      }catch(err){
        if(active)setError(err?.stack||err?.message||String(err));
      }
    })();
    return()=>{active=false;clearViewerSession()};
  },[]);
  if(error)return <pre data-layout-smoke-error style={{padding:24,whiteSpace:"pre-wrap"}}>{error}</pre>;
  if(!ready)return <main className="viewer2-loading"><div className="viewer2-loading-card"><div className="brand">OdontoView</div><h1>Preparando fixture visual…</h1></div></main>;
  return <Viewer2/>;
}
