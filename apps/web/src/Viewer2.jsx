import React,{useEffect,useMemo,useRef,useState} from "react";
import {useNavigate} from "react-router-dom";
import {jsPDF} from "jspdf";
import {clearViewerSession,getViewerSession} from "./viewerSession.js";

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

export default function Viewer2(){
  const nav=useNavigate();
  const session=useMemo(()=>getViewerSession(),[]);
  const volumeRef=useRef(null);
  const metaRef=useRef(null);
  const defaultWindowRef=useRef({wc:400,ww:2000});
  const defaultCurveRef=useRef([]);
  const dragRef=useRef(null);
  const curveDragRef=useRef(null);
  const navDragRef=useRef(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [meta,setMeta]=useState(null);
  const [cursor,setCursor]=useState({x:0,y:0,z:0});
  const [curvePoints,setCurvePoints]=useState([]);
  const curve=useMemo(()=>catmullRom(curvePoints,18),[curvePoints]);
  const [curveIndex,setCurveIndex]=useState(0);
  const [tool,setTool]=useState("navigate");
  const [windowLevel,setWindowLevel]=useState({wc:400,ww:2000});
  const [measurements,setMeasurements]=useState([]);
  const [pendingMeasure,setPendingMeasure]=useState(null);
  const [nervePoints,setNervePoints]=useState([]);
  const [foramina,setForamina]=useState([]);
  const [exportCount,setExportCount]=useState(15);
  const [exportBusy,setExportBusy]=useState(false);
  const [exportMessage,setExportMessage]=useState("");
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
        const first=await cornerstone.loadAndCacheImage(ids[0]);
        const w=first.columns,h=first.rows,d=ids.length;
        const volume=new Int16Array(w*h*d);
        const slope0=Number(first.slope)||1,intercept0=Number(first.intercept)||0;
        for(let z=0;z<d;z++){
          if(cancelled)return;
          const image=z===0?first:await cornerstone.loadAndCacheImage(ids[z]);
          const px=image.getPixelData(),s=Number(image.slope)||slope0,i=Number(image.intercept)||intercept0;
          const off=z*w*h,n=w*h;
          for(let p=0;p<n;p++)volume[off+p]=clamp(Math.round(px[p]*s+i),-32768,32767);
          if(z%12===0)setMeta(m=>m?{...m,progress:z+1}:m);
        }
        if(cancelled)return;
        const firstItem=sorted[0]||{};
        const spacingY=Number(firstItem.pixelSpacing?.[0])||Number(first.rowPixelSpacing)||1;
        const spacingX=Number(firstItem.pixelSpacing?.[1])||Number(first.columnPixelSpacing)||1;
        const spacingZ=Number(report.nominalSpacing)||Number(first.sliceThickness)||1;
        const computedWindow=(Number.isFinite(Number(first.windowCenter))&&Number(first.windowWidth)>0)
          ?{wc:Number(Array.isArray(first.windowCenter)?first.windowCenter[0]:first.windowCenter),ww:Number(Array.isArray(first.windowWidth)?first.windowWidth[0]:first.windowWidth)}
          :percentileWindow(volume);
        const nextMeta={w,h,d,spacingX,spacingY,spacingZ,manufacturer:session.result.series[validIndex].manufacturer,model:session.result.series[validIndex].model,seriesIndex:validIndex};
        volumeRef.current=volume;metaRef.current=nextMeta;
        defaultWindowRef.current=computedWindow;
        setMeta(nextMeta);setWindowLevel(computedWindow);
        setCursor({x:Math.floor(w/2),y:Math.floor(h/2),z:Math.floor(d/2)});
        const arch=defaultArch(w,h);
        defaultCurveRef.current=arch.map(p=>({...p}));
        setCurvePoints(arch);
        const sampled=catmullRom(arch,18);setCurveIndex(Math.floor(sampled.length/2));
        setLoading(false);
      }catch(e){if(!cancelled){setError(e.message||"Falha ao montar o volume.");setLoading(false)}}
    }
    build();
    return()=>{cancelled=true};
  },[session]);

  function fit(canvas,pixelW,pixelH,spacingA,spacingB,plane){
    const rect=canvas.parentElement.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
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
    const map=canvas._map;if(!map)return null;
    const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*map.dpr,y=(event.clientY-rect.top)*map.dpr;
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
      ctx.save();ctx.strokeStyle="#31d7d2";ctx.lineWidth=2*map.dpr;ctx.beginPath();
      curve.forEach((pt,i)=>{const q=screen(pt);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke();
      curvePoints.forEach(pt=>{const q=screen(pt);ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(q.x,q.y,4*map.dpr,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#31d7d2";ctx.stroke()});
      const active=curve[curveIndex];if(active){const q=screen(active);ctx.fillStyle="#31d7d2";ctx.beginPath();ctx.arc(q.x,q.y,6*map.dpr,0,Math.PI*2);ctx.fill()}
      ctx.restore();
    }
    nervePoints.forEach(n=>{
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
    drawCrosshair(ctx,canvas,cursor.x,cursor.y);
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
    if(isCoronal)drawCrosshair(ctx,canvas,cursor.x,d-1-cursor.z);
    else drawCrosshair(ctx,canvas,cursor.y,d-1-cursor.z);
    drawMeasurementOverlay(ctx,canvas,plane,fixed);
  }

  function tangentFrame(index){
    const m=metaRef.current;if(!m||!curve.length)return null;
    const c=curve[clamp(index,0,curve.length-1)],prev=curve[Math.max(0,index-1)],next=curve[Math.min(curve.length-1,index+1)];
    let tx=(next.x-prev.x)*m.spacingX,ty=(next.y-prev.y)*m.spacingY,len=Math.hypot(tx,ty)||1;tx/=len;ty/=len;
    return {c,nx:-ty,ny:tx};
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

    const nerve=nervePoints.find(n=>n.curveIndex===index);
    if(nerve){
      const x=pixelW/2+nerve.offsetMm/stepMm,y=d-1-nerve.z;
      ctx.fillStyle="#ff2d2d";ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
    }
    foramina.filter(n=>n.curveIndex===index).forEach(n=>{
      const x=pixelW/2+n.offsetMm/stepMm,y=d-1-n.z;
      ctx.strokeStyle="#ff2d2d";ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.stroke();
    });
    return canvas;
  }

  async function exportTangentialPdf(){
    if(exportBusy||!metaRef.current||!curve.length)return;
    const remaining=Math.max(0,curve.length-curveIndex);
    const count=Math.min(exportCount,remaining,40);
    if(!count){setExportMessage("Não há cortes à frente deste ponto.");return}
    setExportBusy(true);setExportMessage("");
    try{
      const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
      const pageW=210,pageH=297,margin=12,gap=6,headerH=24;
      const cellW=(pageW-margin*2-gap)/2,cellH=(pageH-margin*2-headerH-gap)/2;
      const patient=session?.order?.patient?.name||"Paciente";
      const exam=session?.order?.examType?.name||session?.result?.series?.[meta.seriesIndex]?.description||"CBCT";
      const totalPages=Math.ceil(count/4);

      for(let i=0;i<count;i++){
        if(i>0&&i%4===0)pdf.addPage();
        const pageIndex=Math.floor(i/4)+1;
        const slot=i%4,col=slot%2,row=Math.floor(slot/2);
        if(slot===0){
          pdf.setFont("helvetica","bold");pdf.setFontSize(14);pdf.text("OdontoView — Série de cortes tangenciais",margin,12);
          pdf.setFont("helvetica","normal");pdf.setFontSize(9);
          pdf.text(`${patient} • ${exam}`,margin,18);
          pdf.text(`Página ${pageIndex}/${totalPages} • início no corte ${curveIndex+1}`,pageW-margin,18,{align:"right"});
        }
        const idx=curveIndex+i,canvas=makeTangentialCanvas(idx);
        const img=canvas.toDataURL("image/jpeg",.88);
        const x=margin+col*(cellW+gap),y=margin+headerH+row*(cellH+gap);
        const physicalRatio=(meta.spacingZ*meta.d)/(40);
        let drawW=cellW,drawH=drawW*physicalRatio;
        if(drawH>cellH-12){drawH=cellH-12;drawW=drawH/physicalRatio}
        const dx=x+(cellW-drawW)/2,dy=y+4;
        pdf.setDrawColor(220);pdf.rect(x,y,cellW,cellH);
        pdf.addImage(img,"JPEG",dx,dy,drawW,drawH,undefined,"FAST");
        pdf.setFontSize(9);pdf.setTextColor(40);pdf.text(`Corte ${idx+1} • ${i+1}/${count}`,x+cellW/2,y+cellH-4,{align:"center"});
      }
      pdf.setProperties({title:`OdontoView - ${patient} - cortes tangenciais`,subject:exam,creator:"OdontoView"});
      const safe=patient.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"_").replace(/^_|_$/g,"");
      pdf.save(`OdontoView_${safe||"Paciente"}_${count}_cortes.pdf`);
      setExportMessage(`PDF gerado com ${count} cortes a partir do corte ${curveIndex+1}.`);
    }catch(e){
      setExportMessage(e?.message||"Não foi possível gerar o PDF.");
    }finally{setExportBusy(false)}
  }

  function drawTangential(canvas){
    const m=metaRef.current,v=volumeRef.current;if(!m||!v||!curve.length)return;
    const {w,h,d,spacingX,spacingY,spacingZ}=m,frame=tangentFrame(curveIndex);if(!frame)return;
    const widthMm=40,stepMm=.25,pixelW=Math.round(widthMm/stepMm),pixelH=d;
    const {cw,ch,ox,oy,dw,dh}=fit(canvas,pixelW,pixelH,stepMm,spacingZ,"tangential");
    const ctx=canvas.getContext("2d",{alpha:false}),img=ctx.createImageData(pixelW,pixelH);let p=0;
    for(let z=d-1;z>=0;z--)for(let a=0;a<pixelW;a++){
      const off=(a-pixelW/2)*stepMm,x=frame.c.x+frame.nx*off/spacingX,y=frame.c.y+frame.ny*off/spacingY;
      const g=wl(bilinear(v,w,h,d,x,y,z),windowLevel.wc,windowLevel.ww);
      img.data[p++]=g;img.data[p++]=g;img.data[p++]=g;img.data[p++]=255;
    }
    const tmp=document.createElement("canvas");tmp.width=pixelW;tmp.height=pixelH;tmp.getContext("2d").putImageData(img,0,0);
    ctx.fillStyle="#05070a";ctx.fillRect(0,0,cw,ch);ctx.imageSmoothingEnabled=true;ctx.drawImage(tmp,ox,oy,dw,dh);
    const map=canvas._map;
    [...nervePoints.map(n=>({...n,type:"nerve"})),...foramina.map(n=>({...n,type:"foramen"}))].filter(n=>n.curveIndex===curveIndex).forEach(n=>{
      const a=pixelW/2+n.offsetMm/stepMm,b=d-1-n.z;
      const x=map.ox+a/pixelW*map.dw,y=map.oy+b/pixelH*map.dh;
      ctx.strokeStyle="#ff2d2d";ctx.fillStyle="#ff2d2d";ctx.lineWidth=3*map.dpr;ctx.beginPath();ctx.arc(x,y,(n.type==="foramen"?8:4)*map.dpr,0,Math.PI*2);n.type==="foramen"?ctx.stroke():ctx.fill();
    });
    const dx=(cursor.x-frame.c.x)*spacingX,dy=(cursor.y-frame.c.y)*spacingY;
    const offsetMm=dx*frame.nx+dy*frame.ny;
    drawCrosshair(ctx,canvas,pixelW/2+offsetMm/stepMm,d-1-cursor.z);
    drawMeasurementOverlay(ctx,canvas,"tangential",curveIndex);
  }

  function drawPanoramic(canvas){
    const m=metaRef.current,v=volumeRef.current;if(!m||!v||!curve.length)return;
    const {w,h,d,spacingX,spacingY,spacingZ}=m,pixelW=curve.length,pixelH=d;
    const approxStepMm=Math.max(.2,Math.hypot((curve[1]?.x-curve[0]?.x||1)*spacingX,(curve[1]?.y-curve[0]?.y||1)*spacingY));
    const {cw,ch,ox,oy,dw,dh}=fit(canvas,pixelW,pixelH,approxStepMm,spacingZ,"panoramic");
    const ctx=canvas.getContext("2d",{alpha:false}),img=ctx.createImageData(pixelW,pixelH);let p=0;
    for(let z=d-1;z>=0;z--)for(let ci=0;ci<pixelW;ci++){
      const frame=tangentFrame(ci);let total=0,count=0;
      for(const off of [-2,-1,0,1,2]){const x=frame.c.x+frame.nx*off/spacingX,y=frame.c.y+frame.ny*off/spacingY;total+=bilinear(v,w,h,d,x,y,z);count++}
      const g=wl(total/count,windowLevel.wc,windowLevel.ww);img.data[p++]=g;img.data[p++]=g;img.data[p++]=g;img.data[p++]=255;
    }
    const tmp=document.createElement("canvas");tmp.width=pixelW;tmp.height=pixelH;tmp.getContext("2d").putImageData(img,0,0);
    ctx.fillStyle="#05070a";ctx.fillRect(0,0,cw,ch);ctx.imageSmoothingEnabled=true;ctx.drawImage(tmp,ox,oy,dw,dh);
    const map=canvas._map;
    const sorted=[...nervePoints].sort((a,b)=>a.curveIndex-b.curveIndex);
    if(sorted.length){ctx.strokeStyle="#ff2d2d";ctx.fillStyle="#ff2d2d";ctx.lineWidth=3*map.dpr;ctx.beginPath();sorted.forEach((n,i)=>{const x=map.ox+n.curveIndex/pixelW*map.dw,y=map.oy+(d-1-n.z)/pixelH*map.dh;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();sorted.forEach(n=>{const x=map.ox+n.curveIndex/pixelW*map.dw,y=map.oy+(d-1-n.z)/pixelH*map.dh;ctx.beginPath();ctx.arc(x,y,3*map.dpr,0,Math.PI*2);ctx.fill()})}
    foramina.forEach(n=>{const x=map.ox+n.curveIndex/pixelW*map.dw,y=map.oy+(d-1-n.z)/pixelH*map.dh;ctx.strokeStyle="#ff2d2d";ctx.lineWidth=3*map.dpr;ctx.beginPath();ctx.arc(x,y,7*map.dpr,0,Math.PI*2);ctx.stroke()});
    drawCrosshair(ctx,canvas,curveIndex,d-1-cursor.z);
  }

  useEffect(()=>{
    if(loading||error||!meta)return;
    const draw=()=>{drawAxial(canvases.axial.current);drawOrthogonal(canvases.coronal.current,"coronal");drawOrthogonal(canvases.sagittal.current,"sagittal");drawTangential(canvases.tangential.current);drawPanoramic(canvases.panoramic.current)};
    draw();window.addEventListener("resize",draw);return()=>window.removeEventListener("resize",draw);
  },[loading,error,meta,cursor,curvePoints,curveIndex,windowLevel,measurements,pendingMeasure,nervePoints,foramina,transforms]);

  function resetPlane(plane){setTransforms(t=>({...t,[plane]:{zoom:1,panX:0,panY:0}}))}
  function adjustBrightness(delta){setWindowLevel(v=>({...v,wc:Math.round(v.wc+delta)}))}
  function adjustContrast(delta){setWindowLevel(v=>({...v,ww:Math.max(50,Math.round(v.ww+delta))}))}
  function resetWindow(){setWindowLevel({...defaultWindowRef.current})}
  function resetArch(){
    const m=metaRef.current;if(!m)return;
    const arch=(defaultCurveRef.current?.length?defaultCurveRef.current:defaultArch(m.w,m.h)).map(p=>({...p}));
    setCurvePoints(arch);
    const sampled=catmullRom(arch,18);
    setCurveIndex(Math.floor(sampled.length/2));
  }
  function resetAll(){
    const m=metaRef.current;if(!m)return;
    const arch=(defaultCurveRef.current?.length?defaultCurveRef.current:defaultArch(m.w,m.h)).map(p=>({...p}));
    setWindowLevel({...defaultWindowRef.current});
    setCursor({x:Math.floor(m.w/2),y:Math.floor(m.h/2),z:Math.floor(m.d/2)});
    setCurvePoints(arch);
    setCurveIndex(Math.floor(catmullRom(arch,18).length/2));
    setMeasurements([]);
    setPendingMeasure(null);
    setNervePoints([]);
    setForamina([]);
    setTransforms({
      axial:{zoom:1,panX:0,panY:0},coronal:{zoom:1,panX:0,panY:0},
      sagittal:{zoom:1,panX:0,panY:0},tangential:{zoom:1,panX:0,panY:0},panoramic:{zoom:1,panX:0,panY:0}
    });
    setTool("navigate");
    setExportCount(15);
    setExportMessage("");
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
    const slice=planeSlice(metaRef.current,plane,cursor,curveIndex),[spacingA,spacingB]=currentSpacing(plane);
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
      const frame=tangentFrame(curveIndex);if(!frame)return;
      const stepMm=.25,pixelW=canvas._map.pixelW;
      const off=(pt.a-pixelW/2)*stepMm;
      setCursor(c=>({
        ...c,
        x:clamp(Math.round(frame.c.x+frame.nx*off/m.spacingX),0,m.w-1),
        y:clamp(Math.round(frame.c.y+frame.ny*off/m.spacingY),0,m.h-1),
        z:clamp(Math.round(m.d-1-pt.b),0,m.d-1)
      }));
    }else if(plane==="panoramic"){
      setCurveIndex(clamp(Math.round(pt.a),0,curve.length-1));
      setCursor(c=>({...c,z:clamp(Math.round(m.d-1-pt.b),0,m.d-1)}));
    }
  }

  function onPointerDown(plane,e){
    const canvas=e.currentTarget,pt=toImagePoint(canvas,e);
    if(tool==="pan"){beginPan(plane,e);return}
    if(!pt)return;
    if(tool==="measure"){handleMeasurement(plane,pt);return}
    if(tool==="curve"&&plane==="axial"){
      const map=canvas._map;let best=-1,bestDist=Infinity;
      curvePoints.forEach((c,i)=>{const a=c.x/metaRef.current.w*map.pixelW,b=c.y/metaRef.current.h*map.pixelH,dist=Math.hypot(a-pt.a,b-pt.b);if(dist<bestDist){best=i;bestDist=dist}});
      if(best>=0&&bestDist<20){curveDragRef.current=best;canvas.setPointerCapture(e.pointerId)}return;
    }
    if((tool==="nerve"||tool==="foramen")&&plane==="tangential"){
      const pixelW=canvas._map.pixelW,d=metaRef.current.d,offsetMm=(pt.a-pixelW/2)*.25,z=clamp(Math.round(d-1-pt.b),0,d-1);
      const mark={id:(crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random())),curveIndex,z,offsetMm};
      if(tool==="nerve")setNervePoints(ns=>[...ns.filter(n=>Math.abs(n.curveIndex-curveIndex)>1),mark].sort((a,b)=>a.curveIndex-b.curveIndex));
      else setForamina(fs=>[...fs,mark]);
      return;
    }
    if(tool==="navigate"){
      navigateAt(plane,canvas,pt);
      navDragRef.current={plane};
      try{canvas.setPointerCapture(e.pointerId)}catch{}
    }
  }
  function onPointerMove(plane,e){
    if(dragRef.current){movePan(e);return}
    if(navDragRef.current&&tool==="navigate"&&navDragRef.current.plane===plane){
      const pt=toImagePoint(e.currentTarget,e);if(pt)navigateAt(plane,e.currentTarget,pt);
      return;
    }
    if(curveDragRef.current==null||tool!=="curve"||plane!=="axial")return;
    const pt=toImagePoint(e.currentTarget,e);if(!pt)return;
    const i=curveDragRef.current,m=metaRef.current;
    setCurvePoints(ps=>ps.map((p,index)=>index===i?{x:clamp(pt.a,0,m.w-1),y:clamp(pt.b,0,m.h-1)}:p));
  }
  function onPointerUp(){dragRef.current=null;curveDragRef.current=null;navDragRef.current=null}

  function planeControl(id){
    const m=metaRef.current;if(!m)return {min:0,max:0,value:0,label:""};
    if(id==="axial")return {min:0,max:m.d-1,value:cursor.z,label:`Z ${cursor.z+1}/${m.d}`,set:v=>setCursor(c=>({...c,z:Number(v)}))};
    if(id==="coronal")return {min:0,max:m.h-1,value:cursor.y,label:`Y ${cursor.y+1}/${m.h}`,set:v=>setCursor(c=>({...c,y:Number(v)}))};
    if(id==="sagittal")return {min:0,max:m.w-1,value:cursor.x,label:`X ${cursor.x+1}/${m.w}`,set:v=>setCursor(c=>({...c,x:Number(v)}))};
    if(id==="tangential")return {min:0,max:Math.max(0,curve.length-1),value:curveIndex,label:`Tangencial ${curveIndex+1}/${curve.length}`,set:v=>setCurveIndex(Number(v))};
    return {min:0,max:Math.max(0,curve.length-1),value:curveIndex,label:`Região ${curveIndex+1}/${curve.length}`,set:v=>setCurveIndex(Number(v))};
  }

  if(loading)return <main className="viewer2-loading"><div><div className="brand">OdontoView</div><h1>Montando Viewer 2.0…</h1><p>Decodificando o volume DICOM localmente.</p></div></main>;
  if(error)return <main className="page centered"><section className="card auth"><div className="brand">OdontoView</div><h2>Viewer 2.0</h2><div className="error">{error}</div><button className="secondary" onClick={()=>nav("/radiologia")}>Voltar</button></section></main>;

  const toolName={navigate:"Cruzeta",pan:"Pan",measure:"Medir",curve:"Curva da arcada",nerve:"Nervo",foramen:"Forame"}[tool];
  return <main className="viewer2">
    <header className="viewer2-top">
      <div><div className="brand light">OdontoView</div><span className="viewer2-beta">VIEWER 2.0 BETA</span></div>
      <div className="viewer2-study"><strong>{session?.order?.patient?.name||"Exame local"}</strong><span>{session?.order?.examType?.name||session?.result?.series?.[meta.seriesIndex]?.description} • {meta.manufacturer}{meta.model?" "+meta.model:""}</span></div>
      <button className="viewer2-exit" onClick={()=>{clearViewerSession();nav("/radiologia")}}>Voltar à radiologia</button>
    </header>
    <section className="viewer2-toolbar">
      {[
        ["navigate","⌖","Cruzeta"],["pan","✋","Pan"],["measure","↔","Medir"],["curve","⌒","Curva"],["nerve","●","Nervo"],["foramen","◉","Forame"]
      ].map(([id,icon,label])=><button key={id} className={tool===id?"active":""} onClick={()=>{setTool(id);setPendingMeasure(null)}}><span>{icon}</span>{label}</button>)}
      <div className="viewer2-wl-buttons" aria-label="Controles de brilho e contraste">
        <div className="wl-control"><span>Brilho</span><button type="button" aria-label="Diminuir brilho" onClick={()=>adjustBrightness(-25)}>−</button><b>{Math.round(windowLevel.wc)}</b><button type="button" aria-label="Aumentar brilho" onClick={()=>adjustBrightness(25)}>+</button></div>
        <div className="wl-control"><span>Contraste</span><button type="button" aria-label="Diminuir contraste" onClick={()=>adjustContrast(-50)}>−</button><b>{Math.round(windowLevel.ww)}</b><button type="button" aria-label="Aumentar contraste" onClick={()=>adjustContrast(50)}>+</button></div>
        <button type="button" className="wl-reset" onClick={resetWindow}>Restaurar imagem</button>
      </div>
      <button type="button" className="viewer2-reset-all" onClick={resetAll}>↺ Restaurar geral</button>
      <div className="viewer2-wl viewer2-wl-sliders"><label>Brilho <input type="range" min={windowLevel.wc-windowLevel.ww} max={windowLevel.wc+windowLevel.ww} step="1" value={windowLevel.wc} onChange={e=>setWindowLevel(v=>({...v,wc:Number(e.target.value)}))}/></label><label>Contraste <input type="range" min="50" max={Math.max(5000,windowLevel.ww*2)} step="10" value={windowLevel.ww} onChange={e=>setWindowLevel(v=>({...v,ww:Number(e.target.value)}))}/></label></div>
      <div className="viewer2-tool-state">Ferramenta: <strong>{toolName}</strong></div>
    </section>
    <section className="viewer2-grid">
      {[
        ["axial","Axial",canvases.axial],["coronal","Coronal",canvases.coronal],["sagittal","Sagital",canvases.sagittal],
        ["tangential","Tangencial",canvases.tangential],["panoramic","Panorâmica reconstruída",canvases.panoramic]
      ].map(([id,label,ref])=><article className={"viewer2-pane "+id} key={id}>
        <div className="viewer2-pane-head"><strong>{label}</strong><button onClick={()=>resetPlane(id)}>1:1</button></div>
        {(()=>{const pc=planeControl(id);return <div className="viewer2-slice-control"><span>{pc.label}</span><input aria-label={"Navegação "+label} type="range" min={pc.min} max={pc.max} step="1" value={pc.value} onChange={e=>pc.set(e.target.value)}/></div>})()}
        <div className="viewer2-canvas-wrap"><canvas className={tool==="navigate"?"crosshair-cursor":""} ref={ref} onWheel={e=>onWheel(id,e)} onPointerDown={e=>onPointerDown(id,e)} onPointerMove={e=>onPointerMove(id,e)} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}/></div>
      </article>)}
      <aside className="viewer2-side">
        <section>
          <p className="eyebrow">CURVA DA ARCADA</p><strong>Sempre ativa • ajuste manual</strong>
          <input type="range" min="0" max={Math.max(0,curve.length-1)} value={curveIndex} onChange={e=>setCurveIndex(Number(e.target.value))}/>
          <small>Corte tangencial {curveIndex+1}/{curve.length}. A curva inicial ainda é uma proposta geométrica, não uma segmentação automática da arcada. Ajuste os pontos no axial antes de usar os tangenciais.</small>
          <button className="viewer2-small" onClick={resetArch}>Restaurar curva inicial</button>
        </section>
        <section className="viewer2-export">
          <p className="eyebrow">SÉRIE DE CORTES</p>
          <strong>Do ponto selecionado para frente</strong>
          <p className="export-range">Início: corte {curveIndex+1} • até {Math.min(exportCount,Math.max(0,curve.length-curveIndex))} corte(s)</p>
          <div className="cut-counts" role="group" aria-label="Quantidade de cortes">
            {[10,15,20,30,40].map(n=><button type="button" key={n} className={exportCount===n?"active":""} onClick={()=>setExportCount(n)}>{n}</button>)}
          </div>
          <button type="button" className="viewer2-export-btn" disabled={exportBusy} onClick={exportTangentialPdf}>{exportBusy?"Gerando PDF…":"Gerar PDF"}</button>
          <small>O PDF é montado com 4 cortes por página para leitura digital e impressão mais econômica. Máximo de 40 cortes, sem voltar ao início da arcada.</small>
          {exportMessage&&<div className="export-message">{exportMessage}</div>}
        </section>
        <section>
          <p className="eyebrow red">NERVO / FORAME</p><strong>Traçado em vermelho</strong>
          <p>{nervePoints.length} ponto(s) do canal • {foramina.length} forame(s)</p>
          <small>Use “Nervo” no corte tangencial em cortes sucessivos. Cada marcação pode ser apagada individualmente. Não há detecção automática nesta versão.</small>
          {nervePoints.length>0&&<div className="nerve-point-list">
            {nervePoints.map((n,i)=><div key={n.id||("n-"+i)}><span>N{i+1} • corte {n.curveIndex+1}</span><button aria-label={"Excluir ponto do nervo "+(i+1)} onClick={()=>setNervePoints(ns=>ns.filter((_,idx)=>idx!==i))}>×</button></div>)}
          </div>}
          {foramina.length>0&&<div className="nerve-point-list foramen-list">
            {foramina.map((n,i)=><div key={n.id||("f-"+i)}><span>Forame {i+1} • corte {n.curveIndex+1}</span><button aria-label={"Excluir forame "+(i+1)} onClick={()=>setForamina(fs=>fs.filter((_,idx)=>idx!==i))}>×</button></div>)}
          </div>}
          {(nervePoints.length>0||foramina.length>0)&&<div className="nerve-actions">
            {nervePoints.length>0&&<button className="viewer2-small" onClick={undoLastNerve}>Desfazer último nervo</button>}
            {foramina.length>0&&<button className="viewer2-small" onClick={undoLastForamen}>Desfazer último forame</button>}
            <button className="viewer2-small danger" onClick={()=>{setNervePoints([]);setForamina([])}}>Limpar tudo</button>
          </div>}
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
  </main>;
}
