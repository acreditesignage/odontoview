import React,{useEffect,useMemo,useRef,useState} from "react";

const DOC_TEMPLATE_PRESETS={
  PERIAPICAL_14_BW_4:{
    label:"Série completa · 14 periapicais + 4 bite-wings",
    groups:[
      {id:"maxilla",label:"MAXILA",hint:"7 posições periapicais",slots:[
        {id:"max-1",label:"Molares D"},{id:"max-2",label:"Pré-molares D"},{id:"max-3",label:"Canino D"},
        {id:"max-4",label:"Incisivos"},{id:"max-5",label:"Canino E"},{id:"max-6",label:"Pré-molares E"},{id:"max-7",label:"Molares E"}
      ]},
      {id:"bitewing",label:"BITE-WINGS",hint:"4 interproximais",compact:true,slots:[
        {id:"bw-1",label:"Molar D"},{id:"bw-2",label:"Pré-molar D"},{id:"bw-3",label:"Pré-molar E"},{id:"bw-4",label:"Molar E"}
      ]},
      {id:"mandible",label:"MANDÍBULA",hint:"7 posições periapicais",slots:[
        {id:"mand-1",label:"Molares D"},{id:"mand-2",label:"Pré-molares D"},{id:"mand-3",label:"Canino D"},
        {id:"mand-4",label:"Incisivos"},{id:"mand-5",label:"Canino E"},{id:"mand-6",label:"Pré-molares E"},{id:"mand-7",label:"Molares E"}
      ]}
    ]
  },
  PERIAPICAL_14:{
    label:"Levantamento periapical · 14 posições",
    groups:[
      {id:"maxilla",label:"MAXILA",hint:"7 posições periapicais",slots:[
        {id:"max-1",label:"Molares D"},{id:"max-2",label:"Pré-molares D"},{id:"max-3",label:"Canino D"},
        {id:"max-4",label:"Incisivos"},{id:"max-5",label:"Canino E"},{id:"max-6",label:"Pré-molares E"},{id:"max-7",label:"Molares E"}
      ]},
      {id:"mandible",label:"MANDÍBULA",hint:"7 posições periapicais",slots:[
        {id:"mand-1",label:"Molares D"},{id:"mand-2",label:"Pré-molares D"},{id:"mand-3",label:"Canino D"},
        {id:"mand-4",label:"Incisivos"},{id:"mand-5",label:"Canino E"},{id:"mand-6",label:"Pré-molares E"},{id:"mand-7",label:"Molares E"}
      ]}
    ]
  }
};

function openBlobFile(blob,fileName="exame"){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.target="_blank";a.rel="noopener noreferrer";a.download=fileName;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

function extractSequenceNumber(fileName){
  const base=String(fileName||"").replace(/\.[^.]+$/,"");
  const tokens=[...base.matchAll(/(?:^|[\s._-])(\d{1,3})(?=$|[\s._-])/g)]
    .map(match=>Number(match[1]))
    .filter(value=>Number.isInteger(value)&&value>=0&&value<=999);
  if(tokens.length)return tokens[tokens.length-1];
  const trailing=base.match(/(\d{1,3})$/);
  return trailing?Number(trailing[1]):null;
}
function sequenceBadge(entry){
  return Number.isInteger(entry?.sequence)?"#"+String(entry.sequence).padStart(2,"0"):String((entry?.index||0)+1).padStart(2,"0");
}

function loadCanvasImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error("Não foi possível carregar uma das radiografias."));
    img.src=src;
  });
}
function drawContainedImage(ctx,img,x,y,w,h){
  const scale=Math.min(w/img.width,h/img.height);
  const dw=img.width*scale,dh=img.height*scale;
  const dx=x+(w-dw)/2,dy=y+(h-dh)/2;
  ctx.drawImage(img,dx,dy,dw,dh);
}
function roundedRectPath(ctx,x,y,w,h,r){
  const radius=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+radius,y);
  ctx.arcTo(x+w,y,x+w,y+h,radius);
  ctx.arcTo(x+w,y+h,x,y+h,radius);
  ctx.arcTo(x,y+h,x,y,radius);
  ctx.arcTo(x,y,x+w,y,radius);
  ctx.closePath();
}
function safeTemplateFileName(value){
  const base=String(value||"paciente").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/gi,"-").replace(/^-+|-+$/g,"").toLowerCase();
  return base||"paciente";
}

