import React,{useEffect,useMemo,useRef,useState} from "react";
import {useNavigate,useSearchParams} from "react-router-dom";
import {jsPDF} from "jspdf";
import Viewer3DPanel from "./Viewer3DPanel.jsx";
import {implantAxisVector} from "./implantLibrary.js";
import {PERMANENT_FDI_LIBRARY,TOOTH_ARCH_ROWS,toothByFDI} from "./toothLibrary.js";
import {clearViewerSession,getViewerSession} from "./viewerSession.js";

const PANORAMIC_BAND_HALF_MM=2;

function detectViewerDeviceProfile(){
  if(typeof window==="undefined")return "desktop";
  const width=Math.max(window.innerWidth||0,document.documentElement?.clientWidth||0);
  const coarse=window.matchMedia?.("(pointer: coarse)")?.matches===true;
  const ua=String(navigator.userAgent||"");
  if(width<=760)return "phone";
  if((coarse&&width<=1400)||/iPad|Android/i.test(ua))return "tablet";
  return "desktop";
}

let cornerstoneConfigured=false;
function configureCornerstone(){
  if(cornerstoneConfigured)return;
  const cornerstone=window.cornerstone;
  const loader=window.cornerstoneWADOImageLoader;
  const parser=window.dicomParser;
  if(!cornerstone||!loader||!parser) throw new Error("Bibliotecas locais do Viewer DICOM não foram carregadas.");
  loader.external.cornerstone=cornerstone;
  loader.external.dicomParser=parser;
  loader.configure({useWebWorkers:false});
  cornerstoneConfigured=true;
}

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function sample(volume,w,h,d,x,y,z){
  if(x<0||y<0||z<0||x>=w||y>=h||z>=d)return 0;
  return volume[z*w*h+y*w+x];
}
function bilinear(volume,w,h,d,x,y,z){
  const x0=Math.floor(x),y0=Math.floor(y),x1=x0+1,y1=y0+1;
  const tx=x-x0,ty=y-y0;
  const a=sample(volume,w,h,d,x0,y0,z),b=sample(volume,w,h,d,x1,y0,z);
  const c=sample(volume,w,h,d,x0,y1,z),e=sample(volume,w,h,d,x1,y1,z);
  return (a*(1-tx)+b*tx)*(1-ty)+(c*(1-tx)+e*tx)*ty;
}
function wl(value,wc,ww){
  const lo=wc-ww/2,hi=wc+ww/2;
  if(value<=lo)return 0;if(value>=hi)return 255;
  return Math.round((value-lo)/ww*255);
}
function defaultArch(w,h){
  return [
    {x:w*.18,y:h*.66},{x:w*.27,y:h*.49},{x:w*.39,y:h*.39},
    {x:w*.50,y:h*.36},{x:w*.61,y:h*.39},{x:w*.73,y:h*.49},{x:w*.82,y:h*.66}
  ];
}
function catmullRom(points,samplesPerSegment=18){
  if(points.length<2)return points;
  const out=[];
  for(let i=0;i<points.length-1;i++){
    const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
    for(let j=0;j<samplesPerSegment;j++){
      const t=j/samplesPerSegment,t2=t*t,t3=t2*t;
      out.push({
        x:.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y:.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
      });
    }
  }
  out.push(points[points.length-1]);
  return out;
}
function percentileWindow(volume){
  const values=[];
  const step=Math.max(1,Math.floor(volume.length/50000));
  for(let i=0;i<volume.length;i+=step)values.push(volume[i]);
  values.sort((a,b)=>a-b);
  const p=(q)=>values[Math.floor((values.length-1)*q)]||0;
  const lo=p(.02),hi=p(.98);
  return {wc:(lo+hi)/2,ww:Math.max(1,hi-lo)};
}
function planeSlice(meta,plane,cursor,curveIndex){
  if(plane==="axial")return cursor.z;
  if(plane==="coronal")return cursor.y;
  if(plane==="sagittal")return cursor.x;
  if(plane==="tangential")return curveIndex;
  return 0;
}
function measurementDistance(m,meta){
  const da=m.b.a-m.a.a,db=m.b.b-m.a.b;
  return Math.hypot(da*m.spacingA,db*m.spacingB);
}

function interpolateNervePath(points){
  const anchors=[...points].sort((a,b)=>a.curveIndex-b.curveIndex);
  if(anchors.length<2)return anchors;
  const out=[];
  for(let i=0;i<anchors.length-1;i++){
    const a=anchors[i],b=anchors[i+1];
    if(i===0)out.push({...a,generated:false});
    const span=Math.max(1,b.curveIndex-a.curveIndex);
    for(let idx=a.curveIndex+1;idx<b.curveIndex;idx++){
      const t=(idx-a.curveIndex)/span;
      out.push({
        id:`generated-${a.id||i}-${b.id||i+1}-${idx}`,
        curveIndex:idx,
        z:a.z+(b.z-a.z)*t,
        offsetMm:a.offsetMm+(b.offsetMm-a.offsetMm)*t,
        generated:true
      });
    }
    out.push({...b,generated:false});
  }
  return out;
}