function isFdiCode(value){
  if(!Number.isInteger(value))return false;
  const quadrant=Math.floor(value/10),tooth=value%10;
  return quadrant>=1&&quadrant<=4&&tooth>=1&&tooth<=8;
}
function isBitewingCode(value){return Number.isInteger(value)&&value>=1&&value<=4}
const NUMBERED_18_SLOT_BY_CODE={
  17:"max-1",14:"max-2",13:"max-3",21:"max-4",23:"max-5",26:"max-6",28:"max-7",
  1:"bw-1",2:"bw-2",3:"bw-3",4:"bw-4",
  47:"mand-1",44:"mand-2",43:"mand-3",32:"mand-4",33:"mand-5",36:"mand-6",38:"mand-7"
};
function exactTemplateSlot(value,templateId){
  const slot=NUMBERED_18_SLOT_BY_CODE[value]||null;
  if(!slot)return null;
  if(templateId==="PERIAPICAL_14"&&slot.startsWith("bw-"))return null;
  return slot;
}
function fdiArc(value){
  if(!isFdiCode(value))return null;
  const quadrant=Math.floor(value/10);
  return quadrant<=2?"maxilla":"mandible";
}
function fdiAnatomicPosition(value){
  if(!isFdiCode(value))return null;
  const quadrant=Math.floor(value/10),tooth=value%10;
  if(quadrant===1||quadrant===4)return 8-tooth;
  return 7+tooth;
}
function mapCandidatesToSlots(candidates,slotIds){
  const next={};
  if(!slotIds.length||!candidates.length)return next;
  const sorted=[...candidates].sort((a,b)=>fdiAnatomicPosition(a.sequence)-fdiAnatomicPosition(b.sequence)||a.index-b.index);
  if(sorted.length===slotIds.length){
    sorted.forEach((entry,index)=>{next[slotIds[index]]=entry.key});
    return next;
  }
  const available=new Set(slotIds.map((_,index)=>index));
  for(const entry of sorted){
    const pos=fdiAnatomicPosition(entry.sequence);
    const ideal=Math.round((pos/15)*Math.max(0,slotIds.length-1));
    const target=[...available].sort((a,b)=>Math.abs(a-ideal)-Math.abs(b-ideal)||a-b)[0];
    if(target===undefined)break;
    next[slotIds[target]]=entry.key;
    available.delete(target);
  }
  return next;
}