function ViewerBootIntro({loading}){
  return <div className="viewer-boot" role="presentation" aria-hidden="true">
    <div className="viewer-boot-glow"/>
    <div className="viewer-boot-orbit viewer-boot-orbit-a"/>
    <div className="viewer-boot-orbit viewer-boot-orbit-b"/>
    <div className="viewer-boot-beam viewer-boot-beam-a"/>
    <div className="viewer-boot-beam viewer-boot-beam-b"/>
    <div className="viewer-boot-scan"/>
    <div className="viewer-boot-center">
      <div className="viewer-boot-mark">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id="ovBootGradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#21f2e7"/>
              <stop offset="52%" stopColor="#18b7ee"/>
              <stop offset="100%" stopColor="#0a74d8"/>
            </linearGradient>
            <filter id="ovBootGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <path className="viewer-boot-tooth" d="M34 22C23 30 20 46 25 59c4 10 8 18 10 30 2 12 7 15 12 4l7-17c2-5 10-5 12 0l7 17c5 11 10 8 12-4 2-12 6-20 10-30 5-13 2-29-9-37-8-6-17-4-26 0-9-4-18-6-26 0Z" fill="none" stroke="url(#ovBootGradient)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#ovBootGlow)"/>
          <path className="viewer-boot-slice" d="M18 60h84" fill="none" stroke="url(#ovBootGradient)" strokeWidth="2.6" strokeLinecap="round"/>
          <path className="viewer-boot-slice viewer-boot-slice-two" d="M28 48h64" fill="none" stroke="url(#ovBootGradient)" strokeWidth="1.6" strokeLinecap="round"/>
          <circle className="viewer-boot-pulse" cx="60" cy="60" r="4.5" fill="#26eee3"/>
        </svg>
      </div>
      <div className="viewer-boot-word">Odonto<span>View</span></div>
      <div className="viewer-boot-tagline">IMAGEM ODONTOLÓGICA SEM LIMITES</div>
      <div className="viewer-boot-status">{loading?"Preparando exame…":"Exame pronto"}</div>
    </div>
  </div>;
}

export default function Viewer2(){
  const nav=useNavigate(),[query]=useSearchParams();
  const session=useMemo(()=>getViewerSession(),[]);
  const deviceProfile=useMemo(()=>detectViewerDeviceProfile(),[]);
  const [showIntro,setShowIntro]=useState(true);
  const storedRole=localStorage.getItem("odontoview_role")||"";
  const fallbackHome=storedRole==="UNIT_USER"?"/radiologia":storedRole==="DENTIST"?"/dentista":"/";
  const origin=query.get("from")||(storedRole==="UNIT_USER"?"radiology":storedRole==="DENTIST"?"dentist":"shared");
  const requestedReturn=query.get("returnTo")||"";
  const returnTo=(requestedReturn.startsWith("/dentista")||requestedReturn.startsWith("/radiologia"))?requestedReturn:fallbackHome;
  const returnLabel=origin==="dentist"?"Voltar aos meus exames":origin==="radiology"?"Voltar à radiologia":"Ir para o início";
  const profileHome=fallbackHome;
  const volumeRef=useRef(null);
  const metaRef=useRef(null);
  const defaultWindowRef=useRef({wc:400,ww:2000});
  const defaultCurveRef=useRef([]);
  const curveBeforeAssistRef=useRef(null);
  const dragRef=useRef(null);
  const curveDragRef=useRef(null);
  const navDragRef=useRef(null);
  const implantDragRef=useRef(null);
  const touchTapRef=useRef(null);
  const [loading,setLoading]=useState(true);
  const [loadProgress,setLoadProgress]=useState({current:0,total:0,label:"Preparando DICOM…"});
  const [error,setError]=useState("");
  const [meta,setMeta]=useState(null);
  const [threeDEnabled,setThreeDEnabled]=useState(deviceProfile==="desktop");
  const [showAdvancedTools,setShowAdvancedTools]=useState(false);
  const [archSetupOpen,setArchSetupOpen]=useState(false);
  const [archSetupBusy,setArchSetupBusy]=useState(false);
  const [dentalArchType,setDentalArchType]=useState("unknown");
  const [cursor,setCursor]=useState({x:0,y:0,z:0});
  const [curvePoints,setCurvePoints]=useState([]);
  const curve=useMemo(()=>catmullRom(curvePoints,18),[curvePoints]);
  const [curveIndex,setCurveIndex]=useState(0);
  const [archMode,setArchMode]=useState("auto");
  const [autoArchRange,setAutoArchRange]=useState({start:0,end:0,label:"Analisando…",confidence:0});
  const archRange=useMemo(()=>{
    const last=Math.max(0,curve.length-1);
    if(!curve.length)return {start:0,end:0,label:"Sem curva",confidence:0};
    if(archMode==="full")return {start:0,end:last,label:"Arcada completa",confidence:1};
    if(archMode==="left"){
      const end=Math.min(last,Math.round(last*.58));
      return {start:0,end,label:"Semi-arcada • lado esquerdo da imagem",confidence:1};
    }
    if(archMode==="right"){
      const start=Math.max(0,Math.round(last*.42));
      return {start,end:last,label:"Semi-arcada • lado direito da imagem",confidence:1};
    }
    return {start:clamp(autoArchRange.start,0,last),end:clamp(autoArchRange.end,0,last),label:autoArchRange.label,confidence:autoArchRange.confidence};
  },[curve.length,archMode,autoArchRange]);
  const [tool,setTool]=useState("navigate");
  const [expandedPanel,setExpandedPanel]=useState(null);
  const [crosshairVisible,setCrosshairVisible]=useState(true);
  const [windowLevel,setWindowLevel]=useState({wc:400,ww:2000});
  const [measurements,setMeasurements]=useState([]);
  const [pendingMeasure,setPendingMeasure]=useState(null);
  const [nervePoints,setNervePoints]=useState([]);
  const [nerveAssist,setNerveAssist]=useState(true);
  const nerveDisplayPoints=useMemo(()=>nerveAssist?interpolateNervePath(nervePoints):[...nervePoints].sort((a,b)=>a.curveIndex-b.curveIndex),[nervePoints,nerveAssist]);
  const [foramina,setForamina]=useState([]);
  const [implants,setImplants]=useState([]);
  const [activeImplantId,setActiveImplantId]=useState(null);
  const [plannedTeeth,setPlannedTeeth]=useState([]);
  const [selectedToothFDI,setSelectedToothFDI]=useState("11");
  const selectedTooth=useMemo(()=>toothByFDI(selectedToothFDI),[selectedToothFDI]);
  const selectedToothPlaced=plannedTeeth.some(item=>item.fdi===selectedToothFDI);

  useEffect(()=>{
    if(!showIntro)return;
    const timer=setTimeout(()=>setShowIntro(false),2350);
    return ()=>clearTimeout(timer);
  },[showIntro]);

  function placeSelectedToothAtCursor(){
    const catalog=selectedTooth;
    if(!catalog||!meta)return;
    const next={
      ...catalog,
      id:"planned-tooth-"+catalog.fdi,
      x:cursor.x,
      y:cursor.y,
      z:cursor.z,
      curveIndex,
      placedAt:Date.now()
    };
    setPlannedTeeth(items=>[...items.filter(item=>item.fdi!==catalog.fdi),next]);
  }

  function focusPlannedTooth(item){
    if(!item||!meta)return;
    setCursor({
      x:clamp(Number(item.x)||0,0,meta.w-1),
      y:clamp(Number(item.y)||0,0,meta.h-1),
      z:clamp(Number(item.z)||0,0,meta.d-1)
    });
    if(Number.isFinite(item.curveIndex)&&curve.length)setCurveIndex(clamp(item.curveIndex,archRange.start,archRange.end));
    setSelectedToothFDI(item.fdi);
  }

  function removePlannedTooth(fdi){
    setPlannedTeeth(items=>items.filter(item=>item.fdi!==String(fdi)));
  }

  function updateCursorFrom3D(next){
    if(!meta||!next)return;
    const normalized={
      x:clamp(Number(next.x)||0,0,meta.w-1),
      y:clamp(Number(next.y)||0,0,meta.h-1),
      z:clamp(Number(next.z)||0,0,meta.d-1)
    };
    setCursor(normalized);
    if(curve.length){
      let best=0,bestDist=Infinity;
      for(let i=0;i<curve.length;i++){
        const dx=(curve[i].x-normalized.x)*meta.spacingX;
        const dy=(curve[i].y-normalized.y)*meta.spacingY;
        const dist=dx*dx+dy*dy;
        if(dist<bestDist){bestDist=dist;best=i}
      }
      setCurveIndex(clamp(best,archRange.start,archRange.end));
    }
  }

  useEffect(()=>{
    const m=meta,implant=implants.find(item=>item.id===activeImplantId);
    if(!m||!implant)return;
    const next={
      x:clamp(implant.x/m.spacingX,0,m.w-1),
      y:clamp(implant.y/m.spacingY,0,m.h-1),
      z:clamp(implant.z/m.spacingZ,0,m.d-1)
    };
    setCursor(current=>{
      if(Math.abs(current.x-next.x)<1e-4&&Math.abs(current.y-next.y)<1e-4&&Math.abs(current.z-next.z)<1e-4)return current;
      return next;
    });
  },[implants,activeImplantId,meta]);
  const [exportCount,setExportCount]=useState(15);
  const [exportMode,setExportMode]=useState("complete");
  const [exportBusy,setExportBusy]=useState(false);
  const [exportMessage,setExportMessage]=useState("");
  const [curveAssistMessage,setCurveAssistMessage]=useState("");
  const [transforms,setTransforms]=useState({
    axial:{zoom:1,panX:0,panY:0},coronal:{zoom:1,panX:0,panY:0},
    sagittal:{zoom:1,panX:0,panY:0},tangential:{zoom:1,panX:0,panY:0},panoramic:{zoom:1,panX:0,panY:0}
  });
  const canvases={
    axial:useRef(null),coronal:useRef(null),sagittal:useRef(null),tangential:useRef(null),panoramic:useRef(null)
  };

  useEffect(()=>{
    let cancelled=false;
    async function build(){
      if(!session?.result){setError("Nenhum exame local foi enviado ao Viewer 2.0.");setLoading(false);return}
      try{
        configureCornerstone();
        const validIndex=session.result.series.findIndex(s=>s.valid);
        if(validIndex<0)throw new Error("Nenhuma série DICOM válida disponível para montar o volume.");
        const report=session.result.report.series[validIndex];
        const sorted=report.sortedItems?.length?report.sortedItems:report.items;
        const files=sorted.map(item=>session.result.files[item.fileIndex]).filter(Boolean);
        if(!files.length)throw new Error("Não foi possível relacionar a série validada aos arquivos DICOM.");
        const cornerstone=window.cornerstone;
        const cornerstoneWADOImageLoader=window.cornerstoneWADOImageLoader;
        cornerstoneWADOImageLoader.wadouri.fileManager.purge();
        const ids=files.map(file=>cornerstoneWADOImageLoader.wadouri.fileManager.add(file));
        setLoadProgress({current:0,total:ids.length,label:"Lendo série DICOM…"});
        const first=await cornerstone.loadAndCacheImage(ids[0]);
        const w=first.columns,h=first.rows,d=ids.length;
        const volume=new Int16Array(w*h*d);
        const slope0=Number(first.slope)||1,intercept0=Number(first.intercept)||0;
        const yieldEvery=deviceProfile==="desktop"?18:4;
        for(let z=0;z<d;z++){
          if(cancelled)return;
          const image=z===0?first:await cornerstone.loadAndCacheImage(ids[z]);
          const px=image.getPixelData(),s=Number(image.slope)||slope0,i=Number(image.intercept)||intercept0;
          const off=z*w*h,n=w*h;
          const canDirectCopy=s===1&&i===0&&Number(image.minPixelValue??-32768)>=-32768&&Number(image.maxPixelValue??32767)<=32767;
          if(canDirectCopy)volume.set(px,off);
          else for(let p=0;p<n;p++)volume[off+p]=clamp(Math.round(px[p]*s+i),-32768,32767);
          try{cornerstone.imageCache?.removeImageLoadObject?.(ids[z])}catch{}
          if(z===d-1||z%yieldEvery===0){
            setLoadProgress({current:z+1,total:d,label:"Montando volume DICOM…"});
            if(deviceProfile!=="desktop")await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
          }
        }
        if(cancelled)return;
        const firstItem=sorted[0]||{};
        const spacingY=Number(firstItem.pixelSpacing?.[0])||Number(first.rowPixelSpacing)||1;
        const spacingX=Number(firstItem.pixelSpacing?.[1])||Number(first.columnPixelSpacing)||1;
        const spacingZ=Number(report.nominalSpacing)||Number(first.sliceThickness)||1;
        setLoadProgress({current:d,total:d,label:"Finalizando MPR…"});
        const computedWindow=(Number.isFinite(Number(first.windowCenter))&&Number(first.windowWidth)>0)
          ?{wc:Number(Array.isArray(first.windowCenter)?first.windowCenter[0]:first.windowCenter),ww:Number(Array.isArray(first.windowWidth)?first.windowWidth[0]:first.windowWidth)}
          :percentileWindow(volume);
        const nextMeta={w,h,d,spacingX,spacingY,spacingZ,manufacturer:session.result.series[validIndex].manufacturer,model:session.result.series[validIndex].model,seriesIndex:validIndex};
        try{cornerstone.imageCache?.purgeCache?.()}catch{}
        volumeRef.current=volume;metaRef.current=nextMeta;
        defaultWindowRef.current=computedWindow;
        setMeta(nextMeta);setWindowLevel(computedWindow);
        setCursor({x:Math.floor(w/2),y:Math.floor(h/2),z:Math.floor(d/2)});
        const arch=defaultArch(w,h);
        defaultCurveRef.current=arch.map(p=>({...p}));
        setCurvePoints(arch);
        const sampled=catmullRom(arch,18);setCurveIndex(Math.floor(sampled.length/2));
        setLoading(false);
        setArchSetupOpen(true);
      }catch(e){if(!cancelled){setError(e.message||"Falha ao montar o volume.");setLoading(false)}}
    }
    build();
    return()=>{cancelled=true};
  },[session]);

  useEffect(()=>{
    if(loading||!meta||!curve.length||archMode!=="auto")return;
    const detected=detectArchRange();
    setAutoArchRange(detected);
  },[loading,meta?.w,meta?.h,cursor.z,curvePoints,archMode]);

  useEffect(()=>{
    if(!curve.length)return;
    setCurveIndex(v=>clamp(v,archRange.start,archRange.end));
  },[archRange.start,archRange.end,curve.length]);

  useEffect(()=>{
    if(!expandedPanel)return;
    const close=e=>{if(e.key==="Escape")setExpandedPanel(null)};
    window.addEventListener("keydown",close);
    return()=>window.removeEventListener("keydown",close);
  },[expandedPanel]);

  function fit(canvas,pixelW,pixelH,spacingA,spacingB,plane){
    const rect=canvas.parentElement.getBoundingClientRect();
    const dprCap=deviceProfile==="phone"?1:deviceProfile==="tablet"?1.1:1.5;
    const dpr=Math.min(window.devicePixelRatio||1,dprCap);
    const cw=Math.max(1,Math.floor(rect.width*dpr)),ch=Math.max(1,Math.floor(rect.height*dpr));
    if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch}
    const t=transforms[plane]||{zoom:1,panX:0,panY:0};
    const physicalW=pixelW*spacingA,physicalH=pixelH*spacingB;
    const base=Math.min(cw/physicalW,ch/physicalH);
    const dw=physicalW*base*t.zoom,dh=physicalH*base*t.zoom;
    const ox=(cw-dw)/2+t.panX*dpr,oy=(ch-dh)/2+t.panY*dpr;
    canvas._map={ox,oy,dw,dh,pixelW,pixelH,spacingA,spacingB,dpr,plane};
    return {cw,ch,ox,oy,dw,dh,dpr};
  }

  function toImagePoint(canvas,event){
    const rect=canvas.getBoundingClientRect();
    const fallbackDpr=deviceProfile==="phone"?1:deviceProfile==="tablet"?1.1:1.5;
    const dpr=canvas._map?.dpr||Math.min(window.devicePixelRatio||1,fallbackDpr);
    const x=(event.clientX-rect.left)*dpr,y=(event.clientY-rect.top)*dpr;
    if(canvas._tangentialPanels?.length){
      for(const map of canvas._tangentialPanels){
        if(!map||map.curveIndex==null)continue;
        const a=(x-map.ox)/map.dw*map.pixelW,b=(y-map.oy)/map.dh*map.pixelH;
        if(a>=0&&b>=0&&a<map.pixelW&&b<map.pixelH)return {a,b,tangentialIndex:map.curveIndex};
      }
      return null;
    }
    const map=canvas._map;if(!map)return null;
    const a=(x-map.ox)/map.dw*map.pixelW,b=(y-map.oy)/map.dh*map.pixelH;
    if(a<0||b<0||a>=map.pixelW||b>=map.pixelH)return null;
    return {a,b};
  }

  function drawMeasurementOverlay(ctx,canvas,plane,currentSlice){
    const map=canvas._map;if(!map)return;
    const list=measurements.filter(m=>m.plane===plane&&m.slice===currentSlice);
    const pending=pendingMeasure&&pendingMeasure.plane===plane&&pendingMeasure.slice===currentSlice?[pendingMeasure]:[];
    [...list,...pending].forEach((m,index)=>{
      if(!m.a)return;
      const pt=(p)=>({x:map.ox+(p.a/map.pixelW)*map.dw,y:map.oy+(p.b/map.pixelH)*map.dh});
      const p1=pt(m.a);ctx.save();ctx.strokeStyle="#ffd166";ctx.fillStyle="#ffd166";ctx.lineWidth=2*map.dpr;
      ctx.beginPath();ctx.arc(p1.x,p1.y,4*map.dpr,0,Math.PI*2);ctx.fill();
      if(m.b){
        const p2=pt(m.b);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();
        ctx.beginPath();ctx.arc(p2.x,p2.y,4*map.dpr,0,Math.PI*2);ctx.fill();
        const label=(measurementDistance(m,metaRef.current)).toFixed(2)+" mm";
        ctx.font=`${12*map.dpr}px -apple-system,sans-serif`;const tw=ctx.measureText(label).width;
        ctx.fillStyle="rgba(0,0,0,.72)";ctx.fillRect((p1.x+p2.x)/2-tw/2-6*map.dpr,(p1.y+p2.y)/2-22*map.dpr,tw+12*map.dpr,18*map.dpr);
        ctx.fillStyle="#fff";ctx.fillText(label,(p1.x+p2.x)/2-tw/2,(p1.y+p2.y)/2-9*map.dpr);
      }ctx.restore();
    });
  }

  function drawCrosshair(ctx,canvas,a,b){
    const map=canvas?._map;if(!map)return;
    const x=map.ox+(a/map.pixelW)*map.dw,y=map.oy+(b/map.pixelH)*map.dh;
    const gap=7*map.dpr;
    ctx.save();
    ctx.strokeStyle="rgba(49,215,210,.95)";
    ctx.fillStyle="rgba(49,215,210,.95)";
    ctx.lineWidth=Math.max(1,1.15*map.dpr);
    ctx.beginPath();
    ctx.moveTo(map.ox,y);ctx.lineTo(x-gap,y);
    ctx.moveTo(x+gap,y);ctx.lineTo(map.ox+map.dw,y);
    ctx.moveTo(x,map.oy);ctx.lineTo(x,y-gap);
    ctx.moveTo(x,y+gap);ctx.lineTo(x,map.oy+map.dh);
    ctx.stroke();
    ctx.beginPath();ctx.arc(x,y,2.2*map.dpr,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  function paintToothMarker(ctx,map,a,b,tooth,active=false){
    if(!map||!tooth)return;
    const x=map.ox+(a/map.pixelW)*map.dw;
    const y=map.oy+(b/map.pixelH)*map.dh;
    const r=Math.max(9,10*map.dpr);
    ctx.save();
    ctx.shadowColor=active?"rgba(47,239,225,.72)":"rgba(112,198,255,.45)";
    ctx.shadowBlur=active?12*map.dpr:7*map.dpr;
    ctx.fillStyle=active?"rgba(10,39,49,.96)":"rgba(8,24,39,.90)";
    ctx.strokeStyle=active?"#35f0df":"#78c9ff";
    ctx.lineWidth=Math.max(1.5,1.4*map.dpr);
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle="#f3fbff";
    ctx.font=`700 ${Math.max(9,9.5*map.dpr)}px -apple-system,sans-serif`;
    ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(tooth.fdi,x,y+.2*map.dpr);
    ctx.restore();
  }

  function drawToothMarkersOrthogonal(ctx,canvas,plane,currentSlice){
    const m=metaRef.current,map=canvas?._map;
    if(!m||!map||!plannedTeeth.length)return;
    const tolerance=plane==="axial"
      ?Math.max(2,2/m.spacingZ)
      :plane==="coronal"
        ?Math.max(2,2/m.spacingY)
        :Math.max(2,2/m.spacingX);
    plannedTeeth.forEach(tooth=>{
      let a,b,normal;
      if(plane==="axial"){a=tooth.x;b=tooth.y;normal=tooth.z}
      else if(plane==="coronal"){a=tooth.x;b=m.d-1-tooth.z;normal=tooth.y}
      else{a=tooth.y;b=m.d-1-tooth.z;normal=tooth.x}
      if(Math.abs(normal-currentSlice)>tolerance)return;
      paintToothMarker(ctx,map,a,b,tooth,tooth.fdi===selectedToothFDI);
    });
  }

  function drawTangentialToothMarkers(ctx,map,frame,stepMm,index){
    const m=metaRef.current;if(!m||!map||!frame||!plannedTeeth.length)return;
    plannedTeeth.forEach(tooth=>{
      const toothIndex=Number.isFinite(tooth.curveIndex)?tooth.curveIndex:nearestCurveIndexWorld(tooth.x*m.spacingX,tooth.y*m.spacingY)?.index;
      if(toothIndex!==index)return;
      const dx=(tooth.x-frame.c.x)*m.spacingX,dy=(tooth.y-frame.c.y)*m.spacingY;
      const offset=dx*frame.nx+dy*frame.ny;
      const a=map.pixelW/2+offset/stepMm,b=m.d-1-tooth.z;
      paintToothMarker(ctx,map,a,b,tooth,tooth.fdi===selectedToothFDI);
    });
  }

  function drawPanoramicToothMarkers(ctx,map,start,end){
    const m=metaRef.current;if(!m||!map||!plannedTeeth.length)return;
    plannedTeeth.forEach(tooth=>{
      const hit=nearestCurveIndexWorld(tooth.x*m.spacingX,tooth.y*m.spacingY,start,end);
      if(!hit||hit.index<start||hit.index>end||hit.distance>14)return;
      paintToothMarker(ctx,map,hit.index-start,m.d-1-tooth.z,tooth,tooth.fdi===selectedToothFDI);
    });
  }

  function drawImplantOverlays(ctx,canvas,plane,currentSlice,showLabel=true){
    const m=metaRef.current,map=canvas?._map;
    if(!m||!map||!implants.length)return;
    const fixedWorld=plane==="axial"?currentSlice*m.spacingZ:plane==="coronal"?currentSlice*m.spacingY:currentSlice*m.spacingX;
    const normalKey=plane==="axial"?"z":plane==="coronal"?"y":"x";
    const project=p=>{
      if(plane==="axial")return {a:p.x/m.spacingX,b:p.y/m.spacingY};
      if(plane==="coronal")return {a:p.x/m.spacingX,b:m.d-1-p.z/m.spacingZ};
      return {a:p.y/m.spacingY,b:m.d-1-p.z/m.spacingZ};
    };
    const screen=p=>({x:map.ox+(p.a/map.pixelW)*map.dw,y:map.oy+(p.b/map.pixelH)*map.dh});
    const pxPerMm=(map.dw/(map.pixelW*map.spacingA)+map.dh/(map.pixelH*map.spacingB))/2;
    implants.forEach(implant=>{
      const axis=implantAxisVector(implant),half=implant.length/2,radius=implant.diameter/2;
      const center={x:implant.x,y:implant.y,z:implant.z};
      const normalCenter=center[normalKey],normalAxis=axis[normalKey];
      const min=normalCenter-Math.abs(normalAxis)*half-radius,max=normalCenter+Math.abs(normalAxis)*half+radius;
      if(fixedWorld<min||fixedWorld>max)return;
      const tipWorld={x:center.x-axis.x*half,y:center.y-axis.y*half,z:center.z-axis.z*half};
      const topWorld={x:center.x+axis.x*half,y:center.y+axis.y*half,z:center.z+axis.z*half};
      const tip=screen(project(tipWorld)),top=screen(project(topWorld));
      const active=implant.id===activeImplantId;
      const bodyColor=active?"rgba(28,240,215,.28)":"rgba(247,185,85,.22)";
      const lineColor=active?"rgba(56,255,229,.96)":"rgba(247,185,85,.88)";
      const coreColor=active?"#e8fffc":"#fff0c9";
      const dx=top.x-tip.x,dy=top.y-tip.y,len=Math.hypot(dx,dy);
      const outerR=Math.max(2.5,radius*pxPerMm);
      ctx.save();
      ctx.lineJoin="round";ctx.lineCap="round";
      if(len<6*map.dpr){
        const c=screen(project(center));
        ctx.fillStyle=bodyColor;ctx.strokeStyle=lineColor;ctx.lineWidth=Math.max(1.4,map.dpr);
        ctx.beginPath();ctx.arc(c.x,c.y,outerR,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.strokeStyle=coreColor;ctx.lineWidth=Math.max(1,map.dpr*.85);
        ctx.beginPath();ctx.arc(c.x,c.y,Math.max(1.4,outerR*.58),0,Math.PI*2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(c.x-outerR*.7,c.y);ctx.lineTo(c.x+outerR*.7,c.y);ctx.moveTo(c.x,c.y-outerR*.7);ctx.lineTo(c.x,c.y+outerR*.7);ctx.stroke();
      }else{
        const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
        const topR=outerR,tipR=Math.max(1.8,outerR*.34);
        const poly=[
          [top.x+nx*topR,top.y+ny*topR],
          [top.x-nx*topR,top.y-ny*topR],
          [tip.x-nx*tipR,tip.y-ny*tipR],
          [tip.x+nx*tipR,tip.y+ny*tipR]
        ];
        ctx.fillStyle=bodyColor;ctx.strokeStyle=lineColor;ctx.lineWidth=Math.max(1.5,map.dpr);
        ctx.beginPath();poly.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeStyle=coreColor;ctx.lineWidth=Math.max(1,map.dpr*.85);
        ctx.beginPath();ctx.moveTo(tip.x,tip.y);ctx.lineTo(top.x,top.y);ctx.stroke();
        const threadCount=Math.max(5,Math.min(14,Math.round(implant.length/.8)));
        ctx.strokeStyle=active?"rgba(210,255,248,.88)":"rgba(255,240,201,.76)";
        ctx.lineWidth=Math.max(.8,map.dpr*.7);
        for(let i=1;i<threadCount;i++){
          const t=i/threadCount;
          const cx=tip.x+dx*t,cy=tip.y+dy*t;
          const rr=tipR+(topR-tipR)*Math.min(1,t*1.35);
          const skew=((i%2)?1:-1)*Math.min(2.4*map.dpr,rr*.28);
          ctx.beginPath();
          ctx.moveTo(cx-nx*rr+ux*skew,cy-ny*rr+uy*skew);
          ctx.lineTo(cx+nx*rr-ux*skew,cy+ny*rr-uy*skew);
          ctx.stroke();
        }
        ctx.strokeStyle=lineColor;ctx.lineWidth=Math.max(1.3,map.dpr);
        ctx.beginPath();ctx.moveTo(top.x-nx*topR,top.y-ny*topR);ctx.lineTo(top.x+nx*topR,top.y+ny*topR);ctx.stroke();
      }
      if(active&&showLabel){
        const mid={x:(tip.x+top.x)/2,y:(tip.y+top.y)/2};
        ctx.fillStyle="rgba(3,14,20,.86)";ctx.font=`${10*map.dpr}px -apple-system,sans-serif`;
        const label=`${implant.model} • Ø${implant.diameter}×${implant.length}`;
        const tw=ctx.measureText(label).width;
        ctx.fillRect(mid.x-tw/2-5*map.dpr,mid.y-21*map.dpr,tw+10*map.dpr,16*map.dpr);
        ctx.fillStyle="#eafffb";ctx.fillText(label,mid.x-tw/2,mid.y-19*map.dpr);
      }
      ctx.restore();
    });
  }

  function drawMmScale(ctx,canvas,mapOverride=null){
    const map=mapOverride||canvas?._map;if(!map)return;
    const physicalW=map.pixelW*map.spacingA,physicalH=map.pixelH*map.spacingB;
    const minor=5,major=10;
    ctx.save();
    ctx.strokeStyle="rgba(210,230,245,.72)";
    ctx.fillStyle="rgba(220,238,250,.84)";
    ctx.lineWidth=Math.max(1,map.dpr*.75);
    ctx.font=`${Math.max(8,9*map.dpr)}px -apple-system,sans-serif`;
    ctx.textBaseline="top";
    for(let mm=0;mm<=physicalW+0.001;mm+=minor){
      const x=map.ox+(mm/physicalW)*map.dw;
      const len=(mm%major===0?7:4)*map.dpr;
      ctx.beginPath();ctx.moveTo(x,map.oy+map.dh);ctx.lineTo(x,map.oy+map.dh-len);ctx.stroke();
      if(mm>0&&mm%major===0&&map.dw>170*map.dpr)ctx.fillText(mm+"",x+2*map.dpr,map.oy+map.dh-15*map.dpr);
    }
    ctx.textBaseline="middle";
    for(let mm=0;mm<=physicalH+0.001;mm+=minor){
      const y=map.oy+map.dh-(mm/physicalH)*map.dh;
      const len=(mm%major===0?7:4)*map.dpr;
      ctx.beginPath();ctx.moveTo(map.ox,y);ctx.lineTo(map.ox+len,y);ctx.stroke();
      if(mm>0&&mm%major===0&&map.dh>170*map.dpr)ctx.fillText(mm+"",map.ox+9*map.dpr,y);
    }
    ctx.restore();
  }

  function curveOffsetPoint(index,offsetMm){
    const m=metaRef.current,frame=tangentFrame(index);if(!m||!frame)return null;
    return {
      x:frame.c.x+frame.nx*offsetMm/m.spacingX,
      y:frame.c.y+frame.ny*offsetMm/m.spacingY
    };
  }

  function drawAxial(canvas){
    const m=metaRef.current,v=volumeRef.current;if(!m||!v)return;
    const {w,h,d,spacingX,spacingY}=m,z=clamp(Math.round(cursor.z),0,d-1);
    const {cw,ch,ox,oy,dw,dh}=fit(canvas,w,h,spacingX,spacingY,"axial");
    const ctx=canvas.getContext("2d",{alpha:false}),img=ctx.createImageData(w,h);let p=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const g=wl(sample(v,w,h,d,x,y,z),windowLevel.wc,windowLevel.ww);img.data[p++]=g;img.data[p++]=g;img.data[p++]=g;img.data[p++]=255}
    const tmp=document.createElement("canvas");tmp.width=w;tmp.height=h;tmp.getContext("2d").putImageData(img,0,0);
    ctx.fillStyle="#05070a";ctx.fillRect(0,0,cw,ch);ctx.imageSmoothingEnabled=true;ctx.drawImage(tmp,ox,oy,dw,dh);
    const map=canvas._map,screen=(pt)=>({x:map.ox+pt.x/w*map.dw,y:map.oy+pt.y/h*map.dh});
    if(curve.length){
      ctx.save();
      const activeIndices=Array.from({length:Math.max(1,archRange.end-archRange.start+1)},(_,i)=>archRange.start+i);
      const upper=activeIndices.map(i=>curveOffsetPoint(i,PANORAMIC_BAND_HALF_MM)).filter(Boolean);
      const lower=activeIndices.map(i=>curveOffsetPoint(i,-PANORAMIC_BAND_HALF_MM)).filter(Boolean);
      if(upper.length===activeIndices.length&&lower.length===activeIndices.length){
        ctx.fillStyle="rgba(49,215,210,.10)";
        ctx.strokeStyle="rgba(49,215,210,.48)";
        ctx.lineWidth=1*map.dpr;
        ctx.beginPath();
        upper.forEach((pt,i)=>{const q=screen(pt);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});
        [...lower].reverse().forEach(pt=>{const q=screen(pt);ctx.lineTo(q.x,q.y)});
        ctx.closePath();ctx.fill();ctx.stroke();
      }
      ctx.strokeStyle="#31d7d2";ctx.lineWidth=2*map.dpr;ctx.beginPath();
      activeIndices.forEach((idx,i)=>{const q=screen(curve[idx]);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke();
      curvePoints.forEach((pt,j)=>{
        const idx=Math.round(j*(curve.length-1)/Math.max(1,curvePoints.length-1));
        if(idx<archRange.start||idx>archRange.end)return;
        const q=screen(pt);ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(q.x,q.y,4*map.dpr,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#31d7d2";ctx.stroke()
      });
      const active=curve[curveIndex];if(active){const q=screen(active);ctx.fillStyle="#31d7d2";ctx.beginPath();ctx.arc(q.x,q.y,6*map.dpr,0,Math.PI*2);ctx.fill()}
      ctx.restore();
    }
    nerveDisplayPoints.forEach(n=>{
      const c=curve[n.curveIndex];if(!c)return;const prev=curve[Math.max(0,n.curveIndex-1)],next=curve[Math.min(curve.length-1,n.curveIndex+1)];
      let tx=(next.x-prev.x)*m.spacingX,ty=(next.y-prev.y)*m.spacingY,len=Math.hypot(tx,ty)||1;tx/=len;ty/=len;
      const nx=-ty,ny=tx,pt={x:c.x+nx*n.offsetMm/m.spacingX,y:c.y+ny*n.offsetMm/m.spacingY},q=screen(pt);
      ctx.fillStyle="#ff2d2d";ctx.beginPath();ctx.arc(q.x,q.y,3.5*map.dpr,0,Math.PI*2);ctx.fill();
    });
    foramina.forEach(n=>{
      const c=curve[n.curveIndex];if(!c)return;const prev=curve[Math.max(0,n.curveIndex-1)],next=curve[Math.min(curve.length-1,n.curveIndex+1)];
      let tx=(next.x-prev.x)*m.spacingX,ty=(next.y-prev.y)*m.spacingY,len=Math.hypot(tx,ty)||1;tx/=len;ty/=len;
      const nx=-ty,ny=tx,pt={x:c.x+nx*n.offsetMm/m.spacingX,y:c.y+ny*n.offsetMm/m.spacingY},q=screen(pt);
      ctx.strokeStyle="#ff2d2d";ctx.lineWidth=3*map.dpr;ctx.beginPath();ctx.arc(q.x,q.y,7*map.dpr,0,Math.PI*2);ctx.stroke();
    });
    if(crosshairVisible)drawCrosshair(ctx,canvas,cursor.x,cursor.y);
    drawImplantOverlays(ctx,canvas,"axial",z);
    drawToothMarkersOrthogonal(ctx,canvas,"axial",z);
    drawMmScale(ctx,canvas);
    drawMeasurementOverlay(ctx,canvas,"axial",z);
  }

  function drawOrthogonal(canvas,plane){
    const m=metaRef.current,v=volumeRef.current;if(!m||!v)return;
    const {w,h,d,spacingX,spacingY,spacingZ}=m;
    const isCoronal=plane==="coronal";
    const pixelW=isCoronal?w:h,pixelH=d,spacingA=isCoronal?spacingX:spacingY,spacingB=spacingZ;
    const fixed=isCoronal?clamp(Math.round(cursor.y),0,h-1):clamp(Math.round(cursor.x),0,w-1);
    const {cw,ch,ox,oy,dw,dh}=fit(canvas,pixelW,pixelH,spacingA,spacingB,plane);
    const ctx=canvas.getContext("2d",{alpha:false}),img=ctx.createImageData(pixelW,pixelH);let p=0;
    for(let z=d-1;z>=0;z--)for(let a=0;a<pixelW;a++){
      const val=isCoronal?sample(v,w,h,d,a,fixed,z):sample(v,w,h,d,fixed,a,z),g=wl(val,windowLevel.wc,windowLevel.ww);
      img.data[p++]=g;img.data[p++]=g;img.data[p++]=g;img.data[p++]=255;
    }
    const tmp=document.createElement("canvas");tmp.width=pixelW;tmp.height=pixelH;tmp.getContext("2d").putImageData(img,0,0);
    ctx.fillStyle="#05070a";ctx.fillRect(0,0,cw,ch);ctx.imageSmoothingEnabled=true;ctx.drawImage(tmp,ox,oy,dw,dh);
    if(crosshairVisible){if(isCoronal)drawCrosshair(ctx,canvas,cursor.x,d-1-cursor.z);else drawCrosshair(ctx,canvas,cursor.y,d-1-cursor.z)}
    drawImplantOverlays(ctx,canvas,plane,fixed);
    drawToothMarkersOrthogonal(ctx,canvas,plane,fixed);
    drawMmScale(ctx,canvas);
    drawMeasurementOverlay(ctx,canvas,plane,fixed);
  }

  function tangentFrame(index){
    const m=metaRef.current;if(!m||!curve.length)return null;
    const c=curve[clamp(index,0,curve.length-1)],prev=curve[Math.max(0,index-1)],next=curve[Math.min(curve.length-1,index+1)];
    let tx=(next.x-prev.x)*m.spacingX,ty=(next.y-prev.y)*m.spacingY,len=Math.hypot(tx,ty)||1;tx/=len;ty/=len;
    return {c,nx:-ty,ny:tx,tx,ty};
  }

  function paintProjectedImplant(ctx,map,tip,top,radiusMm,active,label=""){
    const toScreen=p=>({x:map.ox+(p.a/map.pixelW)*map.dw,y:map.oy+(p.b/map.pixelH)*map.dh});
    const p1=toScreen(tip),p2=toScreen(top);
    const dx=p2.x-p1.x,dy=p2.y-p1.y,len=Math.hypot(dx,dy);
    const pxPerMm=(map.dw/(map.pixelW*map.spacingA)+map.dh/(map.pixelH*map.spacingB))/2;
    const rr=Math.max(2.5*map.dpr,radiusMm*pxPerMm);
    const line=active?"rgba(48,255,223,.98)":"rgba(248,190,82,.94)";
    const fill=active?"rgba(48,255,223,.30)":"rgba(248,190,82,.25)";
    ctx.save();ctx.lineCap="round";ctx.lineJoin="round";
    if(len<5*map.dpr){
      const c={x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2};
      ctx.fillStyle=fill;ctx.strokeStyle=line;ctx.lineWidth=Math.max(1.5,map.dpr);
      ctx.beginPath();ctx.arc(c.x,c.y,rr,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.strokeStyle="#effffc";ctx.lineWidth=Math.max(1,map.dpr*.8);
      ctx.beginPath();ctx.moveTo(c.x-rr*.7,c.y);ctx.lineTo(c.x+rr*.7,c.y);ctx.moveTo(c.x,c.y-rr*.7);ctx.lineTo(c.x,c.y+rr*.7);ctx.stroke();
    }else{
      const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
      const tipR=Math.max(1.8*map.dpr,rr*.36),topR=rr;
      ctx.fillStyle=fill;ctx.strokeStyle=line;ctx.lineWidth=Math.max(1.6,map.dpr);
      ctx.beginPath();ctx.moveTo(p2.x+nx*topR,p2.y+ny*topR);ctx.lineTo(p2.x-nx*topR,p2.y-ny*topR);ctx.lineTo(p1.x-nx*tipR,p1.y-ny*tipR);ctx.lineTo(p1.x+nx*tipR,p1.y+ny*tipR);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.strokeStyle="#effffc";ctx.lineWidth=Math.max(1,map.dpr*.8);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();
    }
    if(active&&label){
      const mid={x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2};
      ctx.font=`${10*map.dpr}px -apple-system,sans-serif`;
      const tw=ctx.measureText(label).width;
      ctx.fillStyle="rgba(3,14,20,.88)";ctx.fillRect(mid.x-tw/2-5*map.dpr,mid.y-22*map.dpr,tw+10*map.dpr,16*map.dpr);
      ctx.fillStyle="#eafffb";ctx.fillText(label,mid.x-tw/2,mid.y-20*map.dpr);
    }
    ctx.restore();
  }

  function drawTangentialImplants(ctx,map,frame,stepMm,showLabel=true){
    const m=metaRef.current;if(!m||!map||!frame)return;
    implants.forEach(implant=>{
      const axis=implantAxisVector(implant),half=implant.length/2,radius=implant.diameter/2;
      const cx=frame.c.x*m.spacingX,cy=frame.c.y*m.spacingY;
      const dx=implant.x-cx,dy=implant.y-cy;
      const planeDistance=dx*frame.tx+dy*frame.ty;
      const axisAcross=axis.x*frame.tx+axis.y*frame.ty;
      if(Math.abs(planeDistance)>Math.abs(axisAcross)*half+radius+1.2)return;
      const offset=dx*frame.nx+dy*frame.ny;
      const axisIn=axis.x*frame.nx+axis.y*frame.ny;
      const tip={a:map.pixelW/2+(offset-axisIn*half)/stepMm,b:m.d-1-(implant.z-axis.z*half)/m.spacingZ};
      const top={a:map.pixelW/2+(offset+axisIn*half)/stepMm,b:m.d-1-(implant.z+axis.z*half)/m.spacingZ};
      paintProjectedImplant(ctx,map,tip,top,radius,implant.id===activeImplantId,showLabel?`${implant.model} • Ø${implant.diameter}×${implant.length}`:"");
    });
  }

  function nearestCurveIndexWorld(xMm,yMm,start=0,end=curve.length-1){
    const m=metaRef.current;if(!m||!curve.length)return null;
    let bestIndex=start,bestDistance=Infinity;
    for(let i=start;i<=end;i++){
      const c=curve[i];if(!c)continue;
      const distance=Math.hypot(xMm-c.x*m.spacingX,yMm-c.y*m.spacingY);
      if(distance<bestDistance){bestDistance=distance;bestIndex=i}
    }
    return {index:bestIndex,distance:bestDistance};
  }

  function drawPanoramicImplants(ctx,map,start,end){
    const m=metaRef.current;if(!m||!map)return;
    implants.forEach(implant=>{
      const axis=implantAxisVector(implant),half=implant.length/2,radius=implant.diameter/2;
      const centerHit=nearestCurveIndexWorld(implant.x,implant.y,start,end);if(!centerHit)return;
      if(centerHit.distance>Math.max(12,radius+PANORAMIC_BAND_HALF_MM*2))return;
      const tipWorld={x:implant.x-axis.x*half,y:implant.y-axis.y*half,z:implant.z-axis.z*half};
      const topWorld={x:implant.x+axis.x*half,y:implant.y+axis.y*half,z:implant.z+axis.z*half};
      const tipHit=nearestCurveIndexWorld(tipWorld.x,tipWorld.y,start,end),topHit=nearestCurveIndexWorld(topWorld.x,topWorld.y,start,end);
      const tip={a:tipHit.index-start,b:m.d-1-tipWorld.z/m.spacingZ};
      const top={a:topHit.index-start,b:m.d-1-topWorld.z/m.spacingZ};
      paintProjectedImplant(ctx,map,tip,top,radius,implant.id===activeImplantId,`${implant.model} • Ø${implant.diameter}×${implant.length}`);
    });
  }

  function nerveVoxelPoint(n){
    const m=metaRef.current,c=curve[n.curveIndex];
    if(!m||!c)return null;
    const prev=curve[Math.max(0,n.curveIndex-1)]||c,next=curve[Math.min(curve.length-1,n.curveIndex+1)]||c;
    let tx=(next.x-prev.x)*m.spacingX,ty=(next.y-prev.y)*m.spacingY,len=Math.hypot(tx,ty)||1;tx/=len;ty/=len;
    const nx=-ty,ny=tx;
    return {x:c.x+nx*n.offsetMm/m.spacingX,y:c.y+ny*n.offsetMm/m.spacingY,z:n.z};
  }

  function drawExportNerveOrthogonal(ctx,canvas,plane,index){
    const m=metaRef.current,map=canvas._map;
    if(!m||!map||nerveDisplayPoints.length<1)return;
    const points=nerveDisplayPoints.map(nerveVoxelPoint).filter(Boolean);
    const toAB=p=>plane==="axial"
      ?{a:p.x,b:p.y,normal:p.z}
      :plane==="coronal"
        ?{a:p.x,b:m.d-1-p.z,normal:p.y}
        :{a:p.y,b:m.d-1-p.z,normal:p.x};
    const tolerance=plane==="axial"
      ?Math.max(2,2/m.spacingZ)
      :plane==="coronal"
        ?Math.max(2,2/m.spacingY)
        :Math.max(2,2/m.spacingX);
    const visible=points.map(toAB).filter(p=>Math.abs(p.normal-index)<=tolerance);
    if(!visible.length)return;
    const screen=p=>({x:map.ox+p.a/map.pixelW*map.dw,y:map.oy+p.b/map.pixelH*map.dh});
    ctx.save();ctx.strokeStyle="#ff2d2d";ctx.fillStyle="#ff2d2d";ctx.lineWidth=Math.max(2,map.dpr*2);
    if(visible.length>1){ctx.beginPath();visible.forEach((p,i)=>{const q=screen(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke()}
    visible.forEach(p=>{const q=screen(p);ctx.beginPath();ctx.arc(q.x,q.y,Math.max(2.5,3*map.dpr),0,Math.PI*2);ctx.fill()});
    ctx.restore();
  }

  function drawExportForaminaOrthogonal(ctx,canvas,plane,index){
    const m=metaRef.current,map=canvas._map;if(!m||!map||!foramina.length)return;
    const toAB=p=>plane==="axial"
      ?{a:p.x,b:p.y,normal:p.z}
      :plane==="coronal"
        ?{a:p.x,b:m.d-1-p.z,normal:p.y}
        :{a:p.y,b:m.d-1-p.z,normal:p.x};
    const tolerance=plane==="axial"
      ?Math.max(2,2/m.spacingZ)
      :plane==="coronal"
        ?Math.max(2,2/m.spacingY)
        :Math.max(2,2/m.spacingX);
    ctx.save();ctx.strokeStyle="#ff2d2d";ctx.lineWidth=Math.max(2,map.dpr*2);
    foramina.map(nerveVoxelPoint).filter(Boolean).map(toAB).filter(p=>Math.abs(p.normal-index)<=tolerance).forEach(p=>{
      const x=map.ox+p.a/map.pixelW*map.dw,y=map.oy+p.b/map.pixelH*map.dh;
      ctx.beginPath();ctx.arc(x,y,Math.max(5,7*map.dpr),0,Math.PI*2);ctx.stroke();
    });
    ctx.restore();
  }

  function makeTangentialCanvas(index){
    const m=metaRef.current,v=volumeRef.current;
    if(!m||!v||!curve.length)throw new Error("Volume ainda não está pronto.");
    const {w,h,d,spacingX,spacingY}=m,frame=tangentFrame(index);
    if(!frame)throw new Error("Corte tangencial indisponível.");
    const widthMm=40,stepMm=.20,pixelW=Math.round(widthMm/stepMm),pixelH=d;
    const canvas=document.createElement("canvas");canvas.width=pixelW;canvas.height=pixelH;
    const ctx=canvas.getContext("2d",{alpha:false}),img=ctx.createImageData(pixelW,pixelH);let p=0;
    for(let z=d-1;z>=0;z--)for(let a=0;a<pixelW;a++){
      const off=(a-pixelW/2)*stepMm,x=frame.c.x+frame.nx*off/spacingX,y=frame.c.y+frame.ny*off/spacingY;
      const g=wl(bilinear(v,w,h,d,x,y,z),windowLevel.wc,windowLevel.ww);
      img.data[p++]=g;img.data[p++]=g;img.data[p++]=g;img.data[p++]=255;
    }
    ctx.putImageData(img,0,0);
    const map={ox:0,oy:0,dw:pixelW,dh:pixelH,pixelW,pixelH,spacingA:stepMm,spacingB:m.spacingZ,dpr:1,plane:"tangential",curveIndex:index};
    canvas._map=map;

    nerveDisplayPoints.filter(n=>n.curveIndex===index).forEach(n=>{
      const x=pixelW/2+n.offsetMm/stepMm,y=d-1-n.z;
      ctx.fillStyle="#ff2d2d";ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
    });
    foramina.filter(n=>n.curveIndex===index).forEach(n=>{
      const x=pixelW/2+n.offsetMm/stepMm,y=d-1-n.z;
      ctx.strokeStyle="#ff2d2d";ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.stroke();
    });
    drawTangentialImplants(ctx,map,frame,stepMm,false);
    if(crosshairVisible&&index===curveIndex){
      const dx=(cursor.x-frame.c.x)*m.spacingX,dy=(cursor.y-frame.c.y)*m.spacingY;
      const offsetMm=dx*frame.nx+dy*frame.ny;
      drawCrosshair(ctx,canvas,pixelW/2+offsetMm/stepMm,d-1-cursor.z);
    }
    drawMeasurementOverlay(ctx,canvas,"tangential",index);
    return canvas;
  }

  function rangeAround(center,maxExclusive,count){
    const total=Math.min(count,maxExclusive);
    let start=Math.round(center)-Math.floor(total/2);
    start=clamp(start,0,Math.max(0,maxExclusive-total));
    return Array.from({length:total},(_,i)=>start+i);
  }
  function rangeAroundBounds(center,start,end,count){
    const available=Math.max(1,end-start+1),total=Math.min(count,available);
    let first=Math.round(center)-Math.floor(total/2);
    first=clamp(first,start,Math.max(start,end-total+1));
    return Array.from({length:total},(_,i)=>first+i);
  }

  function makeOrthogonalExportCanvas(plane,index){
    const m=metaRef.current,v=volumeRef.current;
    if(!m||!v)throw new Error("Volume ainda não está pronto.");
    const {w,h,d}=m;
    let pixelW,pixelH,read;
    if(plane==="axial"){
      pixelW=w;pixelH=h;read=(a,b)=>sample(v,w,h,d,a,b,index);
    }else if(plane==="coronal"){
      pixelW=w;pixelH=d;read=(a,b)=>sample(v,w,h,d,a,index,d-1-b);
    }else{
      pixelW=h;pixelH=d;read=(a,b)=>sample(v,w,h,d,index,a,d-1-b);
    }
    const canvas=document.createElement("canvas");canvas.width=pixelW;canvas.height=pixelH;
    const ctx=canvas.getContext("2d",{alpha:false}),img=ctx.createImageData(pixelW,pixelH);let p=0;
    for(let b=0;b<pixelH;b++)for(let a=0;a<pixelW;a++){
      const g=wl(read(a,b),windowLevel.wc,windowLevel.ww);
      img.data[p++]=g;img.data[p++]=g;img.data[p++]=g;img.data[p++]=255;
    }
    ctx.putImageData(img,0,0);
    const spacingA=plane==="axial"?m.spacingX:plane==="coronal"?m.spacingX:m.spacingY;
    const spacingB=plane==="axial"?m.spacingY:m.spacingZ;
    canvas._map={ox:0,oy:0,dw:pixelW,dh:pixelH,pixelW,pixelH,spacingA,spacingB,dpr:1,plane};

    drawExportNerveOrthogonal(ctx,canvas,plane,index);
    drawExportForaminaOrthogonal(ctx,canvas,plane,index);
    drawImplantOverlays(ctx,canvas,plane,index,false);
    if(crosshairVisible){
      if(plane==="axial"&&Math.abs(index-cursor.z)<.51)drawCrosshair(ctx,canvas,cursor.x,cursor.y);
      if(plane==="coronal"&&Math.abs(index-cursor.y)<.51)drawCrosshair(ctx,canvas,cursor.x,d-1-cursor.z);
      if(plane==="sagittal"&&Math.abs(index-cursor.x)<.51)drawCrosshair(ctx,canvas,cursor.y,d-1-cursor.z);
    }
    drawMeasurementOverlay(ctx,canvas,plane,index);
    return canvas;
  }

  function exportSeriesDefinition(){
    const m=metaRef.current;
    if(exportMode==="tangential"){
      return [{key:"tangential",label:"Tangencial",indices:rangeAroundBounds(curveIndex,archRange.start,archRange.end,exportCount)}];
    }
    return [
      {key:"tangential",label:"Tangencial",indices:rangeAroundBounds(curveIndex,archRange.start,archRange.end,exportCount)},
      {key:"axial",label:"Axial",indices:rangeAround(cursor.z,m.d,exportCount)},
      {key:"coronal",label:"Coronal",indices:rangeAround(cursor.y,m.h,exportCount)},
      {key:"sagittal",label:"Sagital",indices:rangeAround(cursor.x,m.w,exportCount)}
    ];
  }

  async function exportTangentialPdf(){
    if(exportBusy||!metaRef.current||!curve.length)return;
    const groups=exportSeriesDefinition().filter(g=>g.indices.length);
    if(!groups.length){setExportMessage("Não há cortes disponíveis nesta região.");return}
    setExportBusy(true);setExportMessage("");
    try{
      const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
      const pageW=210,pageH=297,margin=12,gap=6;
      const patient=session?.order?.patient?.name||"Paciente";
      const exam=session?.order?.examType?.name||session?.result?.series?.[meta.seriesIndex]?.description||"CBCT";
      const planningItems=implants.map((item,index)=>{
        const family=item.familyLabel||"Implante";
        const model=item.model||item.catalogId||item.id||"";
        return `#${index+1} · ${family}${model?" · "+model:""} · Ø ${item.diameter} × ${item.length} mm`;
      });
      const planningText=planningItems.join("    |    ");
      const planningLines=planningText?pdf.splitTextToSize(planningText,pageW-margin*2-6):[];
      const planningBlockH=planningLines.length?8+planningLines.length*4.2:0;
      const headerH=24+planningBlockH;
      const cellW=(pageW-margin*2-gap)/2,cellH=(pageH-margin*2-headerH-gap)/2;
      let firstPage=true,pageGlobal=0;

      for(const group of groups){
        const pagesForGroup=Math.ceil(group.indices.length/4);
        for(let page=0;page<pagesForGroup;page++){
          if(!firstPage)pdf.addPage(); firstPage=false; pageGlobal++;
          pdf.setFont("helvetica","bold");pdf.setFontSize(14);
          pdf.text(`OdontoView — ${group.label}`,margin,12);
          pdf.setFont("helvetica","normal");pdf.setFontSize(9);
          pdf.text(`${patient} • ${exam}`,margin,18);
          pdf.text(`${group.label} • página ${page+1}/${pagesForGroup}`,pageW-margin,18,{align:"right"});
          if(planningLines.length){
            const boxY=22;
            pdf.setFillColor(246,249,251);
            pdf.setDrawColor(214,223,230);
            pdf.roundedRect(margin,boxY,pageW-margin*2,planningBlockH-1,2,2,"FD");
            pdf.setFont("helvetica","bold");pdf.setFontSize(8);pdf.setTextColor(35,65,78);
            pdf.text("PLANEJAMENTO DE IMPLANTES",margin+3,boxY+4.5);
            pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(35,45,55);
            planningLines.forEach((line,i)=>pdf.text(line,margin+3,boxY+9+i*4.2));
            pdf.setTextColor(0);
          }

          const pageIndices=group.indices.slice(page*4,page*4+4);
          pageIndices.forEach((idx,slot)=>{
            const col=slot%2,row=Math.floor(slot/2);
            const canvas=group.key==="tangential"?makeTangentialCanvas(idx):makeOrthogonalExportCanvas(group.key,idx);
            const img=canvas.toDataURL("image/jpeg",.9);
            const x=margin+col*(cellW+gap),y=margin+headerH+row*(cellH+gap);
            const ratio=canvas.height/canvas.width;
            let drawW=cellW-4,drawH=drawW*ratio;
            if(drawH>cellH-15){drawH=cellH-15;drawW=drawH/ratio}
            const dx=x+(cellW-drawW)/2,dy=y+4;
            pdf.setDrawColor(220);pdf.rect(x,y,cellW,cellH);
            pdf.addImage(img,"JPEG",dx,dy,drawW,drawH,undefined,"FAST");
            pdf.setFontSize(9);pdf.setTextColor(40);
            pdf.text(`${group.label} • corte ${idx+1}`,x+cellW/2,y+cellH-4,{align:"center"});
          });
        }
      }
      const totalCuts=groups.reduce((sum,g)=>sum+g.indices.length,0);
      pdf.setProperties({title:`OdontoView - ${patient} - cortes ${exportMode==="complete"?"4 eixos":"tangenciais"}`,subject:exam,creator:"OdontoView"});
      const safe=patient.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"_").replace(/^_|_$/g,"");
      pdf.save(`OdontoView_${safe||"Paciente"}_${exportMode==="complete"?"4_eixos":"tangencial"}_${exportCount}.pdf`);
      setExportMessage(exportMode==="complete"
        ?`PDF completo gerado: imagens limpas + planejamento de implantes em área separada • ${groups.map(g=>g.indices.length+" "+g.label.toLowerCase()).join(" • ")} (${totalCuts} cortes).`
        :`PDF tangencial gerado com imagens limpas e planejamento de implantes em área separada (${totalCuts} cortes).`);
    }catch(e){
      setExportMessage(e?.message||"Não foi possível gerar o PDF.");
    }finally{setExportBusy(false)}
  }

  function drawTangential(canvas){
    const m=metaRef.current,v=volumeRef.current;if(!m||!v||!curve.length)return;
    const {w,h,d,spacingX,spacingY,spacingZ}=m;
    const rect=canvas.parentElement.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    const cw=Math.max(1,Math.floor(rect.width*dpr)),ch=Math.max(1,Math.floor(rect.height*dpr));
    if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch}
    const ctx=canvas.getContext("2d",{alpha:false});
    ctx.fillStyle="#05070a";ctx.fillRect(0,0,cw,ch);

    const gap=4*dpr,panelW=(cw-gap*2)/3;
    const indices=[curveIndex-1,curveIndex,curveIndex+1];
    const labels=["ANTERIOR","ATUAL","POSTERIOR"];
    const widthMm=40,stepMm=.25,pixelW=Math.round(widthMm/stepMm),pixelH=d;
    const t=transforms.tangential||{zoom:1,panX:0,panY:0};
    const maps=[];

    indices.forEach((idx,slot)=>{
      const panelX=slot*(panelW+gap);
      ctx.fillStyle="#070a0f";ctx.fillRect(panelX,0,panelW,ch);
      if(idx<archRange.start||idx>archRange.end){
        ctx.fillStyle="rgba(180,195,210,.55)";
        ctx.font=`${11*dpr}px -apple-system,sans-serif`;
        ctx.textAlign="center";ctx.fillText("fim da série",panelX+panelW/2,ch/2);
        maps.push(null);return;
      }
      const frame=tangentFrame(idx);if(!frame){maps.push(null);return}
      const img=ctx.createImageData(pixelW,pixelH);let p=0;
      for(let z=d-1;z>=0;z--)for(let a=0;a<pixelW;a++){
        const off=(a-pixelW/2)*stepMm;
        const x=frame.c.x+frame.nx*off/spacingX,y=frame.c.y+frame.ny*off/spacingY;
        const g=wl(bilinear(v,w,h,d,x,y,z),windowLevel.wc,windowLevel.ww);
        img.data[p++]=g;img.data[p++]=g;img.data[p++]=g;img.data[p++]=255;
      }
      const tmp=document.createElement("canvas");tmp.width=pixelW;tmp.height=pixelH;tmp.getContext("2d").putImageData(img,0,0);
      const physicalW=pixelW*stepMm,physicalH=pixelH*spacingZ;
      const base=Math.min((panelW-8*dpr)/physicalW,(ch-8*dpr)/physicalH);
      const dw=physicalW*base*t.zoom,dh=physicalH*base*t.zoom;
      const ox=panelX+(panelW-dw)/2+t.panX*dpr,oy=(ch-dh)/2+t.panY*dpr;
      const map={ox,oy,dw,dh,pixelW,pixelH,spacingA:stepMm,spacingB:spacingZ,dpr,plane:"tangential",curveIndex:idx};
      maps.push(map);
      ctx.imageSmoothingEnabled=true;ctx.drawImage(tmp,ox,oy,dw,dh);

      [...nerveDisplayPoints.map(n=>({...n,type:"nerve"})),...foramina.map(n=>({...n,type:"foramen"}))].filter(n=>n.curveIndex===idx).forEach(n=>{
        const a=pixelW/2+n.offsetMm/stepMm,b=d-1-n.z;
        const x=map.ox+a/pixelW*map.dw,y=map.oy+b/pixelH*map.dh;
        ctx.strokeStyle="#ff2d2d";ctx.fillStyle="#ff2d2d";ctx.lineWidth=3*dpr;
        ctx.beginPath();ctx.arc(x,y,(n.type==="foramen"?8:4)*dpr,0,Math.PI*2);n.type==="foramen"?ctx.stroke():ctx.fill();
      });

      if(idx===curveIndex&&crosshairVisible){
        const dx=(cursor.x-frame.c.x)*spacingX,dy=(cursor.y-frame.c.y)*spacingY;
        const offsetMm=dx*frame.nx+dy*frame.ny;
        const previousMap=canvas._map;canvas._map=map;
        drawCrosshair(ctx,canvas,pixelW/2+offsetMm/stepMm,d-1-cursor.z);
        canvas._map=previousMap;
      }

      drawTangentialImplants(ctx,map,frame,stepMm);
      drawTangentialToothMarkers(ctx,map,frame,stepMm,idx);
      const previousMap=canvas._map;canvas._map=map;
      drawMmScale(ctx,canvas,map);
      drawMeasurementOverlay(ctx,canvas,"tangential",idx);
      canvas._map=previousMap;

      ctx.fillStyle=idx===curveIndex?"rgba(49,215,210,.92)":"rgba(205,220,235,.72)";
      ctx.font=`${10*dpr}px -apple-system,sans-serif`;ctx.textAlign="left";ctx.textBaseline="top";
      ctx.fillText(`${labels[slot]} • ${idx+1}`,panelX+7*dpr,7*dpr);
      if(idx===curveIndex){
        ctx.strokeStyle="rgba(49,215,210,.72)";ctx.lineWidth=1.5*dpr;ctx.strokeRect(panelX+1*dpr,1*dpr,panelW-2*dpr,ch-2*dpr);
      }
    });
    canvas._tangentialPanels=maps.filter(Boolean);
    canvas._map=maps[1]||maps.find(Boolean)||null;
  }

  function drawPanoramic(canvas){
    const m=metaRef.current,v=volumeRef.current;if(!m||!v||!curve.length)return;
    const {w,h,d,spacingX,spacingY,spacingZ}=m;
    const start=archRange.start,end=archRange.end,pixelW=Math.max(1,end-start+1),pixelH=d;
    const a0=curve[start],a1=curve[Math.min(end,start+1)];
    const approxStepMm=Math.max(.2,Math.hypot((a1?.x-a0?.x||1)*spacingX,(a1?.y-a0?.y||1)*spacingY));
    const {cw,ch,ox,oy,dw,dh}=fit(canvas,pixelW,pixelH,approxStepMm,spacingZ,"panoramic");
    const ctx=canvas.getContext("2d",{alpha:false}),img=ctx.createImageData(pixelW,pixelH);let p=0;
    for(let z=d-1;z>=0;z--)for(let local=0;local<pixelW;local++){
      const ci=start+local,frame=tangentFrame(ci);let total=0,count=0;
      for(const off of [-2,-1,0,1,2]){const x=frame.c.x+frame.nx*off/spacingX,y=frame.c.y+frame.ny*off/spacingY;total+=bilinear(v,w,h,d,x,y,z);count++}
      const g=wl(total/count,windowLevel.wc,windowLevel.ww);img.data[p++]=g;img.data[p++]=g;img.data[p++]=g;img.data[p++]=255;
    }
    const tmp=document.createElement("canvas");tmp.width=pixelW;tmp.height=pixelH;tmp.getContext("2d").putImageData(img,0,0);
    ctx.fillStyle="#05070a";ctx.fillRect(0,0,cw,ch);ctx.imageSmoothingEnabled=true;ctx.drawImage(tmp,ox,oy,dw,dh);
    const map=canvas._map;
    const sorted=[...nerveDisplayPoints].filter(n=>n.curveIndex>=start&&n.curveIndex<=end).sort((a,b)=>a.curveIndex-b.curveIndex);
    if(sorted.length){ctx.strokeStyle="#ff2d2d";ctx.fillStyle="#ff2d2d";ctx.lineWidth=3*map.dpr;ctx.beginPath();sorted.forEach((n,i)=>{const local=n.curveIndex-start,x=map.ox+local/pixelW*map.dw,y=map.oy+(d-1-n.z)/pixelH*map.dh;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();sorted.forEach(n=>{const local=n.curveIndex-start,x=map.ox+local/pixelW*map.dw,y=map.oy+(d-1-n.z)/pixelH*map.dh;ctx.beginPath();ctx.arc(x,y,3*map.dpr,0,Math.PI*2);ctx.fill()})}
    foramina.filter(n=>n.curveIndex>=start&&n.curveIndex<=end).forEach(n=>{const local=n.curveIndex-start,x=map.ox+local/pixelW*map.dw,y=map.oy+(d-1-n.z)/pixelH*map.dh;ctx.strokeStyle="#ff2d2d";ctx.lineWidth=3*map.dpr;ctx.beginPath();ctx.arc(x,y,7*map.dpr,0,Math.PI*2);ctx.stroke()});
    drawPanoramicImplants(ctx,map,start,end);
    drawPanoramicToothMarkers(ctx,map,start,end);
    if(crosshairVisible)drawCrosshair(ctx,canvas,curveIndex-start,d-1-cursor.z);
    drawMmScale(ctx,canvas);
    ctx.save();ctx.fillStyle="rgba(49,215,210,.88)";ctx.font=`${10*map.dpr}px -apple-system,sans-serif`;ctx.textAlign="right";ctx.textBaseline="top";ctx.fillText(`Faixa panorâmica ${PANORAMIC_BAND_HALF_MM*2} mm • ${archRange.label}`,map.ox+map.dw-6*map.dpr,map.oy+6*map.dpr);ctx.restore();
  }

  useEffect(()=>{
    if(loading||error||!meta)return;
    const draw=()=>{drawAxial(canvases.axial.current);drawOrthogonal(canvases.coronal.current,"coronal");drawOrthogonal(canvases.sagittal.current,"sagittal");drawTangential(canvases.tangential.current);drawPanoramic(canvases.panoramic.current)};
    draw();window.addEventListener("resize",draw);return()=>window.removeEventListener("resize",draw);
  },[loading,error,meta,cursor,curvePoints,curveIndex,windowLevel,measurements,pendingMeasure,nervePoints,foramina,implants,activeImplantId,plannedTeeth,selectedToothFDI,transforms,crosshairVisible,expandedPanel]);

  function resetPlane(plane){setTransforms(t=>({...t,[plane]:{zoom:1,panX:0,panY:0}}))}
  function adjustBrightness(delta){setWindowLevel(v=>({...v,wc:Math.round(v.wc+delta)}))}
  function adjustContrast(delta){setWindowLevel(v=>({...v,ww:Math.max(50,Math.round(v.ww+delta))}))}
  function resetWindow(){setWindowLevel({...defaultWindowRef.current})}
  function detectArchRange(){
    const m=metaRef.current,v=volumeRef.current;
    const last=Math.max(0,curve.length-1);
    if(!m||!v||curve.length<10)return {start:0,end:last,label:"Arcada completa",confidence:.25};
    const z=clamp(Math.round(cursor.z),0,m.d-1);
    const samples=[];
    const sampleCount=25;
    for(let s=0;s<sampleCount;s++){
      const idx=Math.round(s*last/(sampleCount-1));
      const frame=tangentFrame(idx);
      if(!frame){samples.push({idx,score:-Infinity});continue}
      let best=-Infinity;
      for(let off=-7;off<=7.001;off+=1.4){
        const x=frame.c.x+frame.nx*off/m.spacingX;
        const y=frame.c.y+frame.ny*off/m.spacingY;
        const score=localDensityScore(x,y,z);
        if(score>best)best=score;
      }
      samples.push({idx,score:best});
    }
    const finite=samples.filter(s=>Number.isFinite(s.score)).map(s=>s.score).sort((a,b)=>a-b);
    if(finite.length<8)return {start:0,end:last,label:"Arcada completa",confidence:.2};
    const q=p=>finite[Math.floor((finite.length-1)*p)];
    const lo=q(.12),hi=q(.88),span=Math.max(1,hi-lo);
    const normalized=samples.map(s=>({...s,n:Number.isFinite(s.score)?clamp((s.score-lo)/span,0,1):0}));
    const smooth=normalized.map((s,i)=>{
      let total=0,weight=0;
      for(let k=-2;k<=2;k++){
        const qv=normalized[clamp(i+k,0,normalized.length-1)].n,w=k===0?3:(Math.abs(k)===1?2:1);
        total+=qv*w;weight+=w;
      }
      return {...s,n:total/weight};
    });
    const third=Math.max(3,Math.floor(smooth.length*.32));
    const mean=arr=>arr.reduce((a,b)=>a+b.n,0)/Math.max(1,arr.length);
    const leftMean=mean(smooth.slice(0,third));
    const rightMean=mean(smooth.slice(-third));
    const centerMean=mean(smooth.slice(third,-third));
    const lowRatio=Math.min(leftMean,rightMean)/Math.max(.08,Math.max(leftMean,rightMean));
    const edgeWeak=Math.min(leftMean,rightMean)<Math.max(.24,centerMean*.62);
    if(lowRatio>.62||!edgeWeak){
      return {start:0,end:last,label:"Arcada completa detectada",confidence:clamp(.55+(lowRatio-.62)*.4,.55,.9)};
    }
    const supportedRight=rightMean>leftMean;
    const threshold=Math.max(.26,centerMean*.48);
    if(supportedRight){
      let startSample=0;
      for(let i=0;i<smooth.length-2;i++){
        if(smooth[i].n>threshold&&smooth[i+1].n>threshold&&smooth[i+2].n>threshold){startSample=Math.max(0,i-1);break}
      }
      const start=clamp(Math.round(smooth[startSample].idx-last*.05),0,last);
      return {start,end:last,label:"Semi-arcada detectada • lado direito da imagem",confidence:clamp(1-lowRatio,.55,.96)};
    }else{
      let endSample=smooth.length-1;
      for(let i=smooth.length-1;i>=2;i--){
        if(smooth[i].n>threshold&&smooth[i-1].n>threshold&&smooth[i-2].n>threshold){endSample=Math.min(smooth.length-1,i+1);break}
      }
      const end=clamp(Math.round(smooth[endSample].idx+last*.05),0,last);
      return {start:0,end,label:"Semi-arcada detectada • lado esquerdo da imagem",confidence:clamp(1-lowRatio,.55,.96)};
    }
  }

  function analyzeArchScope(){
    const detected=detectArchRange();
    setAutoArchRange(detected);
    setCurveAssistMessage(`${detected.label}. Confiança heurística: ${Math.round(detected.confidence*100)}%. Confira visualmente antes do planejamento.`);
    return detected;
  }

  function resetArch(){
    const m=metaRef.current;if(!m)return;
    const arch=(defaultCurveRef.current?.length?defaultCurveRef.current:defaultArch(m.w,m.h)).map(p=>({...p}));
    setCurvePoints(arch);
    const sampled=catmullRom(arch,18);
    setCurveIndex(Math.floor(sampled.length/2));
    setCurveAssistMessage("");
    curveBeforeAssistRef.current=null;
  }
  function localDensityScore(x,y,z){
    const m=metaRef.current,v=volumeRef.current;if(!m||!v)return -Infinity;
    let total=0,count=0;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const xx=Math.round(x+dx),yy=Math.round(y+dy);
      if(xx>=0&&yy>=0&&xx<m.w&&yy<m.h){total+=sample(v,m.w,m.h,m.d,xx,yy,z);count++}
    }
    return count?total/count:-Infinity;
  }
  function findBestArchAxialSlice(){
    const m=metaRef.current,v=volumeRef.current;
    if(!m||!v||!defaultCurveRef.current?.length)return Math.floor((m?.d||1)/2);
    const base=catmullRom(defaultCurveRef.current,10);
    const zStart=Math.max(0,Math.round((m.d-1)*.12)),zEnd=Math.min(m.d-1,Math.round((m.d-1)*.88));
    const samples=18;
    let bestZ=Math.floor((zStart+zEnd)/2),bestScore=-Infinity;
    for(let s=0;s<samples;s++){
      const z=Math.round(zStart+(zEnd-zStart)*(s/Math.max(1,samples-1)));
      const scores=[];
      for(let i=0;i<base.length;i+=Math.max(1,Math.floor(base.length/22))){
        const score=localDensityScore(base[i].x,base[i].y,z);
        if(Number.isFinite(score))scores.push(score);
      }
      if(!scores.length)continue;
      scores.sort((a,b)=>b-a);
      const take=Math.max(3,Math.floor(scores.length*.45));
      const score=scores.slice(0,take).reduce((sum,n)=>sum+n,0)/take;
      if(score>bestScore){bestScore=score;bestZ=z}
    }
    return bestZ;
  }
  function suggestArchFromAxial(zOverride=null){
    const m=metaRef.current,v=volumeRef.current;if(!m||!v||curve.length<7)return false;
    if(archMode==="auto")analyzeArchScope();
    const z=clamp(Math.round(Number.isFinite(zOverride)?zOverride:cursor.z),0,m.d-1);
    const base=curve;
    const candidates=[];
    const pointCount=curvePoints.length;
    for(let j=0;j<pointCount;j++){
      const idx=Math.round(j*(base.length-1)/Math.max(1,pointCount-1));
      const p=base[idx],prev=base[Math.max(0,idx-2)],next=base[Math.min(base.length-1,idx+2)];
      let tx=(next.x-prev.x)*m.spacingX,ty=(next.y-prev.y)*m.spacingY;
      const len=Math.hypot(tx,ty)||1;tx/=len;ty/=len;
      const nx=-ty,ny=tx;
      const samples=[];
      for(let off=-10;off<=10.001;off+=.5){
        const x=p.x+nx*off/m.spacingX,y=p.y+ny*off/m.spacingY;
        samples.push({off,score:localDensityScore(x,y,z)});
      }
      const finite=samples.filter(s=>Number.isFinite(s.score));
      if(!finite.length){candidates.push({p,off:0,nx,ny});continue}
      const min=Math.min(...finite.map(s=>s.score)),max=Math.max(...finite.map(s=>s.score));
      let best={off:0,value:-Infinity};
      for(const s of finite){
        const normalized=(s.score-min)/Math.max(1,max-min);
        const value=normalized-Math.abs(s.off)*.018;
        if(value>best.value)best={off:s.off,value};
      }
      candidates.push({p,off:clamp(best.off,-7,7),nx,ny});
    }
    const smoothed=candidates.map((item,i)=>{
      const a=candidates[Math.max(0,i-1)].off,b=item.off,d=candidates[Math.min(candidates.length-1,i+1)].off;
      return {...item,off:clamp((a+2*b+d)/4,-6,6)};
    });
    const nextPoints=smoothed.map(item=>({
      x:clamp(item.p.x+item.nx*item.off/m.spacingX,0,m.w-1),
      y:clamp(item.p.y+item.ny*item.off/m.spacingY,0,m.h-1)
    }));
    curveBeforeAssistRef.current=curvePoints.map(p=>({...p}));
    setCurvePoints(nextPoints);
    setCurveAssistMessage(`Sugestão aplicada no axial Z ${z+1}. Confira os 7 pontos antes de usar para planejamento.`);
    return true;
  }
  async function prepareArchAutomatically(kind){
    if(archSetupBusy)return;
    setArchSetupBusy(true);
    setDentalArchType(kind);
    try{
      await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
      const z=findBestArchAxialSlice();
      setCursor(current=>({...current,z}));
      const ok=suggestArchFromAxial(z);
      if(ok){
        setCurveAssistMessage(`${kind==="maxilla"?"Maxila":kind==="mandible"?"Mandíbula":kind==="both"?"Ambas as arcadas":"Arcada não informada"} • curva inicial sugerida automaticamente no axial Z ${z+1}. Revise antes do planejamento.`);
        setArchSetupOpen(false);
        setTool("navigate");
      }else{
        setCurveAssistMessage("Não foi possível sugerir a curva com segurança. Ajuste os pontos manualmente no axial.");
        setTool("curve");
        setArchSetupOpen(false);
      }
    }finally{setArchSetupBusy(false)}
  }
  function undoSuggestedArch(){
    if(!curveBeforeAssistRef.current)return;
    setCurvePoints(curveBeforeAssistRef.current.map(p=>({...p})));
    curveBeforeAssistRef.current=null;
    setCurveAssistMessage("Sugestão desfeita.");
  }
  function resetAll(){
    const m=metaRef.current;if(!m)return;
    const arch=(defaultCurveRef.current?.length?defaultCurveRef.current:defaultArch(m.w,m.h)).map(p=>({...p}));
    setWindowLevel({...defaultWindowRef.current});
    setCursor({x:Math.floor(m.w/2),y:Math.floor(m.h/2),z:Math.floor(m.d/2)});
    setCurvePoints(arch);
    setArchMode("auto");
    setAutoArchRange({start:0,end:Math.max(0,catmullRom(arch,18).length-1),label:"Arcada completa",confidence:0});
    setCurveIndex(Math.floor(catmullRom(arch,18).length/2));
    setMeasurements([]);
    setPendingMeasure(null);
    setNervePoints([]);
    setNerveAssist(true);
    setForamina([]);
    setTransforms({
      axial:{zoom:1,panX:0,panY:0},coronal:{zoom:1,panX:0,panY:0},
      sagittal:{zoom:1,panX:0,panY:0},tangential:{zoom:1,panX:0,panY:0},panoramic:{zoom:1,panX:0,panY:0}
    });
    setTool("navigate");
    setCrosshairVisible(true);
    setExportMode("complete");
    setExportCount(15);
    setExportMessage("");
    setCurveAssistMessage("");
    curveBeforeAssistRef.current=null;
  }
  function undoLastNerve(){setNervePoints(ns=>ns.slice(0,-1))}
  function undoLastForamen(){setForamina(fs=>fs.slice(0,-1))}
  function onWheel(plane,e){e.preventDefault();const factor=e.deltaY<0?1.12:.89;setTransforms(t=>({...t,[plane]:{...t[plane],zoom:clamp(t[plane].zoom*factor,.5,8)}}))}
  function beginPan(plane,e){if(tool!=="pan")return;dragRef.current={plane,x:e.clientX,y:e.clientY,start:transforms[plane]};e.currentTarget.setPointerCapture(e.pointerId)}
  function movePan(e){const d=dragRef.current;if(!d)return;setTransforms(t=>({...t,[d.plane]:{...t[d.plane],panX:d.start.panX+e.clientX-d.x,panY:d.start.panY+e.clientY-d.y}}))}
  function endPan(){dragRef.current=null}

  function currentSpacing(plane){
    const m=metaRef.current;if(plane==="axial")return [m.spacingX,m.spacingY];
    if(plane==="coronal")return [m.spacingX,m.spacingZ];
    if(plane==="sagittal")return [m.spacingY,m.spacingZ];
    if(plane==="tangential")return [.25,m.spacingZ];
    return [1,1];
  }
  function handleMeasurement(plane,pt){
    const slice=(plane==="tangential"&&Number.isInteger(pt.tangentialIndex))?pt.tangentialIndex:planeSlice(metaRef.current,plane,cursor,curveIndex),[spacingA,spacingB]=currentSpacing(plane);
    if(plane==="tangential"&&Number.isInteger(pt.tangentialIndex)&&pt.tangentialIndex!==curveIndex)setCurveIndex(pt.tangentialIndex);
    if(!pendingMeasure||pendingMeasure.plane!==plane||pendingMeasure.slice!==slice){
      setPendingMeasure({plane,slice,a:pt,b:null,spacingA,spacingB});
    }else{
      const done={...pendingMeasure,b:pt,id:crypto.randomUUID?crypto.randomUUID():String(Date.now())};
      setMeasurements(ms=>[...ms,done]);setPendingMeasure(null);
    }
  }

  function navigateAt(plane,canvas,pt){
    if(!pt||!metaRef.current)return;
    const m=metaRef.current;
    if(plane==="axial"){
      setCursor(c=>({...c,x:clamp(Math.round(pt.a),0,m.w-1),y:clamp(Math.round(pt.b),0,m.h-1)}));
    }else if(plane==="coronal"){
      setCursor(c=>({...c,x:clamp(Math.round(pt.a),0,m.w-1),z:clamp(Math.round(m.d-1-pt.b),0,m.d-1)}));
    }else if(plane==="sagittal"){
      setCursor(c=>({...c,y:clamp(Math.round(pt.a),0,m.h-1),z:clamp(Math.round(m.d-1-pt.b),0,m.d-1)}));
    }else if(plane==="tangential"){
      const targetIndex=Number.isInteger(pt.tangentialIndex)?pt.tangentialIndex:curveIndex;
      const frame=tangentFrame(targetIndex);if(!frame)return;
      const stepMm=.25,pixelW=Math.round(40/stepMm);
      const off=(pt.a-pixelW/2)*stepMm;
      setCurveIndex(targetIndex);
      setCursor(c=>({
        ...c,
        x:clamp(Math.round(frame.c.x+frame.nx*off/m.spacingX),0,m.w-1),
        y:clamp(Math.round(frame.c.y+frame.ny*off/m.spacingY),0,m.h-1),
        z:clamp(Math.round(m.d-1-pt.b),0,m.d-1)
      }));
    }else if(plane==="panoramic"){
      setCurveIndex(clamp(archRange.start+Math.round(pt.a),archRange.start,archRange.end));
      setCursor(c=>({...c,z:clamp(Math.round(m.d-1-pt.b),0,m.d-1)}));
    }
  }

  function isActiveImplantHit(plane,pt){
    const implant=implants.find(item=>item.id===activeImplantId),m=metaRef.current;
    if(!implant||!m||!["axial","coronal","sagittal"].includes(plane))return false;
    const axis=implantAxisVector(implant),half=implant.length/2,radius=implant.diameter/2;
    const fixedWorld=plane==="axial"?cursor.z*m.spacingZ:plane==="coronal"?cursor.y*m.spacingY:cursor.x*m.spacingX;
    const normalCenter=plane==="axial"?implant.z:plane==="coronal"?implant.y:implant.x;
    const normalAxis=plane==="axial"?axis.z:plane==="coronal"?axis.y:axis.x;
    const min=normalCenter-Math.abs(normalAxis)*half-radius,max=normalCenter+Math.abs(normalAxis)*half+radius;
    if(fixedWorld<min||fixedWorld>max)return false;
    let da=0,db=0;
    if(plane==="axial"){
      da=(pt.a-implant.x/m.spacingX)*m.spacingX;
      db=(pt.b-implant.y/m.spacingY)*m.spacingY;
    }else if(plane==="coronal"){
      da=(pt.a-implant.x/m.spacingX)*m.spacingX;
      db=((m.d-1-pt.b)-implant.z/m.spacingZ)*m.spacingZ;
    }else{
      da=(pt.a-implant.y/m.spacingY)*m.spacingY;
      db=((m.d-1-pt.b)-implant.z/m.spacingZ)*m.spacingZ;
    }
    return Math.hypot(da,db)<=Math.max(3.2,implant.diameter*1.25);
  }

  function moveActiveImplantToPoint(plane,pt){
    const m=metaRef.current,id=activeImplantId;
    if(!m||!id||!["axial","coronal","sagittal"].includes(plane))return;
    const nextVoxel={x:cursor.x,y:cursor.y,z:cursor.z};
    if(plane==="axial"){
      nextVoxel.x=clamp(pt.a,0,m.w-1);
      nextVoxel.y=clamp(pt.b,0,m.h-1);
    }else if(plane==="coronal"){
      nextVoxel.x=clamp(pt.a,0,m.w-1);
      nextVoxel.z=clamp(m.d-1-pt.b,0,m.d-1);
    }else{
      nextVoxel.y=clamp(pt.a,0,m.h-1);
      nextVoxel.z=clamp(m.d-1-pt.b,0,m.d-1);
    }
    setImplants(items=>items.map(item=>item.id===id?{
      ...item,
      x:nextVoxel.x*m.spacingX,
      y:nextVoxel.y*m.spacingY,
      z:nextVoxel.z*m.spacingZ
    }:item));
    setCursor(nextVoxel);
  }

  function onPointerDown(plane,e){
    const canvas=e.currentTarget,pt=toImagePoint(canvas,e);
    if(deviceProfile!=="desktop"&&e.pointerType==="touch"&&tool==="navigate"){
      if(pt)touchTapRef.current={plane,canvas,pt,startX:e.clientX,startY:e.clientY,moved:false};
      return;
    }
    if(tool==="pan"){beginPan(plane,e);return}
    if(!pt)return;
    if(tool==="measure"){handleMeasurement(plane,pt);return}
    if(tool==="curve"&&plane==="axial"){
      const map=canvas._map;let best=-1,bestDist=Infinity;
      curvePoints.forEach((c,i)=>{const a=c.x/metaRef.current.w*map.pixelW,b=c.y/metaRef.current.h*map.pixelH,dist=Math.hypot(a-pt.a,b-pt.b);if(dist<bestDist){best=i;bestDist=dist}});
      if(best>=0&&bestDist<20){curveDragRef.current=best;canvas.setPointerCapture(e.pointerId)}return;
    }
    if((tool==="nerve"||tool==="foramen")&&plane==="tangential"){
      const targetIndex=Number.isInteger(pt.tangentialIndex)?pt.tangentialIndex:curveIndex;
      const pixelW=Math.round(40/.25),d=metaRef.current.d,offsetMm=(pt.a-pixelW/2)*.25,z=clamp(Math.round(d-1-pt.b),0,d-1);
      setCurveIndex(targetIndex);
      const mark={id:(crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random())),curveIndex:targetIndex,z,offsetMm};
      if(tool==="nerve")setNervePoints(ns=>[...ns.filter(n=>Math.abs(n.curveIndex-targetIndex)>1),mark].sort((a,b)=>a.curveIndex-b.curveIndex));
      else setForamina(fs=>[...fs,mark]);
      return;
    }
    if(tool==="navigate"){
      if(isActiveImplantHit(plane,pt)){
        implantDragRef.current={plane,id:activeImplantId};
        moveActiveImplantToPoint(plane,pt);
        try{canvas.setPointerCapture(e.pointerId)}catch{}
        return;
      }
      navigateAt(plane,canvas,pt);
      navDragRef.current={plane};
      try{canvas.setPointerCapture(e.pointerId)}catch{}
    }
  }
  function onPointerMove(plane,e){
    if(touchTapRef.current&&e.pointerType==="touch"){
      const t=touchTapRef.current;
      if(Math.hypot(e.clientX-t.startX,e.clientY-t.startY)>10)t.moved=true;
      return;
    }
    if(dragRef.current){movePan(e);return}
    if(implantDragRef.current&&tool==="navigate"&&implantDragRef.current.plane===plane){
      const pt=toImagePoint(e.currentTarget,e);if(pt)moveActiveImplantToPoint(plane,pt);
      return;
    }
    if(navDragRef.current&&tool==="navigate"&&navDragRef.current.plane===plane){
      const pt=toImagePoint(e.currentTarget,e);if(pt)navigateAt(plane,e.currentTarget,pt);
      return;
    }
    if(curveDragRef.current==null||tool!=="curve"||plane!=="axial")return;
    const pt=toImagePoint(e.currentTarget,e);if(!pt)return;
    const i=curveDragRef.current,m=metaRef.current;
    setCurvePoints(ps=>ps.map((p,index)=>index===i?{x:clamp(pt.a,0,m.w-1),y:clamp(pt.b,0,m.h-1)}:p));
  }
  function onPointerUp(plane,e){
    const tap=touchTapRef.current;
    if(tap&&e?.pointerType==="touch"){
      if(!tap.moved&&tap.plane===plane)navigateAt(plane,tap.canvas,tap.pt);
      touchTapRef.current=null;
    }
    dragRef.current=null;curveDragRef.current=null;navDragRef.current=null;implantDragRef.current=null;
  }

  function planeControl(id){
    const m=metaRef.current;if(!m)return {min:0,max:0,value:0,label:""};
    if(id==="axial")return {min:0,max:m.d-1,value:cursor.z,label:`Z ${cursor.z+1}/${m.d}`,set:v=>setCursor(c=>({...c,z:Number(v)}))};
    if(id==="coronal")return {min:0,max:m.h-1,value:cursor.y,label:`Y ${cursor.y+1}/${m.h}`,set:v=>setCursor(c=>({...c,y:Number(v)}))};
    if(id==="sagittal")return {min:0,max:m.w-1,value:cursor.x,label:`X ${cursor.x+1}/${m.w}`,set:v=>setCursor(c=>({...c,x:Number(v)}))};
    if(id==="tangential")return {min:archRange.start,max:archRange.end,value:curveIndex,label:`Tangencial ${curveIndex-archRange.start+1}/${archRange.end-archRange.start+1}`,set:v=>setCurveIndex(Number(v))};
    return {min:archRange.start,max:archRange.end,value:curveIndex,label:`Região ${curveIndex-archRange.start+1}/${archRange.end-archRange.start+1}`,set:v=>setCurveIndex(Number(v))};
  }

  function renderSliceControl(id,label){
    const pc=planeControl(id);
    const stepBy=delta=>pc.set(clamp(Number(pc.value)+delta,Number(pc.min),Number(pc.max)));
    return <div className="viewer2-slice-control">
      <span>{pc.label}</span>
      <div className="viewer2-slice-nav">
        <button type="button" className="slice-step" aria-label={"Voltar um corte em "+label} onClick={()=>stepBy(-1)}>−</button>
        <input aria-label={"Navegação "+label} type="range" min={pc.min} max={pc.max} step="1" value={pc.value} onChange={e=>pc.set(e.target.value)}/>
        <button type="button" className="slice-step" aria-label={"Avançar um corte em "+label} onClick={()=>stepBy(1)}>+</button>
      </div>
    </div>;
  }

  function expandButton(id,label){
    const active=expandedPanel===id;
    return <button type="button" className="viewer2-expand" aria-label={(active?"Restaurar ":"Maximizar ")+label} title={(active?"Voltar ao mosaico":"Maximizar")+" • Esc para sair"} onClick={()=>setExpandedPanel(active?null:id)}>
      {active?"↙ Mosaico":"⛶"}
    </button>;
  }

  if(loading)return <>{showIntro&&<ViewerBootIntro loading/>}<main className="viewer2-loading"><div className="viewer2-loading-card"><div className="brand">OdontoView</div><h1>Preparando exame…</h1><p>{loadProgress.label}</p>{loadProgress.total>0&&<><div className="viewer2-load-progress"><span style={{width:Math.min(100,Math.round(loadProgress.current/loadProgress.total*100))+"%"}}/></div><small>{loadProgress.current} de {loadProgress.total} cortes • {Math.round(loadProgress.current/loadProgress.total*100)}%</small></>}<div className="viewer2-loading-pulse" aria-hidden="true"><span/></div></div></main></>;
  if(error)return <main className="page centered"><section className="card auth"><button type="button" className="brand viewer2-brand-home" onClick={()=>{clearViewerSession();nav(profileHome)}}>OdontoView</button><h2>Viewer 2.0</h2><div className="error">{error}</div><button className="secondary" onClick={()=>{clearViewerSession();nav(returnTo)}}>{returnLabel}</button></section></main>;

  const toolName={navigate:"Cruzeta",pan:"Pan",measure:"Medir",curve:"Curva da arcada",nerve:"Nervo",foramen:"Forame"}[tool];
  return <main className={"viewer2 is-"+deviceProfile} data-device-profile={deviceProfile}>
    {showIntro&&<ViewerBootIntro loading={false}/>} 
    {session?.isDemo&&<div className="viewer2-demo-banner"><strong>DEMONSTRAÇÃO</strong><span>Paciente fictício • alterações desta sessão não afetam sua conta</span></div>}
    <header className="viewer2-top" id="viewer2-top">
      <div><button type="button" className="brand light viewer2-brand-home" onClick={()=>{clearViewerSession();nav(profileHome)}} title="Ir para a página inicial">OdontoView</button><span className="viewer2-beta">VIEWER 2.0 BETA</span>{session?.isDemo&&<span className="viewer2-demo-badge">DEMO</span>}</div>
      <div className="viewer2-study"><strong>{session?.order?.patient?.name||"Exame local"}</strong><span>{session?.order?.examType?.name||session?.result?.series?.[meta.seriesIndex]?.description} • {meta.manufacturer}{meta.model?" "+meta.model:""}</span>{deviceProfile!=="desktop"&&<small className="viewer2-device-mode">{deviceProfile==="tablet"?"Modo tablet • desempenho otimizado":"Modo celular • desempenho otimizado"}</small>}</div>
      <button className="viewer2-exit" onClick={()=>{clearViewerSession();nav(returnTo)}}>← {returnLabel}</button>
    </header>
    <section className="viewer2-toolbar">
      {(deviceProfile==="desktop"||showAdvancedTools
        ?[["navigate","⌖","Cruzeta"],["pan","✋","Pan"],["measure","↔","Medir"],["curve","⌒","Curva"],["nerve","●","Nervo"],["foramen","◉","Forame"]]
        :[["navigate","⌖","Cruzeta"],["pan","✋","Pan"],["measure","↔","Medir"],["curve","⌒","Curva"]]
      ).map(([id,icon,label])=><button key={id} className={tool===id?"active":""} onClick={()=>{setTool(id);setPendingMeasure(null)}}><span>{icon}</span>{label}</button>)}
      {deviceProfile!=="desktop"&&<button type="button" className={"viewer2-more-tools "+(showAdvancedTools?"active":"")} onClick={()=>setShowAdvancedTools(v=>!v)}><span>•••</span>{showAdvancedTools?"Menos":"Mais"}</button>}
      <button type="button" className={"viewer2-cursor-toggle "+(crosshairVisible?"is-on":"is-off")} onClick={()=>setCrosshairVisible(v=>!v)} aria-pressed={crosshairVisible}>
        {crosshairVisible?"⌖ Cursor visível":"○ Cursor oculto"}
      </button>
      <div className="viewer2-wl-buttons" aria-label="Controles de brilho e contraste">
        <div className="wl-control"><span>Brilho</span><button type="button" aria-label="Diminuir brilho" onClick={()=>adjustBrightness(-25)}>−</button><b>{Math.round(windowLevel.wc)}</b><button type="button" aria-label="Aumentar brilho" onClick={()=>adjustBrightness(25)}>+</button></div>
        <div className="wl-control"><span>Contraste</span><button type="button" aria-label="Diminuir contraste" onClick={()=>adjustContrast(-50)}>−</button><b>{Math.round(windowLevel.ww)}</b><button type="button" aria-label="Aumentar contraste" onClick={()=>adjustContrast(50)}>+</button></div>
        <button type="button" className="wl-reset" onClick={resetWindow}>Restaurar imagem</button>
      </div>
      <button type="button" className="viewer2-reset-all" onClick={resetAll}>↺ Restaurar geral</button>
      <div className="viewer2-wl viewer2-wl-sliders"><label>Brilho <input type="range" min={windowLevel.wc-windowLevel.ww} max={windowLevel.wc+windowLevel.ww} step="1" value={windowLevel.wc} onChange={e=>setWindowLevel(v=>({...v,wc:Number(e.target.value)}))}/></label><label>Contraste <input type="range" min="50" max={Math.max(5000,windowLevel.ww*2)} step="10" value={windowLevel.ww} onChange={e=>setWindowLevel(v=>({...v,ww:Number(e.target.value)}))}/></label></div>
      <div className="viewer2-tool-state">Ferramenta: <strong>{toolName}</strong></div>
    </section>
    <section className={"viewer2-grid viewer2-concept03"+(expandedPanel?" has-expanded expanded-"+expandedPanel:"")}>
      {[
        ["axial","Axial",canvases.axial],["coronal","Coronal",canvases.coronal],["sagittal","Sagital",canvases.sagittal],
        ["tangential","Tangencial • 3 cortes",canvases.tangential]
      ].map(([id,label,ref])=><article className={"viewer2-pane "+id+(expandedPanel===id?" is-expanded":"")} key={id}>
        <div className="viewer2-pane-head"><strong>{label}</strong><div className="viewer2-pane-actions"><button onClick={()=>resetPlane(id)}>1:1</button>{expandButton(id,label)}</div></div>
        {renderSliceControl(id,label)}
        <div className={"viewer2-canvas-wrap "+(deviceProfile!=="desktop"&&tool==="navigate"?"touch-scroll-friendly":"touch-tool-active")}><canvas className={tool==="navigate"?"crosshair-cursor":""} ref={ref} onWheel={e=>onWheel(id,e)} onPointerDown={e=>onPointerDown(id,e)} onPointerMove={e=>onPointerMove(id,e)} onPointerUp={e=>onPointerUp(id,e)} onPointerCancel={e=>onPointerUp(id,e)}/></div>
      </article>)}
      <article id="viewer2-panorama" className={"viewer2-pane panoramic visual3d-composite"+(expandedPanel==="3d"?" is-expanded":"")}>
        <div className="viewer2-pane-head"><strong>Modelo 3D • Planejamento</strong><div className="viewer2-pane-actions"><span className="viewer3d-badge">3D PROFISSIONAL</span>{expandButton("3d","3D")}</div></div>
        <div className="viewer3d-split">
          <div className="viewer3d-primary">
            {threeDEnabled?<Viewer3DPanel
              key={expandedPanel==="3d"?"viewer3d-expanded":"viewer3d-standard"}
              volume={volumeRef.current}
              meta={meta}
              nervePoints={nerveDisplayPoints}
              curve={curve}
              cursor={cursor}
              crosshairVisible={crosshairVisible}
              onCrosshairVisibleChange={setCrosshairVisible}
              onCursorChange={updateCursorFrom3D}
              globalTool={tool}
              implants={implants}
              activeImplantId={activeImplantId}
              onImplantsChange={setImplants}
              onActiveImplantChange={setActiveImplantId}
              layoutMode={expandedPanel||"mosaic"}
              performanceProfile={deviceProfile}
            />:<div className="viewer3d-tablet-gate">
              <span className="viewer3d-tablet-icon">3D</span>
              <strong>3D sob demanda no {deviceProfile==="tablet"?"tablet":"celular"}</strong>
              <p>Os cortes MPR já estão disponíveis em resolução original. O 3D é carregado separadamente para não travar o dispositivo.</p>
              <button type="button" onClick={()=>setThreeDEnabled(true)}>Ativar reconstrução 3D</button>
            </div>}
          </div>
          <div className={"viewer3d-mini-pano"+(expandedPanel==="panoramic"?" is-expanded":"")}>
            <div className="viewer3d-mini-head"><strong>Panorâmica reconstruída</strong><div className="viewer2-pane-actions"><button onClick={()=>resetPlane("panoramic")}>1:1</button>{expandButton("panoramic","Panorâmica")}</div></div>
            {renderSliceControl("panoramic","Panorâmica reconstruída")}
            <div className={"viewer2-canvas-wrap viewer3d-pano-canvas "+(deviceProfile!=="desktop"&&tool==="navigate"?"touch-scroll-friendly":"touch-tool-active")}><canvas className={tool==="navigate"?"crosshair-cursor":""} ref={canvases.panoramic} onWheel={e=>onWheel("panoramic",e)} onPointerDown={e=>onPointerDown("panoramic",e)} onPointerMove={e=>onPointerMove("panoramic",e)} onPointerUp={e=>onPointerUp("panoramic",e)} onPointerCancel={e=>onPointerUp("panoramic",e)}/></div>
          </div>
        </div>
      </article>
      <aside className="viewer2-side">
        <section>
          <p className="eyebrow">CURVA DA ARCADA</p><strong>{archRange.label}</strong>
          <small className="viewer2-arch-type">Arcada informada: {dentalArchType==="maxilla"?"Maxila":dentalArchType==="mandible"?"Mandíbula":dentalArchType==="both"?"Ambas":"A confirmar"}</small>
          <div className="arch-scope" role="group" aria-label="Tipo de arcada">
            <button className={archMode==="auto"?"active":""} onClick={()=>setArchMode("auto")}>Auto</button>
            <button className={archMode==="full"?"active":""} onClick={()=>setArchMode("full")}>Completa</button>
            <button className={archMode==="left"?"active":""} onClick={()=>setArchMode("left")}>Semi ← imagem</button>
            <button className={archMode==="right"?"active":""} onClick={()=>setArchMode("right")}>Semi → imagem</button>
          </div>
          <button className="viewer2-small assist" onClick={analyzeArchScope}>Reanalisar tipo de arcada</button>
          <input type="range" min={archRange.start} max={archRange.end} value={curveIndex} onChange={e=>setCurveIndex(Number(e.target.value))}/>
          <small>Corte tangencial {curveIndex-archRange.start+1}/{archRange.end-archRange.start+1}. A faixa azul mostra os {PANORAMIC_BAND_HALF_MM*2} mm usados na reconstrução. Em Auto, o OdontoView tenta distinguir arcada completa de semi-arcada pelo axial atual; o profissional pode sobrescrever a escolha.</small>
          <div className="curve-assist-actions">
            <button className="viewer2-small assist" onClick={()=>suggestArchFromAxial()}>Sugerir curva pelo axial atual</button>
            <button className="viewer2-small" onClick={()=>{setTool("curve");document.getElementById("viewer2-top")?.scrollIntoView({behavior:"smooth"})}}>Ajustar curva manualmente</button>
            {curveBeforeAssistRef.current&&<button className="viewer2-small" onClick={undoSuggestedArch}>Desfazer sugestão</button>}
            <button className="viewer2-small" onClick={resetArch}>Restaurar curva inicial</button>
          </div>
          {curveAssistMessage&&<div className="assist-note">{curveAssistMessage}</div>}
          <small>A sugestão usa densidade local do corte axial atual como auxílio de posicionamento; não é segmentação anatômica automática e precisa de revisão do profissional.</small>
        </section>
        <section className="viewer2-export">
          <p className="eyebrow">SÉRIE DE CORTES</p>
          <strong>PDF clínico a partir da região atual</strong>
          <div className="export-modes" role="group" aria-label="Modo do PDF">
            <button type="button" className={exportMode==="complete"?"active":""} onClick={()=>setExportMode("complete")}>Completo • 4 eixos</button>
            <button type="button" className={exportMode==="tangential"?"active":""} onClick={()=>setExportMode("tangential")}>Só tangencial</button>
          </div>
          <p className="export-range">{exportMode==="complete"?`${exportCount} cortes de cada eixo • até ${exportCount*4} imagens`:`${exportCount} cortes tangenciais`}</p>
          <div className="cut-counts" role="group" aria-label="Quantidade de cortes por eixo">
            {[10,15,20,30,40].map(n=><button type="button" key={n} className={exportCount===n?"active":""} onClick={()=>setExportCount(n)}>{n}</button>)}
          </div>
          <button type="button" className="viewer2-export-btn" disabled={exportBusy} onClick={exportTangentialPdf}>{exportBusy?"Gerando PDF…":exportMode==="complete"?"Gerar PDF completo":"Gerar PDF tangencial"}</button>
          <small>No modo completo o OdontoView gera Tangencial + Axial + Coronal + Sagital, organizados por eixo, com 4 imagens por página. Os cortes são distribuídos ao redor da posição atualmente selecionada.</small>
          {exportMessage&&<div className="export-message">{exportMessage}</div>}
        </section>
        <section>
          <p className="eyebrow red">NERVO / FORAME</p><strong>Traçado em vermelho</strong>
          <p>{nervePoints.length} ponto(s) âncora • {nerveAssist&&nervePoints.length>=2?nerveDisplayPoints.length+" ponto(s) no trajeto assistido":"trajeto manual"} • {foramina.length} forame(s)</p>
          <button className={"viewer2-small assist "+(nerveAssist?"active":"")} onClick={()=>setNerveAssist(v=>!v)}>{nerveAssist?"Traçado assistido ligado":"Ativar traçado assistido"}</button>
          <small>Marque pontos do canal em cortes tangenciais. O modo assistido apenas interpola suavemente entre os pontos que você marcou; ele não detecta o canal automaticamente. Cada ponto âncora continua editável e removível.</small>
          {nervePoints.length>0&&<div className="nerve-point-list">
            {nervePoints.map((n,i)=><div key={n.id||("n-"+i)}><span>N{i+1} • corte {n.curveIndex+1}</span><button aria-label={"Excluir ponto do nervo "+(i+1)} onClick={()=>setNervePoints(ns=>ns.filter((_,idx)=>idx!==i))}>×</button></div>)}
          </div>}
          {foramina.length>0&&<div className="nerve-point-list foramen-list">
            {foramina.map((n,i)=><div key={n.id||("f-"+i)}><span>Forame {i+1} • corte {n.curveIndex+1}</span><button aria-label={"Excluir forame "+(i+1)} onClick={()=>setForamina(fs=>fs.filter((_,idx)=>idx!==i))}>×</button></div>)}
          </div>}
          {(nervePoints.length>0||foramina.length>0)&&<div className="nerve-actions">
            {nervePoints.length>0&&<button className="viewer2-small" onClick={undoLastNerve}>Desfazer último nervo</button>}
            {foramina.length>0&&<button className="viewer2-small" onClick={undoLastForamen}>Desfazer último forame</button>}
            <button className="viewer2-small danger" onClick={()=>{setNervePoints([]);setNerveAssist(true);setForamina([])}}>Limpar tudo</button>
          </div>}
        </section>
        <section className="viewer2-tooth-library">
          <p className="eyebrow">BIBLIOTECA DENTÁRIA</p>
          <strong>FDI permanente • 11–48</strong>
          <small>Selecione o dente e posicione a referência na cruzeta. O catálogo já está preparado para receber a malha 3D correspondente; nesta etapa o marcador não representa anatomia final.</small>
          <div className="tooth-arch-list">
            {TOOTH_ARCH_ROWS.map(row=><div className="tooth-arch-row" key={row.key}>
              <span>{row.label}</span>
              <div className="tooth-grid">
                {row.fdi.map(fdi=>{
                  const placed=plannedTeeth.some(item=>item.fdi===fdi);
                  return <button type="button" key={fdi} className={(selectedToothFDI===fdi?"active ":"")+(placed?"placed":"")} onClick={()=>setSelectedToothFDI(fdi)} aria-pressed={selectedToothFDI===fdi}>{fdi}</button>
                })}
              </div>
            </div>)}
          </div>
          {selectedTooth&&<div className="tooth-selected-card">
            <div><b>Dente {selectedTooth.fdi}</b><span>{selectedTooth.label} • {selectedTooth.archLabel} • lado {selectedTooth.sideLabel.toLowerCase()}</span></div>
            <span className="tooth-mesh-status">Malha 3D pendente</span>
          </div>}
          <button type="button" className="viewer2-small assist tooth-place-btn" onClick={placeSelectedToothAtCursor}>{selectedToothPlaced?"Reposicionar "+selectedToothFDI+" na cruzeta":"Adicionar "+selectedToothFDI+" na cruzeta"}</button>
          {plannedTeeth.length>0&&<div className="planned-tooth-list">
            {plannedTeeth.slice().sort((a,b)=>Number(a.fdi)-Number(b.fdi)).map(item=><div key={item.id}>
              <button type="button" className="planned-tooth-focus" onClick={()=>focusPlannedTooth(item)}><b>{item.fdi}</b><span>{item.label}</span></button>
              <button type="button" className="planned-tooth-remove" aria-label={"Remover dente "+item.fdi} onClick={()=>removePlannedTooth(item.fdi)}>×</button>
            </div>)}
          </div>}
          <small>{PERMANENT_FDI_LIBRARY.length} dentes permanentes catalogados. Dentes decíduos ficam para a próxima biblioteca.</small>
        </section>
        <section>
          <p className="eyebrow">MEDIÇÕES</p><strong>{measurements.length} medida(s)</strong>
          <div className="measure-list">{measurements.map((m,i)=><div key={m.id}><span>M{i+1} • {m.plane}</span><b>{measurementDistance(m,meta).toFixed(2)} mm</b><button onClick={()=>setMeasurements(ms=>ms.filter(x=>x.id!==m.id))}>×</button></div>)}</div>
          {measurements.length>0&&<button className="viewer2-small" onClick={()=>setMeasurements([])}>Apagar todas</button>}
        </section>
        <section className="viewer2-quality">
          <p className="eyebrow">QUALIDADE</p><strong>{meta.w}×{meta.h}×{meta.d}</strong>
          <p>{meta.spacingX.toFixed(3)} × {meta.spacingY.toFixed(3)} × {meta.spacingZ.toFixed(3)} mm</p>
          <small>Ruído e artefatos foram removidos da barra até termos processamento validado. Zoom agora é geométrico e independente do contraste.</small>
        </section>
      </aside>
    </section>

    {archSetupOpen&&<div className="viewer2-arch-setup" role="dialog" aria-modal="true" aria-label="Preparar curva panorâmica">
      <section>
        <span className="viewer2-arch-setup-icon">⌒</span>
        <p className="eyebrow">PREPARAÇÃO DA PANORÂMICA</p>
        <h2>Qual arcada este DICOM representa?</h2>
        <p>Isso ajuda o OdontoView a preparar a primeira curva antes de abrir o planejamento. A sugestão é heurística e deve ser revisada pelo profissional.</p>
        <div className="viewer2-arch-choices">
          <button disabled={archSetupBusy} onClick={()=>prepareArchAutomatically("maxilla")}><strong>Maxila</strong><span>Arcada superior</span></button>
          <button disabled={archSetupBusy} onClick={()=>prepareArchAutomatically("mandible")}><strong>Mandíbula</strong><span>Arcada inferior</span></button>
          <button disabled={archSetupBusy} onClick={()=>prepareArchAutomatically("both")}><strong>Ambas</strong><span>Volume com as duas arcadas</span></button>
          <button disabled={archSetupBusy} onClick={()=>prepareArchAutomatically("unknown")}><strong>Não sei</strong><span>Deixe o sistema tentar</span></button>
        </div>
        {archSetupBusy&&<div className="viewer2-arch-preparing">Analisando o volume e preparando a curva…</div>}
        <button className="viewer2-arch-manual" disabled={archSetupBusy} onClick={()=>{setDentalArchType("unknown");setArchSetupOpen(false);setTool("curve")}}>Pular e ajustar manualmente</button>
      </section>
    </div>}

    {deviceProfile==="tablet"&&<nav className="viewer2-tablet-scroll" aria-label="Navegação rápida no Viewer">
      <button type="button" onClick={()=>document.getElementById("viewer2-top")?.scrollIntoView({behavior:"smooth"})}>↑</button>
      <button type="button" onClick={()=>window.scrollBy({top:Math.round(window.innerHeight*.72),behavior:"smooth"})}>↓</button>
      <button type="button" className="wide" onClick={()=>document.getElementById("viewer2-panorama")?.scrollIntoView({behavior:"smooth",block:"start"})}>Panorâmica</button>
    </nav>}
  </main>;
}