export default function DocumentationWorkspace({gallery,setGallery,onClose,onDeleteFile,onSaveLayout}){
 const [mode,setMode]=useState("overview");
 const [brightness,setBrightness]=useState(100);
 const [contrast,setContrast]=useState(100);
 const [zoom,setZoom]=useState(1);
 const [pan,setPan]=useState({x:0,y:0});
 const [busy,setBusy]=useState("");
 const [templateId,setTemplateId]=useState("PERIAPICAL_14_BW_4");
 const [templateMap,setTemplateMap]=useState({});
 const [complementaryTypes,setComplementaryTypes]=useState({});
 const [templateDirty,setTemplateDirty]=useState(false);
 const [templateState,setTemplateState]=useState("");
 const dragRef=useRef(null);
 const collator=useMemo(()=>new Intl.Collator("pt-BR",{numeric:true,sensitivity:"base"}),[]);
 const entries=useMemo(()=>((gallery?.items||[]).map((item,index)=>({
   item,index,key:item.id||("index-"+index),sequence:extractSequenceNumber(item.fileName)
 })).sort((a,b)=>{
   const aHas=Number.isInteger(a.sequence),bHas=Number.isInteger(b.sequence);
   if(aHas&&bHas&&a.sequence!==b.sequence)return a.sequence-b.sequence;
   if(aHas!==bHas)return aHas?-1:1;
   return collator.compare(a.item.fileName||"",b.item.fileName||"")||a.index-b.index;
 })),[gallery?.items,collator]);
 const imageEntries=useMemo(()=>entries.filter(entry=>entry.item.previewKind==="image"),[entries]);
 const sequenceInfo=useMemo(()=>{
   const numbers=imageEntries.map(entry=>entry.sequence).filter(Number.isInteger);
   const unique=new Set(numbers);
   const duplicates=numbers.length-unique.size;
   const detected=numbers.length,total=imageEntries.length;
   const exact=imageEntries.filter(entry=>exactTemplateSlot(entry.sequence,"PERIAPICAL_14_BW_4")).length;
   const maxilla=imageEntries.filter(entry=>String(exactTemplateSlot(entry.sequence,"PERIAPICAL_14_BW_4")||"").startsWith("max-")).length;
   const mandible=imageEntries.filter(entry=>String(exactTemplateSlot(entry.sequence,"PERIAPICAL_14_BW_4")||"").startsWith("mand-")).length;
   const bitewings=imageEntries.filter(entry=>String(exactTemplateSlot(entry.sequence,"PERIAPICAL_14_BW_4")||"").startsWith("bw-")).length;
   const recognized=exact;
   const reliable=recognized>=14&&maxilla>=6&&mandible>=6&&duplicates===0;
   return {detected,total,duplicates,reliable,maxilla,mandible,bitewings,recognized,review:Math.max(0,total-recognized)};
 },[imageEntries]);
 const itemByKey=useMemo(()=>new Map(entries.map(entry=>[entry.key,entry])),[entries]);
 const active=gallery?.items?.[gallery.activeIndex]||null;
 const isImage=active?.previewKind==="image";
 const canDelete=Boolean(gallery?.study?.canDelete);
 const canEditLayout=Boolean(gallery?.study?.canEditLayout&&onSaveLayout);
 const preset=DOC_TEMPLATE_PRESETS[templateId]||DOC_TEMPLATE_PRESETS.PERIAPICAL_14_BW_4;
 const slotIds=preset.groups.flatMap(group=>group.slots.map(slot=>slot.id));
 const assignedKeys=new Set(slotIds.map(id=>templateMap[id]).filter(key=>key&&itemByKey.has(key)));
 const unassigned=imageEntries.filter(entry=>!assignedKeys.has(entry.key));
 const placedCount=assignedKeys.size;
 const templateComplete=placedCount===slotIds.length;
 const complementaryGroups=useMemo(()=>{
   const typeFor=entry=>complementaryTypes[entry.key]||"UNCLASSIFIED";
   return [
     {id:"BOARD",label:"Prancha / montagem",hint:"Composição geral da documentação",entries:unassigned.filter(entry=>typeFor(entry)==="BOARD")},
     {id:"RADIOGRAPH",label:"Radiografias adicionais",hint:"Imagens clínicas fora do template principal",entries:unassigned.filter(entry=>typeFor(entry)==="RADIOGRAPH")},
     {id:"OTHER",label:"Outros arquivos",hint:"Complementos que não se encaixam nas categorias acima",entries:unassigned.filter(entry=>typeFor(entry)==="OTHER")},
     {id:"UNCLASSIFIED",label:"A classificar",hint:"Defina o tipo para deixar a entrega organizada",entries:unassigned.filter(entry=>typeFor(entry)==="UNCLASSIFIED")}
   ].filter(group=>group.entries.length);
 },[unassigned,complementaryTypes]);
 const hasSavedLayout=Boolean(gallery?.study?.documentationLayout);

 function autoMapFor(id=templateId){
   const target=DOC_TEMPLATE_PRESETS[id]||DOC_TEMPLATE_PRESETS.PERIAPICAL_14_BW_4;
   const next={};
   for(const entry of imageEntries){
     const slot=exactTemplateSlot(entry.sequence,id);
     if(slot&&!next[slot])next[slot]=entry.key;
   }
   const expected=id==="PERIAPICAL_14"?14:18;
   if(Object.keys(next).length>=Math.min(10,expected))return next;
   const maxSlots=target.groups.find(group=>group.id==="maxilla")?.slots.map(slot=>slot.id)||[];
   const mandSlots=target.groups.find(group=>group.id==="mandible")?.slots.map(slot=>slot.id)||[];
   const bwSlots=target.groups.find(group=>group.id==="bitewing")?.slots.map(slot=>slot.id)||[];
   Object.assign(next,mapCandidatesToSlots(imageEntries.filter(entry=>fdiArc(entry.sequence)==="maxilla"),maxSlots));
   Object.assign(next,mapCandidatesToSlots(imageEntries.filter(entry=>fdiArc(entry.sequence)==="mandible"),mandSlots));
   imageEntries.filter(entry=>isBitewingCode(entry.sequence)).sort((a,b)=>a.sequence-b.sequence||a.index-b.index).slice(0,bwSlots.length)
     .forEach((entry,index)=>{next[bwSlots[index]]=entry.key});
   if(!Object.keys(next).length){
     const ids=target.groups.flatMap(group=>group.slots.map(slot=>slot.id));
     imageEntries.slice(0,ids.length).forEach((entry,index)=>{next[ids[index]]=entry.key});
   }
   return next;
 }
 function resetView(){
   setBrightness(100);setContrast(100);setZoom(1);setPan({x:0,y:0});dragRef.current=null;
 }
 useEffect(()=>{resetView()},[gallery?.activeIndex,gallery?.study?.id]);
 useEffect(()=>{
   const saved=gallery?.study?.documentationLayout;
   const nextTemplate=DOC_TEMPLATE_PRESETS[saved?.template]?saved.template:"PERIAPICAL_14_BW_4";
   setMode("overview");
   setTemplateId(nextTemplate);
   if(saved?.slots&&typeof saved.slots==="object"){
     setTemplateMap(saved.slots);
     setComplementaryTypes(saved?.complementaryTypes&&typeof saved.complementaryTypes==="object"?saved.complementaryTypes:{});
     setTemplateDirty(false);
     setTemplateState("saved");
   }else{
     setTemplateMap(autoMapFor(nextTemplate));
     setComplementaryTypes({});
     setTemplateDirty(Boolean(gallery?.study?.canEditLayout&&imageEntries.length));
     setTemplateState("auto");
   }
 },[gallery?.study?.id]);

 function setActive(index){setGallery(prev=>prev?({...prev,activeIndex:index}):prev)}
 function openInViewer(entry){setActive(entry.index);setMode("viewer")}
 function onPointerDown(e){
   if(!isImage)return;
   e.currentTarget.setPointerCapture?.(e.pointerId);
   dragRef.current={x:e.clientX,y:e.clientY,panX:pan.x,panY:pan.y};
 }
 function onPointerMove(e){
   if(!dragRef.current||!isImage)return;
   setPan({x:dragRef.current.panX+(e.clientX-dragRef.current.x),y:dragRef.current.panY+(e.clientY-dragRef.current.y)});
 }
 function stopDrag(){dragRef.current=null}
 function closeRequested(){
   if(mode==="viewer"){setMode("overview");return}
   onClose();
 }
 function assignToSlot(slotId,key){
   if(!canEditLayout||!key)return;
   setTemplateMap(prev=>{
     const next={...prev};
     for(const id of Object.keys(next))if(next[id]===key)delete next[id];
     next[slotId]=key;
     return next;
   });
   setTemplateDirty(true);setTemplateState("editing");
 }
 function removeFromTemplate(key){
   if(!canEditLayout||!key)return;
   setTemplateMap(prev=>{
     const next={...prev};
     for(const id of Object.keys(next))if(next[id]===key)delete next[id];
     return next;
   });
   setTemplateDirty(true);setTemplateState("editing");
 }
 function setComplementaryType(key,type){
   if(!canEditLayout||!key)return;
   setComplementaryTypes(prev=>{
     const next={...prev};
     if(!type||type==="UNCLASSIFIED")delete next[key];
     else next[key]=type;
     return next;
   });
   setTemplateDirty(true);setTemplateState("editing");
 }
 function organizeByNumber(){setTemplateMap(autoMapFor(templateId));setTemplateDirty(true);setTemplateState("auto")}
 function clearTemplate(){setTemplateMap({});setTemplateDirty(true);setTemplateState("editing")}
 async function downloadTemplateBoard(){
   if(!templateComplete){
     alert("Complete as posições do template antes de gerar a prancha.");
     return;
   }
   setBusy("download");
   try{
     const width=3200,height=2200;
     const canvas=document.createElement("canvas");
     canvas.width=width;canvas.height=height;
     const ctx=canvas.getContext("2d");
     ctx.fillStyle="#050b10";ctx.fillRect(0,0,width,height);

     const patientName=String(gallery?.patient?.name||"Paciente").toUpperCase();
     const examName=String(gallery?.examType?.name||"Documentação radiográfica");
     const rawDate=gallery?.study?.completedAt||gallery?.study?.createdAt||null;
     const examDate=rawDate?new Date(rawDate).toLocaleDateString("pt-BR"):"";
     const birthDate=gallery?.patient?.birthDate?new Date(gallery.patient.birthDate+"T12:00:00").toLocaleDateString("pt-BR"):"";

     ctx.fillStyle="#f4f9fc";
     ctx.font="700 34px Arial, sans-serif";
     ctx.fillText("DOCUMENTAÇÃO RADIOGRÁFICA",180,92);
     ctx.font="700 52px Arial, sans-serif";
     ctx.fillText(patientName,180,160);
     ctx.font="400 28px Arial, sans-serif";
     ctx.fillStyle="#a9bfce";
     const details=[examName,examDate&&("Exame: "+examDate),birthDate&&("Nascimento: "+birthDate)].filter(Boolean).join("   •   ");
     ctx.fillText(details,180,212);

     ctx.textAlign="right";
     ctx.fillStyle="#71d7f6";
     ctx.font="700 54px Arial, sans-serif";
     ctx.fillText("OdontoView",3020,130);
     ctx.fillStyle="#829aaa";
     ctx.font="600 20px Arial, sans-serif";
     ctx.fillText("IMAGEM ODONTOLÓGICA SEM LIMITES",3020,171);
     ctx.textAlign="left";

     async function drawGroup(groupId,title,y,imageH,columns){
       const group=preset.groups.find(item=>item.id===groupId);
       if(!group)return;
       const margin=180,gap=28;
       const totalW=width-(margin*2);
       const cellW=(totalW-gap*(columns-1))/columns;
       ctx.textAlign="center";
       ctx.fillStyle="#6fd6f7";
       ctx.font="700 22px Arial, sans-serif";
       ctx.fillText(title,width/2,y-34);
       for(let i=0;i<group.slots.length;i++){
         const slot=group.slots[i];
         const key=templateMap[slot.id];
         const entry=key?itemByKey.get(key):null;
         if(!entry)continue;
         const img=await loadCanvasImage(entry.item.url);
         const x=margin+i*(cellW+gap);
         roundedRectPath(ctx,x,y,cellW,imageH,24);
         ctx.fillStyle="#09151e";ctx.fill();
         ctx.save();
         roundedRectPath(ctx,x+5,y+5,cellW-10,imageH-52,20);
         ctx.clip();
         drawContainedImage(ctx,img,x+8,y+8,cellW-16,imageH-58);
         ctx.restore();
         ctx.fillStyle="#dbe8ef";
         ctx.font="600 18px Arial, sans-serif";
         ctx.fillText(slot.label,x+cellW/2,y+imageH-18);
       }
       ctx.textAlign="left";
     }

     await drawGroup("maxilla","MAXILA",330,430,7);
     await drawGroup("mandible","MANDÍBULA",895,430,7);

     const bwGroup=preset.groups.find(item=>item.id==="bitewing");
     if(bwGroup){
       const gap=34,cellW=620,imageH=385;
       const total=cellW*bwGroup.slots.length+gap*(bwGroup.slots.length-1);
       const startX=(width-total)/2;
       ctx.textAlign="center";
       ctx.fillStyle="#6fd6f7";
       ctx.font="700 22px Arial, sans-serif";
       ctx.fillText("BITE-WINGS",width/2,1430);
       for(let i=0;i<bwGroup.slots.length;i++){
         const slot=bwGroup.slots[i];
         const key=templateMap[slot.id];
         const entry=key?itemByKey.get(key):null;
         if(!entry)continue;
         const img=await loadCanvasImage(entry.item.url);
         const x=startX+i*(cellW+gap),y=1470;
         roundedRectPath(ctx,x,y,cellW,imageH,24);
         ctx.fillStyle="#09151e";ctx.fill();
         ctx.save();
         roundedRectPath(ctx,x+5,y+5,cellW-10,imageH-50,20);
         ctx.clip();
         drawContainedImage(ctx,img,x+8,y+8,cellW-16,imageH-56);
         ctx.restore();
         ctx.fillStyle="#dbe8ef";
         ctx.font="600 18px Arial, sans-serif";
         ctx.fillText(slot.label,x+cellW/2,y+imageH-17);
       }
       ctx.textAlign="left";
     }

     ctx.strokeStyle="#163246";ctx.lineWidth=2;
     ctx.beginPath();ctx.moveTo(180,2050);ctx.lineTo(3020,2050);ctx.stroke();
     ctx.fillStyle="#718c9e";ctx.font="500 18px Arial, sans-serif";
     ctx.fillText("Template gerado pelo OdontoView",180,2094);
     ctx.textAlign="right";
     ctx.fillText("18 posições • 14 periapicais + 4 bite-wings",3020,2094);
     ctx.textAlign="left";

     const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("Falha ao gerar a imagem.")),"image/jpeg",0.96));
     const url=URL.createObjectURL(blob);
     const a=document.createElement("a");
     a.href=url;
     a.download=safeTemplateFileName(gallery?.patient?.name)+"-template-radiografico-odontoview.jpg";
     document.body.appendChild(a);a.click();a.remove();
     setTimeout(()=>URL.revokeObjectURL(url),60000);
   }catch(e){
     alert(e.message||"Não foi possível gerar o template.");
   }finally{
     setBusy("");
   }
 }

 async function saveTemplate(){
   if(!canEditLayout||!onSaveLayout)return;
   const slots={};
   for(const id of slotIds)if(templateMap[id]&&itemByKey.has(templateMap[id]))slots[id]=templateMap[id];
   const savedComplementaryTypes={};
   for(const entry of unassigned){
     const type=complementaryTypes[entry.key];
     if(["BOARD","RADIOGRAPH","OTHER"].includes(type))savedComplementaryTypes[entry.key]=type;
   }
   setBusy("layout");
   try{
     const payload={version:1,template:templateId,slots,complementaryTypes:savedComplementaryTypes};
     const out=await onSaveLayout(payload);
     const layout=out?.layout||payload;
     setGallery(prev=>prev?({...prev,study:{...prev.study,documentationLayout:layout}}):prev);
     setTemplateMap(layout.slots||slots);setComplementaryTypes(layout.complementaryTypes||savedComplementaryTypes);setTemplateDirty(false);setTemplateState("saved");
   }catch(e){alert(e.message||"Não foi possível salvar a organização.")}finally{setBusy("")}
 }
 async function deleteSelected(){
   if(!active||!canDelete||!onDeleteFile)return;
   if((gallery.items?.length||0)<=1){alert("Esta é a última imagem. Para removê-la, exclua a documentação inteira.");return}
   if(!confirm("Excluir definitivamente esta imagem da documentação? Esta ação não pode ser desfeita."))return;
   setBusy("file");
   try{await onDeleteFile(active)}catch(e){alert(e.message||"Não foi possível excluir a imagem.")}finally{setBusy("")}
 }

 return <div className="documentation-gallery-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeRequested()}}>
   <section className={"documentation-gallery documentation-workspace mode-"+mode} role="dialog" aria-modal="true">
     <header className="documentation-gallery-head">
       <div><p className="eyebrow">DOCUMENTAÇÃO RADIOGRÁFICA</p><h2>{gallery.examType?.name||"Documentação"}</h2><p>{gallery.patient?.name||"Paciente"} • {gallery.items.length} arquivo(s)</p></div>
       <div className="documentation-gallery-head-actions">
         {mode==="viewer"&&canDelete&&isImage&&<button className="danger-quiet compact" disabled={!active||busy==="file"||gallery.items.length<=1} onClick={deleteSelected}>{busy==="file"?"Excluindo…":"Excluir radiografia"}</button>}
         <button className="ghost compact" onClick={closeRequested}>{mode==="viewer"?"Voltar às imagens":"Fechar"}</button>
       </div>
     </header>

     <div className="documentation-view-tabs">
       <div className="documentation-view-tabs-group" role="tablist" aria-label="Modo de visualização">
         <button className={mode==="overview"?"active":""} onClick={()=>setMode("overview")}>Visão geral</button>
         <button className={mode==="template"?"active":""} onClick={()=>setMode("template")}>Template</button>
         <button className={mode==="viewer"?"active":""} onClick={()=>setMode("viewer")}>Viewer</button>
       </div>
       <div className="documentation-view-status">
         {mode==="overview"&&<><span className="status-dot ok"/>Leitura rápida • {imageEntries.length} imagem(ns)</>}
         {mode==="template"&&<><span className={"status-dot "+(templateComplete?"ok":"warn")}/>{placedCount}/{slotIds.length} posições{unassigned.length?" · "+unassigned.length+(templateComplete?" complementares":" para revisar"):""}</>}
         {mode==="viewer"&&<><span className="status-dot ok"/>{gallery.activeIndex+1} de {gallery.items.length}</>}
       </div>
     </div>

     {mode==="overview"&&<div className="documentation-overview">
       <div className="documentation-overview-intro">
         <div><strong>Veja o conjunto antes de aprofundar.</strong><span>O OdontoView prioriza a numeração detectada no nome do arquivo e mantém os demais itens em ordem natural. Clique em qualquer radiografia para abrir o Viewer.</span></div>
         <span className={"documentation-order-chip "+(sequenceInfo.reliable?"is-ok":"is-warn")}>{sequenceInfo.recognized}/{sequenceInfo.total} DO TEMPLATE{sequenceInfo.review?" · "+sequenceInfo.review+(sequenceInfo.reliable?" COMPLEMENTARES":" REVISAR"):""}</span>
       </div>
       <div className="documentation-overview-grid">
         {entries.map(entry=><button type="button" key={entry.key} className="documentation-overview-card" onClick={()=>openInViewer(entry)}>
           <div className="documentation-overview-media">
             {entry.item.previewKind==="image"?<img src={entry.item.url} alt={entry.item.fileName}/>:entry.item.previewKind==="pdf"?<span className="documentation-file-badge">PDF</span>:<span className="documentation-file-badge">3D</span>}
           </div>
           <div className="documentation-overview-meta"><strong>{sequenceBadge(entry)}</strong><small title={entry.item.fileName}>{entry.item.fileName}</small><span>Examinar →</span></div>
         </button>)}
       </div>
     </div>}

     {mode==="template"&&<div className="documentation-template">
       <div className="documentation-template-toolbar">
         <div className="documentation-template-copy">
           <p className="eyebrow">ORGANIZAÇÃO ANATÔMICA</p>
           <strong>{hasSavedLayout&&!templateDirty?"Template salvo na nuvem":sequenceInfo.reliable?"Padrão numerado reconhecido • montagem determinística":"Classificação parcial • revisar posições"}</strong>
           <span>{sequenceInfo.reliable?"O OdontoView reconheceu o perfil de 18 posições e montou maxila, bite-wings e mandíbula pelos códigos do arquivo. Imagens extras permanecem separadas sem interferir no template.":"O OdontoView reconheceu parte da série. As imagens fora do perfil numerado permanecem em Não classificadas para revisão manual."}</span>
         </div>
         <div className="documentation-template-actions">
           <select value={templateId} disabled={!canEditLayout} onChange={e=>{const id=e.target.value;setTemplateId(id);setTemplateMap(autoMapFor(id));setTemplateDirty(true);setTemplateState("auto")}}>
             {Object.entries(DOC_TEMPLATE_PRESETS).map(([id,item])=><option key={id} value={id}>{item.label}</option>)}
           </select>
           {canEditLayout&&<button className="secondary compact" onClick={organizeByNumber}>Montar automaticamente</button>}
           <button className="primary compact" disabled={!templateComplete||busy==="download"} onClick={downloadTemplateBoard}>{busy==="download"?"Gerando…":"⬇ Baixar template JPG"}</button>
           {canEditLayout&&<button className="ghost compact" onClick={clearTemplate}>Limpar</button>}
         </div>
       </div>

       <div className="documentation-template-board">
         {preset.groups.map(group=><section className={"documentation-template-section "+(group.compact?"is-compact":"")} key={group.id}>
           <div className="documentation-template-section-title"><strong>{group.label}</strong><span>{group.hint}</span></div>
           <div className="documentation-template-row">
             {group.slots.map(slot=>{
               const key=templateMap[slot.id],entry=key?itemByKey.get(key):null;
               return <div key={slot.id} className={"documentation-template-slot "+(entry?"filled":"empty")} onDragOver={e=>{if(canEditLayout)e.preventDefault()}} onDrop={e=>{if(!canEditLayout)return;e.preventDefault();assignToSlot(slot.id,e.dataTransfer.getData("text/odontoview-file"))}}>
                 {entry?<button type="button" className="documentation-template-image" draggable={canEditLayout} onDragStart={e=>{if(!canEditLayout)return;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/odontoview-file",entry.key)}} onClick={()=>openInViewer(entry)}>
                   <img src={entry.item.url} alt={entry.item.fileName}/><span>{sequenceBadge(entry)} · {slot.label}</span>
                 </button>:<div className="documentation-template-empty"><span>{slot.label}</span><small>{canEditLayout?"Arraste aqui":"Sem imagem"}</small></div>}
               </div>
             })}
           </div>
         </section>)}

         <section className="documentation-template-tray" onDragOver={e=>{if(canEditLayout)e.preventDefault()}} onDrop={e=>{if(!canEditLayout)return;e.preventDefault();removeFromTemplate(e.dataTransfer.getData("text/odontoview-file"))}}>
           <div className="documentation-template-tray-title"><div><strong>{templateComplete?"Imagens complementares":"Imagens para revisar"}</strong><span>{unassigned.length?(templateComplete?unassigned.length+" arquivo(s) fora do template principal — continuam disponíveis no exame.":unassigned.length+" imagem(ns) aguardando posição."):"Todas as imagens utilizadas no template."}</span></div>{canEditLayout&&<small>{templateComplete?"Classifique os complementos ou arraste para substituir uma posição do template.":"Solte aqui para retirar uma imagem do template."}</small>}</div>
           {unassigned.length?(templateComplete?
             <div className="documentation-complement-groups">
               {complementaryGroups.map(group=><section className={"documentation-complement-group type-"+group.id.toLowerCase()} key={group.id}>
                 <div className="documentation-complement-group-title"><div><strong>{group.label}</strong><span>{group.hint}</span></div><small>{group.entries.length}</small></div>
                 <div className="documentation-template-tray-grid">
                   {group.entries.map(entry=><div key={entry.key} className="documentation-template-tray-card documentation-complement-card" draggable={canEditLayout} onDragStart={e=>{if(!canEditLayout)return;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/odontoview-file",entry.key)}}>
                     <button type="button" className="documentation-complement-open" onClick={()=>openInViewer(entry)}><img src={entry.item.url} alt={entry.item.fileName}/></button>
                     <small title={entry.item.fileName}>{sequenceBadge(entry)} · {entry.item.fileName}</small>
                     {canEditLayout?<select aria-label={"Tipo de "+entry.item.fileName} value={complementaryTypes[entry.key]||"UNCLASSIFIED"} onChange={e=>setComplementaryType(entry.key,e.target.value)}>
                       <option value="UNCLASSIFIED">A classificar</option>
                       <option value="BOARD">Prancha / montagem</option>
                       <option value="RADIOGRAPH">Radiografia adicional</option>
                       <option value="OTHER">Outro</option>
                     </select>:<span className="documentation-complement-readonly">{group.label}</span>}
                   </div>)}
                 </div>
               </section>)}
             </div>:
             <div className="documentation-template-tray-grid">
               {unassigned.map(entry=><button type="button" key={entry.key} className="documentation-template-tray-card" draggable={canEditLayout} onDragStart={e=>{if(!canEditLayout)return;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/odontoview-file",entry.key)}} onClick={()=>openInViewer(entry)}>
                 <img src={entry.item.url} alt={entry.item.fileName}/><small title={entry.item.fileName}>{sequenceBadge(entry)} · {entry.item.fileName}</small>
               </button>)}
             </div>
           ):<div className="documentation-template-complete">✓ {templateComplete?"Template completo sem imagens complementares":"Organização completa"}</div>}
         </section>
       </div>

       <div className="documentation-template-savebar">
         <div><span className={"documentation-save-indicator "+(templateState==="saved"&&!templateDirty?"saved":"")}/><p>{canEditLayout?(templateDirty?"Há alterações ainda não salvas.":"Organização oficial salva na nuvem."):"Template oficial em modo de leitura."}</p></div>
         {canEditLayout&&<button className="primary compact" disabled={!templateDirty||busy==="layout"} onClick={saveTemplate}>{busy==="layout"?"Salvando…":templateDirty?"Salvar organização":"Salvo ✓"}</button>}
       </div>
     </div>}

     {mode==="viewer"&&<div className="documentation-viewer-pane">
       <div className="documentation-toolbar">
         <div className="documentation-tool"><span>Brilho</span><button disabled={!isImage} onClick={()=>setBrightness(v=>Math.max(40,v-10))}>−</button><strong>{brightness}%</strong><button disabled={!isImage} onClick={()=>setBrightness(v=>Math.min(220,v+10))}>+</button></div>
         <div className="documentation-tool"><span>Contraste</span><button disabled={!isImage} onClick={()=>setContrast(v=>Math.max(40,v-10))}>−</button><strong>{contrast}%</strong><button disabled={!isImage} onClick={()=>setContrast(v=>Math.min(220,v+10))}>+</button></div>
         <div className="documentation-tool"><span>Zoom</span><button disabled={!isImage} onClick={()=>setZoom(v=>Math.max(.5,Number((v-.15).toFixed(2))))}>−</button><strong>{Math.round(zoom*100)}%</strong><button disabled={!isImage} onClick={()=>setZoom(v=>Math.min(5,Number((v+.15).toFixed(2))))}>+</button></div>
         <button className="ghost compact" disabled={!isImage} onClick={resetView}>Restaurar</button>
       </div>
       <div className={"documentation-gallery-stage "+(isImage?"is-image":"")} onWheel={e=>{if(!isImage)return;e.preventDefault();setZoom(v=>Math.min(5,Math.max(.5,Number((v+(e.deltaY<0?.12:-.12)).toFixed(2)))))}} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
         {active?.previewKind==="image"?<img draggable="false" src={active.url} alt={active.fileName} style={{filter:"brightness("+brightness+"%) contrast("+contrast+"%)",transform:"translate("+pan.x+"px,"+pan.y+"px) scale("+zoom+")"}}/>:
          active?.previewKind==="pdf"?<iframe src={active.url} title={active.fileName}/>:
          active?<div className="documentation-gallery-file"><span>3D</span><strong>{active.fileName}</strong><button className="secondary compact" onClick={()=>openBlobFile(active.blob,active.fileName)}>Baixar / abrir modelo 3D</button></div>:
          <div className="empty">Nenhum arquivo.</div>}
       </div>
       <div className="documentation-gallery-grid">
         {gallery.items.map((item,index)=><button type="button" key={item.id||index} className={"documentation-thumb "+(index===gallery.activeIndex?"active":"")} onClick={()=>setActive(index)}>
           {item.previewKind==="image"?<img src={item.url} alt=""/>:<span>{item.previewKind==="pdf"?"PDF":"3D"}</span>}
           <small title={item.fileName}>{item.fileName}</small>
         </button>)}
       </div>
     </div>}
   </section>
 </div>;
}
