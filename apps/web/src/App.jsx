import React from "react";
import {useEffect,useMemo,useRef,useState} from "react";
import {Navigate,Route,Routes,useNavigate,useSearchParams} from "react-router-dom";
import {api,apiBinary,apiBlob} from "./api.js";
import {cachedStudyBlob,getStudyCacheStats,requestPersistentStudyStorage} from "./studyCache.js";
import {importExam,importSingleFileExam} from "./ingest.js";
import {examUploadPolicy,isDicomStudySource} from "./examUpload.js";
import {DEMO_EXAM,checkDemoExamAvailability,loadDemoExam} from "./demoExam.js";
import Viewer2 from "./Viewer2.jsx";
import {setViewerSession} from "./viewerSession.js";
import QRCode from "qrcode";

function routeForRole(role){return role==="UNIT_USER"?"/radiologia":"/dentista"}
function viewerRoute(origin,returnTo){const params=new URLSearchParams({from:origin,returnTo});return "/viewer2?"+params.toString()}
function logout(){localStorage.removeItem("odontoview_token");localStorage.removeItem("odontoview_role");location.href="/"}
function formatBytes(value){if(!value)return "0 MB";return (value/1024/1024).toFixed(value>10*1024*1024?1:2)+" MB"}
function studyCacheVersion(manifest){
  const study=manifest?.study||{};
  return [study.completedAt||"",study.totalBytes||"",study.fileCount||manifest?.files?.length||0].join(":");
}
async function studyBlobFromCloudOrCache({manifest,meta,path}){
  return cachedStudyBlob({
    studyId:manifest?.study?.id,
    fileMeta:meta,
    version:studyCacheVersion(manifest),
    fetcher:()=>apiBlob(path)
  });
}
function openBlobFile(blob,fileName="exame"){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.target="_blank";
  a.rel="noopener noreferrer";
  const type=String(blob?.type||"");
  if(!(type.startsWith("image/")||type==="application/pdf"))a.download=fileName;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function previewLocalExam(result){
  const file=result?.files?.[0];
  if(file)openBlobFile(file,file.name||result?.sourceName||"exame");
}
function LocalFileStrip({result}){
  const [items,setItems]=useState([]);
  useEffect(()=>{
    const files=Array.from(result?.files||[]);
    const metas=result?.fileItems||[];
    const next=files.map((file,index)=>{
      const meta=metas[index]||{};
      const contentType=meta.contentType||file.type||"application/octet-stream";
      return {
        index,
        name:file.name||meta.fileName||("Arquivo "+(index+1)),
        contentType,
        previewKind:meta.previewKind||(contentType.startsWith("image/")?"image":contentType==="application/pdf"?"pdf":"file"),
        url:contentType.startsWith("image/")?URL.createObjectURL(file):null
      };
    });
    setItems(next);
    return()=>next.forEach(item=>item.url&&URL.revokeObjectURL(item.url));
  },[result]);
  if(!items.length)return null;
  return <div className="local-document-strip">{items.map(item=><button type="button" key={item.index} className="local-document-thumb" onClick={()=>previewLocalExam({files:[result.files[item.index]]})}>
    {item.previewKind==="image"?<img src={item.url} alt={item.name}/>:<span className="local-document-fileicon">{item.previewKind==="pdf"?"PDF":"3D"}</span>}
    <small title={item.name}>{item.name}</small>
  </button>)}</div>;
}
function uploadMetaFromResult(result){
  const firstValid=result?.series?.find(s=>s.valid)||result?.series?.[0]||{};
  return {
    sourceType:result?.sourceType||"FILE",
    sourceName:result?.sourceName||null,
    modality:result?.modality||firstValid.modality||null,
    manufacturer:firstValid.manufacturer||null,
    model:firstValid.model||null,
    seriesCount:Number(result?.seriesCount)||0
  };
}
function HybridStorageBadge(){
 const [stats,setStats]=useState(null);
 useEffect(()=>{
   let alive=true;
   const refresh=()=>getStudyCacheStats().then(s=>{if(alive)setStats(s)}).catch(()=>{});
   refresh();
   window.addEventListener("odontoview-study-cache-change",refresh);
   return()=>{alive=false;window.removeEventListener("odontoview-study-cache-change",refresh)};
 },[]);
 return <span className="hybrid-storage-badge" title="Originais na nuvem. Exames já abertos podem permanecer em cache neste navegador para carregar mais rápido.">
   <span>☁ Nuvem</span><b>+</b><span>💻 Cache local</span>{stats?.bytes>0&&<small>{formatBytes(stats.bytes)}</small>}
 </span>;
}

function BrandLockup({role="NETWORK",light=false}){
 return <div className={"brand-lockup"+(light?" is-light":"")}>
   <div className="brand-word">Odonto<span>View</span></div>
   <div className="brand-sub">Marketplace + IA + Viewer + Laudo + Planejamento</div>
   <div className="brand-role">{role}</div>
 </div>
}

function Login({initialMode="login"}){
 const nav=useNavigate(),[q]=useSearchParams(),invite=q.get("invite"),[mode,setMode]=useState(initialMode),[err,setErr]=useState(""),[f,setF]=useState({name:"",email:"",password:"",phone:"",cro:"",uf:"RJ"});
 async function submit(e){
   e.preventDefault();setErr("");
   try{
     const d=await api(mode==="login"?"/api/auth/login":"/api/auth/register-dentist",{method:"POST",body:JSON.stringify(f)});
     localStorage.setItem("odontoview_token",d.token);
     localStorage.setItem("odontoview_role",d.user.role);
     if(invite&&d.user.role==="DENTIST"){
       try{await api("/api/dentist/invites/"+encodeURIComponent(invite)+"/claim",{method:"POST",body:"{}"});}catch(claimErr){setErr(claimErr.message);return}
     }
     nav(routeForRole(d.user.role));
   }catch(x){setErr(x.message)}
 }
 return <main className="page login-page"><section className="login-shell">
   <aside className="login-brand-panel">
     <BrandLockup role="ECOSSISTEMA ODONTOLÓGICO"/>
     <div className="login-message"><p className="eyebrow">DA IMAGEM À MELHOR DECISÃO</p><h1>Mais diagnóstico.<br/>Mais clareza.<br/><span>Mais sorrisos.</span></h1><p>Tecnologia que conecta dentistas, pacientes e radiologias em uma jornada única.</p></div>
     <div className="ecosystem-mini">
       <div><span>01</span><strong>Pedido</strong><small>Dentista solicita</small></div>
       <div><span>02</span><strong>Radiologia</strong><small>Paciente agenda</small></div>
       <div><span>03</span><strong>Viewer + IA</strong><small>Exame ganha contexto</small></div>
       <div><span>04</span><strong>Planejamento</strong><small>Decisão clínica</small></div>
     </div>
   </aside>
   <section className="card auth auth-premium">
   <BrandLockup role={mode==="login"?"ACESSO PROFISSIONAL":"CADASTRO DO DENTISTA"}/>
   <h1>{mode==="login"?"Bem-vindo.":"Crie seu acesso."}</h1>
   <p className="muted">{mode==="login"?"Dentista ou radiologia entram pelo mesmo OdontoView.":"Solicite exames, acompanhe o paciente e acesse o Viewer em um só lugar."}</p>
   <form className="stack" onSubmit={submit}>
     {mode==="register"&&<input placeholder="Nome" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/>}
     <input type="email" placeholder="Email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/>
     <input type="password" placeholder="Senha" value={f.password} onChange={e=>setF({...f,password:e.target.value})}/>
     {mode==="register"&&<input placeholder="Telefone / WhatsApp" value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/>}\n     {mode==="register"&&<div className="two"><input placeholder="CRO" value={f.cro} onChange={e=>setF({...f,cro:e.target.value})}/><input placeholder="UF" value={f.uf} onChange={e=>setF({...f,uf:e.target.value.toUpperCase()})}/></div>}
     {err&&<div className="error">{err}</div>}<button className="primary">{mode==="login"?"Entrar":"Criar conta"}</button>
   </form>
   <button className="link" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"Sou dentista e quero criar conta":"Já tenho conta"}</button>
   </section></section></main>
}

function DentistDashboard(){
 const nav=useNavigate(),[q]=useSearchParams();
 const requestedTab=q.get("tab");
 const initialTab=["home","new","new-patient","patients","exams","import"].includes(requestedTab)?requestedTab:"home";
 const [data,setData]=useState(null),[types,setTypes]=useState([]),[tab,setTab]=useState(initialTab),[err,setErr]=useState(""),[busy,setBusy]=useState(false),[openingStudy,setOpeningStudy]=useState("");
 const [patientMode,setPatientMode]=useState("existing"),[selectedPatient,setSelectedPatient]=useState(""),[type,setType]=useState("");
 const [p,setP]=useState({name:"",birthDate:"",phone:"",email:""}),[out,setOut]=useState(null),[createdPatient,setCreatedPatient]=useState(null),[patientSaving,setPatientSaving]=useState(false),[orderQr,setOrderQr]=useState(""),[shareMessage,setShareMessage]=useState("");
 const dentistFileInput=useRef(null);
 const [dentistIngest,setDentistIngest]=useState(null),[dentistImportPatient,setDentistImportPatient]=useState(""),[dentistImportType,setDentistImportType]=useState("");
 const [demoAvailable,setDemoAvailable]=useState(null),[demoOpening,setDemoOpening]=useState(false),[demoProgress,setDemoProgress]=useState("");
 const [dentistDocumentation,setDentistDocumentation]=useState(null);

 async function load(){
   setErr("");
   try{
     const [dashboard,examTypes]=await Promise.all([api("/api/dentist/dashboard"),api("/api/catalog/exam-types")]);
     setData(dashboard);setTypes(examTypes);
     if(!type&&examTypes[0])setType(examTypes[0].id);
     if(!selectedPatient&&dashboard.patients[0])setSelectedPatient(dashboard.patients[0].id);
     if(!dentistImportPatient&&dashboard.patients[0])setDentistImportPatient(dashboard.patients[0].id);
     if(!dentistImportType&&examTypes[0])setDentistImportType(examTypes[0].id);
   }catch(e){setErr(e.message)}
 }
 useEffect(()=>{load()},[]);
 useEffect(()=>{
   let alive=true;
   checkDemoExamAvailability().then(ok=>{if(alive)setDemoAvailable(ok)}).catch(()=>{if(alive)setDemoAvailable(false)});
   return()=>{alive=false};
 },[]);
 useEffect(()=>{
   let alive=true;
   setOrderQr("");
   if(!out?.patientAccessUrl)return ()=>{alive=false};
   QRCode.toDataURL(out.patientAccessUrl,{width:240,margin:1,errorCorrectionLevel:"M"})
     .then(url=>{if(alive)setOrderQr(url)})
     .catch(()=>{if(alive)setOrderQr("")});
   return ()=>{alive=false};
 },[out?.patientAccessUrl]);

 async function saveStandalonePatient(e){
   e.preventDefault();
   setPatientSaving(true);setErr("");setCreatedPatient(null);
   try{
     const patient=await api("/api/patients",{method:"POST",body:JSON.stringify(p)});
     setCreatedPatient(patient);
     setSelectedPatient(patient.id);
     setDentistImportPatient(patient.id);
     setPatientMode("existing");
     setP({name:"",birthDate:"",phone:"",email:""});
     await load();
   }catch(e){setErr(e.message)}
   finally{setPatientSaving(false)}
 }

 async function shareOrderLink(){
   if(!out?.patientAccessUrl)return;
   setShareMessage("");
   const shareData={title:"Exame no OdontoView",text:"Acesse o OdontoView para escolher a radiologia e o horário do seu exame.",url:out.patientAccessUrl};
   try{
     if(navigator.share){
       await navigator.share(shareData);
       setShareMessage("Compartilhado ✓");
     }else{
       await navigator.clipboard.writeText(out.patientAccessUrl);
       setShareMessage("Link copiado ✓");
     }
   }catch(e){
     if(e?.name!=="AbortError")setShareMessage("Não foi possível compartilhar.");
   }
 }

 async function submitOrder(e){
   e.preventDefault();setBusy(true);setErr("");setOut(null);
   try{
     const patientId=selectedPatient;
     if(!patientId)throw new Error("Selecione um paciente cadastrado.");
     const order=await api("/api/orders",{method:"POST",body:JSON.stringify({patientId,examTypeId:type})});
     setOut(order);setP({name:"",birthDate:"",phone:"",email:""});setPatientMode("existing");
     await load();
   }catch(e){setErr(e.message)}finally{setBusy(false)}
 }
 async function handleDentistImportFiles(event){
   const files=Array.from(event.target.files||[]);
   if(!files.length)return;
   const examType=types.find(t=>t.id===dentistImportType)||null;
   const policy=examUploadPolicy(examType);
   setDentistIngest({status:"reading",progress:{phase:policy.kind==="dicom"?"start":"single"}});
   try{
     const result=policy.kind==="dicom"
       ?await importExam(files,{onProgress:progress=>setDentistIngest({status:"reading",progress})})
       :await importSingleFileExam(files,examType);
     setDentistIngest({status:"ready",result});
   }catch(e){setDentistIngest({status:"error",message:e.message||"Falha ao abrir exame."})}
 }
 async function sendDentistImport(){
   if(!dentistIngest?.result||!dentistImportPatient)return;
   const r=dentistIngest.result,meta=uploadMetaFromResult(r);
   try{
     setDentistIngest(prev=>({...prev,send:{status:"uploading",done:0,total:r.files.length}}));
     const created=await api("/api/dentist/patients/"+dentistImportPatient+"/studies",{method:"POST",body:JSON.stringify({
       examTypeId:dentistImportType||null,...meta
     })});
     let next=0,done=0;
     const worker=async()=>{
       while(true){
         const index=next++;
         if(index>=r.files.length)return;
         const file=r.files[index];
         const contentType=r.kind==="collection"?(r.fileItems?.[index]?.contentType||file.type||"application/octet-stream"):"application/dicom";
         await apiBinary("/api/dentist/studies/"+created.study.id+"/files/"+index,file,{
           "Content-Type":"application/octet-stream",
           "X-File-Name":encodeURIComponent(file.name||("arquivo-"+(index+1))),
           "X-File-Content-Type":contentType
         });
         done++;setDentistIngest(prev=>({...prev,send:{status:"uploading",done,total:r.files.length}}));
       }
     };
     await Promise.all(Array.from({length:Math.min(4,r.files.length)},()=>worker()));
     await api("/api/dentist/studies/"+created.study.id+"/complete",{method:"POST",body:"{}"});
     setDentistIngest(prev=>({...prev,send:{status:"done",done:r.files.length,total:r.files.length,studyId:created.study.id}}));
     await load();
   }catch(e){
     setDentistIngest(prev=>({...prev,send:{status:"error",done:prev?.send?.done||0,total:r.files.length,message:e.message||"Falha no envio."}}));
   }
 }

 async function openDemoExam(){
   if(demoOpening||demoAvailable===false)return;
   setDemoOpening(true);setErr("");setDemoProgress("Preparando demonstração…");
   try{
     const result=await loadDemoExam({
       onProgress:progress=>{
         if(progress.phase==="download")setDemoProgress(progress.label||"Baixando exame demo…");
         else if(progress.phase==="extract")setDemoProgress("Extraindo DICOM demo…");
         else if(progress.phase==="metadata")setDemoProgress(`Lendo DICOM • ${progress.current||0}/${progress.total||"?"}`);
       }
     });
     setViewerSession({
       result,
       isDemo:true,
       demo:{id:DEMO_EXAM.id,label:DEMO_EXAM.label},
       order:{
         patient:{id:"demo-patient",name:DEMO_EXAM.patientName},
         examType:{id:"demo-cbct",name:DEMO_EXAM.examType},
         unit:{name:"OdontoView Demo"}
       }
     });
     nav(viewerRoute("dentist","/dentista?tab=home")+"&demo=1");
   }catch(e){
     setErr(e.message||"Não foi possível abrir o exame de demonstração.");
   }finally{
     setDemoOpening(false);setDemoProgress("");
   }
 }

 function closeDentistDocumentation(){
   setDentistDocumentation(prev=>{
     prev?.items?.forEach(item=>item.url&&URL.revokeObjectURL(item.url));
     return null;
   });
 }
 async function openDentistDocumentation(manifest){
   const items=await Promise.all((manifest.files||[]).map(async meta=>{
     const blob=await studyBlobFromCloudOrCache({manifest,meta,path:"/api/dentist/studies/"+manifest.study.id+"/files/"+meta.id});
     const typed=new Blob([blob],{type:meta.contentType||blob.type||"application/octet-stream"});
     return {
       ...meta,blob:typed,contentType:typed.type||meta.contentType||"application/octet-stream",
       url:URL.createObjectURL(typed),
       previewKind:(typed.type||"").startsWith("image/")?"image":typed.type==="application/pdf"?"pdf":"file"
     };
   }));
   setDentistDocumentation({
     study:manifest.study,
     patient:manifest.order?.patient,
     examType:manifest.order?.examType,
     items,
     activeIndex:0
   });
 }
 async function openStudy(order){
   if(!order?.study?.id)return;
   void requestPersistentStudyStorage();
   setOpeningStudy(order.study.id);setErr("");
   try{
     const manifest=await api("/api/dentist/studies/"+order.study.id);
     if(!isDicomStudySource(manifest.study?.sourceType)){
       if(!manifest.files?.length)throw new Error("Arquivo do exame não encontrado.");
       await openDentistDocumentation(manifest);
       return;
     }
     const files=new Array(manifest.files.length);
     let cursor=0,done=0;
     const worker=async()=>{
       while(true){
         const i=cursor++;
         if(i>=manifest.files.length)return;
         const meta=manifest.files[i];
         const blob=await studyBlobFromCloudOrCache({manifest,meta,path:"/api/dentist/studies/"+manifest.study.id+"/files/"+meta.id});
         files[i]=new File([blob],meta.fileName||("dicom-"+String(i+1).padStart(4,"0")+".dcm"),{type:"application/dicom"});
         done++;
         setOpeningStudy(order.study.id+":"+done+"/"+manifest.files.length);
       }
     };
     await Promise.all(Array.from({length:Math.min(6,manifest.files.length)},()=>worker()));
     const result=await importExam(files);
     setViewerSession({result,order:{...order,patient:manifest.order.patient,examType:manifest.order.examType,unit:manifest.order.unit}});
     nav(viewerRoute("dentist","/dentista?tab="+tab));
   }catch(e){setErr(e.message||"Não foi possível abrir o exame.");}
   finally{setOpeningStudy("")}
 }
 const statusLabel=s=>STATUS[s]?.label||s;
 const goDentistTab=next=>{
   setTab(next);
   nav("/dentista?tab="+encodeURIComponent(next),{replace:true});
 };
 const startNewPatient=()=>{
   setCreatedPatient(null);
   setP({name:"",birthDate:"",phone:"",email:""});
   goDentistTab("new-patient");
 };
 const recentExams=[
   ...data?.orders?.filter(o=>o.study?.status==="READY").map(o=>({
     key:"network-"+o.study.id,
     source:"OdontoView",
     patient:o.patient?.name||"Paciente",
     exam:o.examType?.name||"Exame DICOM",
     detail:o.unit?.name||"Recebido da radiologia",
     studyId:o.study.id,
     open:()=>openStudy(o)
   }))||[],
   ...(data?.directStudies||[]).map(s=>({
     key:"local-"+s.id,
     source:"Importado",
     patient:s.patient?.name||"Paciente",
     exam:s.examType?.name||s.modality||"Exame DICOM",
     detail:(s.fileCount?String(s.fileCount)+" arquivo(s)":"Exame salvo por você"),
     studyId:s.id,
     open:()=>openStudy({study:s,patient:s.patient,examType:s.examType||{name:"Exame DICOM"},unit:null})
   }))
 ].slice(0,5);
 const selectedDentistImportType=types.find(t=>t.id===dentistImportType)||null;
 const dentistUploadPolicy=examUploadPolicy(selectedDentistImportType);
 return <main className="page dentist-dashboard"><section className="wide">
   <input className="hidden-file" ref={dentistFileInput} type="file" accept={dentistUploadPolicy.accept} multiple={dentistUploadPolicy.multiple} onChange={handleDentistImportFiles}/>
   {dentistDocumentation&&<div className="documentation-gallery-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeDentistDocumentation()}}>
     <section className="documentation-gallery" role="dialog" aria-modal="true">
       <header className="documentation-gallery-head">
         <div><p className="eyebrow">DOCUMENTAÇÃO / IMAGENS</p><h2>{dentistDocumentation.examType?.name||"Documentação"}</h2><p>{dentistDocumentation.patient?.name||"Paciente"} • {dentistDocumentation.items.length} arquivo(s)</p></div>
         <button className="ghost compact" onClick={closeDentistDocumentation}>Fechar</button>
       </header>
       <div className="documentation-gallery-stage">
         {(()=>{
           const item=dentistDocumentation.items[dentistDocumentation.activeIndex];
           if(!item)return <div className="empty">Nenhum arquivo.</div>;
           if(item.previewKind==="image")return <img src={item.url} alt={item.fileName}/>;
           if(item.previewKind==="pdf")return <iframe src={item.url} title={item.fileName}/>;
           return <div className="documentation-gallery-file"><span>3D</span><strong>{item.fileName}</strong><button className="secondary compact" onClick={()=>openBlobFile(item.blob,item.fileName)}>Baixar / abrir modelo 3D</button></div>;
         })()}
       </div>
       <div className="documentation-gallery-grid">
         {dentistDocumentation.items.map((item,index)=><button type="button" key={item.id||index} className={"documentation-thumb "+(index===dentistDocumentation.activeIndex?"active":"")} onClick={()=>setDentistDocumentation(prev=>({...prev,activeIndex:index}))}>
           {item.previewKind==="image"?<img src={item.url} alt=""/>:<span>{item.previewKind==="pdf"?"PDF":"3D"}</span>}
           <small title={item.fileName}>{item.fileName}</small>
         </button>)}
       </div>
     </section>
   </div>}
   <header className="topbar"><BrandLockup role="DENTISTA"/><div className="topbar-actions"><HybridStorageBadge/><a className="ghost compact" href="/cadastro-dentista" target="_blank" rel="noreferrer">Link de cadastro</a><button className="ghost" onClick={logout}>Sair</button></div></header>
   <div className="hero-row dentist-hero"><div><p className="eyebrow">ODONTOVIEW NETWORK</p><h1>{data?.dentist?.user?.name||"Seu painel clínico"}</h1><p className="muted">{data?.dentist?("CRO "+data.dentist.cro+"/"+data.dentist.uf+" • pacientes, pedidos e exames em um só lugar."):"Carregando perfil…"}</p></div><div className="hero-actions dentist-hero-actions"><button className="primary" onClick={startNewPatient}>＋ Novo paciente</button><button className="secondary" onClick={()=>goDentistTab("import")}>⬆ Importar exame</button></div></div>
   <nav className="workspace-tabs">
     <button className={tab==="home"?"active":""} onClick={()=>goDentistTab("home")}>Visão geral</button>
     <button className={tab==="new"?"active":""} onClick={()=>goDentistTab("new")}>Novo pedido</button>
     <button className={tab==="patients"?"active":""} onClick={()=>goDentistTab("patients")}>Pacientes</button>
     <button className={tab==="exams"?"active":""} onClick={()=>goDentistTab("exams")}>Meus exames</button>
     <button className={tab==="import"?"active":""} onClick={()=>goDentistTab("import")}>Importar exame</button>
   </nav>
   {err&&<div className="error">{err}</div>}
   {!data?<section className="card">Carregando painel…</section>:<>
     {tab==="home"&&<div className="dentist-home">
       <section className="dentist-home-actions" aria-label="Ações principais">
         <button type="button" className="dentist-action-card is-primary" onClick={startNewPatient}>
           <span className="dentist-action-icon">＋</span>
           <span className="dentist-action-copy"><strong>Novo paciente</strong><small>Cadastre e siga para pedido ou exame.</small></span>
           <span className="dentist-action-arrow">→</span>
         </button>
         <button type="button" className="dentist-action-card" onClick={()=>goDentistTab("import")}>
           <span className="dentist-action-icon">⬆</span>
           <span className="dentist-action-copy"><strong>Importar exame</strong><small>CBCT em DICOM; demais exames em documentação com múltiplos arquivos.</small></span>
           <span className="dentist-action-arrow">→</span>
         </button>
       </section>

       <section className="dentist-demo-card" aria-label="Demonstração do OdontoView">
         <div className="dentist-demo-visual" aria-hidden="true">
           <div className="dentist-demo-orbit dentist-demo-orbit-a"/>
           <div className="dentist-demo-orbit dentist-demo-orbit-b"/>
           <div className="dentist-demo-scan"/>
           <div className="dentist-demo-mark">3D</div>
         </div>
         <div className="dentist-demo-copy">
           <div className="dentist-demo-kicker"><span>✨ PACIENTE DEMO</span><b>CBCT</b></div>
           <h2>Clique e explore o mundo do OdontoView.</h2>
           <p>Abra um exame completo sem enviar nenhum arquivo. Explore MPR, reconstrução panorâmica, 3D, nervo, implantes, dentes e planejamento.</p>
           <div className="dentist-demo-features"><span>MPR</span><span>3D</span><span>Nervo</span><span>Implantes</span><span>FDI 11–48</span></div>
         </div>
         <div className="dentist-demo-action">
           <button type="button" className="primary dentist-demo-button" disabled={demoOpening||demoAvailable!==true} onClick={openDemoExam}>
             {demoOpening?(demoProgress||"Abrindo demo…"):demoAvailable===true?"Abrir paciente demo":demoAvailable===false?"Demo sendo preparado":"Verificando demo…"}
           </button>
           <small>{demoAvailable===true?"Ambiente de demonstração. Nada altera seus pacientes reais.":"O exame demo será ativado assim que o arquivo DICOM desidentificado for publicado."}</small>
         </div>
       </section>

       <section className="dentist-home-shortcuts" aria-label="Atalhos">
         <button type="button" className="dentist-shortcut-card" onClick={()=>goDentistTab("patients")}>
           <span>👥</span><div><strong>Meus pacientes</strong><small>{data.patients.length} cadastrado(s)</small></div><b>→</b>
         </button>
         <button type="button" className="dentist-shortcut-card" onClick={()=>goDentistTab("exams")}>
           <span>🩻</span><div><strong>Meus exames</strong><small>{recentExams.length} recente(s) disponível(is)</small></div><b>→</b>
         </button>
       </section>

       <section className="card dentist-recent-card">
         <div className="section-title dentist-recent-title"><div><p className="eyebrow">EXAMES RECENTES</p><h2>Continue de onde parou.</h2><p className="muted">Abra rapidamente os estudos mais recentes no Viewer.</p></div><button className="secondary compact" onClick={()=>goDentistTab("exams")}>Ver todos</button></div>
         {recentExams.length===0?<div className="dentist-home-empty"><strong>Nenhum exame disponível ainda.</strong><p>Cadastre um paciente e importe o primeiro exame para começar.</p><button className="primary compact" onClick={()=>goDentistTab("import")}>Importar primeiro exame</button></div>:
         <div className="dentist-recent-list">{recentExams.map(item=><article className="dentist-recent-row" key={item.key}>
           <div className="dentist-recent-main"><div className="dentist-recent-name"><strong title={item.patient}>{item.patient}</strong><span className={"source-badge "+(item.source==="OdontoView"?"odontoview":"radiology")}>{item.source}</span></div><small title={item.exam}>{item.exam}</small><small>{item.detail}</small></div>
           <button className="primary compact" disabled={openingStudy.startsWith(item.studyId)} onClick={item.open}>{openingStudy.startsWith(item.studyId)?("Abrindo "+(openingStudy.split(":")[1]||"…")):"Abrir Viewer"}</button>
         </article>)}</div>}
       </section>
     </div>}
     {tab==="new-patient"&&<section className="card dentist-patient-create-card">
       <div className="section-title"><div><p className="eyebrow">NOVO PACIENTE</p><h2>Cadastre sem criar pedido.</h2><p className="muted">Use este caminho quando o paciente já possui o exame ou quando você só quer adicioná-lo à sua base.</p></div></div>
       {!createdPatient?<form className="stack" onSubmit={saveStandalonePatient}>
         <input required autoFocus placeholder="Nome completo" value={p.name} onChange={e=>setP({...p,name:e.target.value})}/>
         <div className="two"><input type="date" value={p.birthDate} onChange={e=>setP({...p,birthDate:e.target.value})}/><input placeholder="Telefone / WhatsApp" value={p.phone} onChange={e=>setP({...p,phone:e.target.value})}/></div>
         <input type="email" placeholder="E-mail (opcional)" value={p.email} onChange={e=>setP({...p,email:e.target.value})}/>
         <button className="primary" disabled={patientSaving}>{patientSaving?"Salvando…":"Salvar paciente"}</button>
       </form>:<section className="patient-created-success">
         <div className="patient-created-check">✓</div>
         <div><p className="eyebrow">PACIENTE CADASTRADO</p><h3>{createdPatient.name}</h3><p className="muted">O paciente foi salvo. Agora escolha o que deseja fazer.</p></div>
         <div className="patient-next-actions">
           <button className="primary" onClick={()=>{setDentistImportPatient(createdPatient.id);goDentistTab("import")}}>⬆ Importar exame</button>
           <button className="secondary" onClick={()=>{setSelectedPatient(createdPatient.id);setOut(null);goDentistTab("new")}}>＋ Criar pedido de exame</button>
           <button className="ghost" onClick={()=>goDentistTab("patients")}>Concluir / Ver pacientes</button>
         </div>
       </section>}
     </section>}
     {tab==="new"&&<section className="card dentist-order-card">
       <div className="section-title"><div><p className="eyebrow">NOVO PEDIDO</p><h2>Solicite o exame em poucos passos.</h2></div></div>
       <form className="stack" onSubmit={submitOrder}>
         <label className="field-label"><span>Paciente</span><select value={selectedPatient} onChange={e=>setSelectedPatient(e.target.value)}><option value="">Selecione o paciente</option>{data.patients.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
         <label className="field-label"><span>Tipo de exame</span><select value={type} onChange={e=>setType(e.target.value)}>{types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
         <div className="order-form-foot"><button type="button" className="secondary" onClick={startNewPatient}>＋ Cadastrar outro paciente</button><button className="primary" disabled={busy||!selectedPatient}>{busy?"Criando…":"Criar pedido e gerar link"}</button></div>
       </form>
       {out&&<section className="success order-link-box order-share-box">
         <div className="order-share-head"><div><strong>Pedido criado ✓</strong><p>O paciente pode apontar a câmera para o QR Code ou usar o link para escolher a radiologia e o horário.</p></div></div>
         <div className="order-share-content">
           <div className="order-qr-wrap">{orderQr?<img src={orderQr} alt="QR Code do link seguro do paciente"/>:<div className="order-qr-loading">Gerando QR…</div>}</div>
           <div className="order-link-actions">
             <label><span>Link seguro do paciente</span><code>{out.patientAccessUrl}</code></label>
             <div className="order-share-actions">
               <button className="secondary" onClick={async()=>{await navigator.clipboard.writeText(out.patientAccessUrl);setShareMessage("Link copiado ✓")}}>Copiar link</button>
               <button className="primary" onClick={shareOrderLink}>Compartilhar</button>
             </div>
             {shareMessage&&<small className="share-feedback">{shareMessage}</small>}
           </div>
         </div>
       </section>}
     </section>}
     {tab==="import"&&<section className="card dentist-import-card">
       <div className="section-title"><div><p className="eyebrow">IMPORTAR EXAME</p><h2>Adicione o exame ao OdontoView.</h2><p className="muted">Tomografia CBCT usa DICOM. Os demais tipos podem reunir várias imagens, PDFs ou modelos 3D na mesma documentação.</p></div></div>
       {data.patients.length===0?<div className="empty"><strong>Cadastre um paciente primeiro.</strong><p>Depois você poderá associar qualquer exame ou documentação a ele.</p></div>:<>
         <div className="dentist-import-grid">
           <label><span>Paciente</span><select value={dentistImportPatient} onChange={e=>setDentistImportPatient(e.target.value)}>{data.patients.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
           <label><span>Tipo de exame</span><select value={dentistImportType} onChange={e=>{setDentistImportType(e.target.value);setDentistIngest(null)}}>{types.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
           <button className="primary" onClick={()=>{setDentistIngest(null);dentistFileInput.current?.click()}}>{dentistUploadPolicy.buttonLabel}</button>
         </div>
         <p className="muted upload-policy-note">{dentistUploadPolicy.help}</p>
         {dentistIngest&&<IngestResult state={dentistIngest} onClear={()=>setDentistIngest(null)} onOpenViewer={()=>{if(dentistIngest.result?.kind==="collection"){previewLocalExam(dentistIngest.result);return}setViewerSession({result:dentistIngest.result,order:{patient:data.patients.find(p=>p.id===dentistImportPatient),examType:types.find(t=>t.id===dentistImportType)||{name:"Tomografia CBCT"}}});nav(viewerRoute("dentist","/dentista?tab=import"))}} onSend={sendDentistImport} sendLabel="Salvar em Meus exames"/>}
       </>}
     </section>}
     {tab==="exams"&&<section className="card">
       <div className="section-title"><div><p className="eyebrow">MEUS EXAMES</p><h2>Exames recebidos.</h2><p className="muted">Estudos enviados pela radiologia ficam disponíveis aqui para abrir no Viewer.</p></div></div>
       {data.orders.filter(o=>o.study?.status==="READY").length===0&&(!data.directStudies||data.directStudies.length===0)?<div className="empty"><strong>Nenhum exame ainda.</strong><p>Você pode receber da radiologia ou importar seu próprio DICOM.</p></div>:
       <div className="patient-registry">{data.orders.filter(o=>o.study?.status==="READY").map(o=><div className="patient-registry-row is-network" key={o.study.id}>
         <div className="patient-registry-main"><div className="patient-name-line"><strong>{o.patient.name}</strong><span className="source-badge odontoview">Exame disponível</span></div><small>{o.examType.name}{o.unit?" • "+o.unit.name:""}</small><small>{o.study.fileCount} arquivo(s) • {formatBytes(o.study.totalBytes)}{o.study.manufacturer?" • "+o.study.manufacturer:""}</small></div>
         <button className="primary compact" disabled={openingStudy.startsWith(o.study.id)} onClick={()=>openStudy(o)}>{openingStudy.startsWith(o.study.id)?("Abrindo "+(openingStudy.split(":")[1]||"…")):"Abrir Viewer"}</button>
       </div>)}
       {(data.directStudies||[]).map(s=><div className="patient-registry-row is-local" key={s.id}>
         <div className="patient-registry-main"><div className="patient-name-line"><strong>{s.patient.name}</strong><span className="source-badge radiology">Importado por você</span></div><small>{s.examType?.name||s.modality||"Exame DICOM"}</small><small>{s.fileCount} arquivo(s) • {formatBytes(s.totalBytes)}</small></div>
         <button className="primary compact" disabled={openingStudy.startsWith(s.id)} onClick={()=>openStudy({study:s,patient:s.patient,examType:s.examType||{name:"Exame DICOM"},unit:null})}>{openingStudy.startsWith(s.id)?("Abrindo "+(openingStudy.split(":")[1]||"…")):"Abrir Viewer"}</button>
       </div>)}</div>}
     </section>}
     {tab==="patients"&&<section className="card">
       <div className="section-title"><div><p className="eyebrow">PACIENTES</p><h2>Sua base de pacientes.</h2></div><button className="primary compact" onClick={startNewPatient}>+ Cadastrar</button></div>
       {data.patients.length===0?<div className="empty">Nenhum paciente cadastrado.</div>:<div className="patient-registry">{data.patients.map(x=><div className="patient-registry-row" key={x.id}><div><strong>{x.name}</strong><small>{x.phone||"Sem telefone"}{x.birthDate?" • "+new Date(x.birthDate).toLocaleDateString("pt-BR"):""}</small></div><button className="secondary compact" onClick={()=>{setSelectedPatient(x.id);setPatientMode("existing");setOut(null);goDentistTab("new")}}>Criar pedido</button></div>)}</div>}
     </section>}
   </>}
 </section></main>
}


function localDateValue(date=new Date()){
 const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,"0"),d=String(date.getDate()).padStart(2,"0");
 return `${y}-${m}-${d}`;
}
function dayRange(value){
 const [y,m,d]=value.split("-").map(Number);
 const from=new Date(y,m-1,d,0,0,0,0),to=new Date(y,m-1,d+1,0,0,0,0);
 return {from:from.toISOString(),to:to.toISOString()};
}
const STATUS={
 AGENDADO:{label:"Agendado",tone:"blue"},
 PACIENTE_CHEGOU:{label:"Paciente chegou",tone:"orange"},
 EXAME_REALIZADO:{label:"Exame realizado",tone:"green"},
 IMAGENS_RECEBIDAS:{label:"Imagens recebidas",tone:"green"}
};

function IngestResult({state,onClear,onOpenViewer,onSend,sendLabel="Enviar exame ao dentista"}){
 if(!state)return null;
 if(state.status==="reading"){
   const p=state.progress||{};
   const label=p.phase==="metadata"?`Lendo metadados DICOM • ${p.current||0}/${p.total||"?"}`:p.phase==="single"?"Validando documentação…":"Abrindo arquivo…";
   return <div className="ingest-panel"><strong>OdontoView Ingest</strong><p className="muted">{label}</p><div className="ingest-bar"><span/></div></div>;
 }
 if(state.status==="error")return <div className="ingest-panel ingest-error"><strong>Não foi possível abrir este exame.</strong><p>{state.message}</p><button className="ghost compact" onClick={onClear}>Fechar</button></div>;
 if(state.status!=="ready")return null;
 const r=state.result,collection=r.kind==="collection",dicom=r.kind==="dicom"||isDicomStudySource(r.sourceType);
 const sending=state.send?.status==="uploading",sent=state.send?.status==="done";
 return <div className="ingest-panel">
   <div className="ingest-head"><div><strong>{collection?"Documentação reconhecida ✓":"Exame DICOM reconhecido ✓"}</strong><p className="muted">{collection
     ?`${r.totalFiles} arquivo(s) • ${formatBytes(r.totalBytes)} • ${r.sourceType==="SCAN"?"modelos 3D":"imagens/documentos"}`
     :`${r.sourceType} • ${r.totalFiles} DICOM • ${formatBytes(r.totalBytes)} • ${r.seriesCount} série(s)`}</p></div><button className="ghost compact" onClick={onClear} disabled={sending}>Descartar</button></div>
   {dicom&&r.failedFiles?.length>0&&<div className="warn">{r.failedFiles.length} arquivo(s) não puderam ser lidos e foram ignorados.</div>}
   {dicom&&<div className="series-list">{(r.series||[]).map(s=><div className="series-card" key={s.index}>
     <div><strong>{s.description}</strong><small>{s.modality} • {s.files} corte(s){s.dimensions?" • "+s.dimensions:""}</small><small>{s.manufacturer}{s.model?" • "+s.model:""}</small></div>
     <span className={"series-status "+(s.valid?"ok":"bad")}>{s.valid?"Série válida":"Revisar"}</span>
   </div>)}</div>}
   {collection&&<LocalFileStrip result={r}/>}
   {sending&&<div className="cloud-send-progress"><strong>Enviando com segurança… {state.send.done}/{state.send.total}</strong><div className="ingest-bar"><span style={{width:Math.round((state.send.done/Math.max(1,state.send.total))*100)+"%"}}/></div><small>Gravando no storage privado do OdontoView.</small></div>}
   {sent&&<div className="success cloud-send-done"><strong>Exame enviado ✓</strong><p>O exame foi associado ao paciente/pedido e já pode ser acessado conforme as permissões do fluxo.</p></div>}
   {state.send?.status==="error"&&<div className="error">Falha no envio: {state.send.message}</div>}
   {!state.send&&<p className="privacy-note">{collection?"Arquivos validados localmente.":"Leitura DICOM local concluída."} Clique em “{sendLabel}” para gravar no storage privado e associar ao paciente/pedido.</p>}
   <div className="ingest-actions">
     {onOpenViewer&&<button className="primary" onClick={onOpenViewer} disabled={sending}>{collection?"Pré-visualizar":"Abrir Viewer 2.0"}</button>}
     <button className="secondary" onClick={onSend} disabled={sending||sent||!onSend}>{sent?"Enviado ✓":sending?"Enviando…":sendLabel}</button>
   </div>
 </div>;
}

function Radiology(){
 const nav=useNavigate(),[q]=useSearchParams();
 const requestedTab=q.get("tab");
 const initialTab=["home","agenda","patients","exams","import"].includes(requestedTab)?requestedTab:"home";
 const [tab,setTab]=useState(initialTab),[date,setDate]=useState(localDateValue()),[data,setData]=useState(null),[patients,setPatients]=useState(null),[patientSearch,setPatientSearch]=useState(""),[err,setErr]=useState(""),[busy,setBusy]=useState(""),[ingest,setIngest]=useState(null);
 const [radiologyExamTypes,setRadiologyExamTypes]=useState([]),[importPatientId,setImportPatientId]=useState(""),[importExamType,setImportExamType]=useState("");
 const [patientForm,setPatientForm]=useState({name:"",birthDate:"",phone:"",email:""}),[patientSaving,setPatientSaving]=useState(false);
 const [selectedPatient,setSelectedPatient]=useState(null),[patientDetail,setPatientDetail]=useState(null),[patientDetailBusy,setPatientDetailBusy]=useState(false);
 const [patientIngest,setPatientIngest]=useState(null),[patientTarget,setPatientTarget]=useState(null),[patientExamType,setPatientExamType]=useState(""),[examUploadConfirm,setExamUploadConfirm]=useState(null);
 const [openingUnitStudy,setOpeningUnitStudy]=useState(""),[shareInvite,setShareInvite]=useState(null);
 const [documentationGallery,setDocumentationGallery]=useState(null),[galleryBusy,setGalleryBusy]=useState(false);
 const fileInput=useRef(null),orderForFile=useRef(null),patientFileInput=useRef(null);
 const range=useMemo(()=>dayRange(date),[date]);

 async function load(){
   setErr("");
   try{setData(await api("/api/unit/agenda?from="+encodeURIComponent(range.from)+"&to="+encodeURIComponent(range.to)))}catch(e){setErr(e.message)}
 }
 async function loadPatients(q=patientSearch){
   setErr("");
   try{setPatients(await api("/api/unit/patients"+(q?"?q="+encodeURIComponent(q):"")))}catch(e){setErr(e.message)}
 }
 async function openPatient(p){
   setSelectedPatient(p);setPatientDetail(null);setPatientIngest(null);setExamUploadConfirm(null);setShareInvite(null);setPatientDetailBusy(true);setErr("");
   try{
     const detail=await api("/api/unit/patients/"+p.id);
     setPatientDetail(detail);
     if(!patientExamType&&detail.examTypes?.[0])setPatientExamType(detail.examTypes[0].id);
   }catch(e){setErr(e.message)}finally{setPatientDetailBusy(false)}
 }
 async function refreshPatientDetail(){
   if(!selectedPatient)return;
   const detail=await api("/api/unit/patients/"+selectedPatient.id);
   setPatientDetail(detail);
   return detail;
 }
 useEffect(()=>{load()},[date]);
 useEffect(()=>{
   api("/api/catalog/exam-types").then(types=>{
     setRadiologyExamTypes(types);
     if(!importExamType&&types?.[0]){setImportExamType(types[0].id);setPatientExamType(types[0].id)}
   }).catch(e=>setErr(e.message));
 },[]);
 useEffect(()=>{if(["home","patients","import"].includes(tab))loadPatients()},[tab]);

 async function savePatient(e){
   e.preventDefault();setPatientSaving(true);setErr("");
   try{
     const created=await api("/api/unit/patients",{method:"POST",body:JSON.stringify(patientForm)});
     setPatientForm({name:"",birthDate:"",phone:"",email:""});
     await loadPatients("");
     await openPatient(created);
   }catch(e){setErr(e.message)}finally{setPatientSaving(false)}
 }
 async function advance(order){
   const next=order.status==="AGENDADO"?"PACIENTE_CHEGOU":order.status==="PACIENTE_CHEGOU"?"EXAME_REALIZADO":null;
   if(!next)return;
   setBusy(order.id);setErr("");
   try{await api("/api/unit/orders/"+order.id+"/status",{method:"PATCH",body:JSON.stringify({status:next})});await load();if(selectedPatient)await refreshPatientDetail()}catch(e){setErr(e.message)}finally{setBusy("")}
 }

 function pickExam(order){
   orderForFile.current=order;
   setIngest(null);
   const policy=examUploadPolicy(order?.examType);
   if(fileInput.current){
     fileInput.current.value="";
     fileInput.current.accept=policy.accept;
     fileInput.current.multiple=policy.multiple;
     fileInput.current.click();
   }
 }
 async function handleExamFiles(event){
   const files=Array.from(event.target.files||[]);
   const order=orderForFile.current;
   if(!order||!files.length)return;
   const policy=examUploadPolicy(order.examType);
   setIngest({orderId:order.id,status:"reading",progress:{phase:policy.kind==="dicom"?"start":"single"}});
   try{
     const result=policy.kind==="dicom"
       ?await importExam(files,{onProgress:progress=>setIngest({orderId:order.id,status:"reading",progress})})
       :await importSingleFileExam(files,order.examType);
     setIngest({orderId:order.id,status:"ready",result});
   }catch(e){
     setIngest({orderId:order.id,status:"error",message:e.message||"Falha ao abrir exame."});
   }
 }

 async function uploadStudyFiles(studyId,result,setState){
   let next=0,done=0;
   const worker=async()=>{
     while(true){
       const index=next++;
       if(index>=result.files.length)return;
       const file=result.files[index];
       const contentType=result.kind==="collection"?(result.fileItems?.[index]?.contentType||file.type||"application/octet-stream"):"application/dicom";
       await apiBinary("/api/unit/studies/"+studyId+"/files/"+index,file,{
         "Content-Type":"application/octet-stream",
         "X-File-Name":encodeURIComponent(file.name||("arquivo-"+(index+1))),
         "X-File-Content-Type":contentType
       });
       done++;
       setState(prev=>({...prev,send:{status:"uploading",done,total:result.files.length}}));
     }
   };
   await Promise.all(Array.from({length:Math.min(4,result.files.length)},()=>worker()));
 }

 async function sendExamToDentist(order){
   if(!ingest?.result||ingest.orderId!==order.id)return;
   const r=ingest.result,meta=uploadMetaFromResult(r);
   try{
     setIngest(prev=>({...prev,send:{status:"uploading",done:0,total:r.files.length}}));
     const created=await api("/api/unit/orders/"+order.id+"/study",{method:"POST",body:JSON.stringify(meta)});
     await uploadStudyFiles(created.study.id,r,setIngest);
     await api("/api/unit/studies/"+created.study.id+"/complete",{method:"POST",body:"{}"});
     setIngest(prev=>({...prev,send:{status:"done",done:r.files.length,total:r.files.length,studyId:created.study.id}}));
     await load();await loadPatients("");
   }catch(e){
     setIngest(prev=>({...prev,send:{status:"error",done:prev?.send?.done||0,total:r.files.length,message:e.message||"Falha no envio."}}));
   }
 }

 function beginPatientExamFileSelection(target){
   setPatientTarget(target);setPatientIngest(null);setExamUploadConfirm(null);
   const examType=(patientDetail?.examTypes||radiologyExamTypes).find(t=>t.id===(target?.examTypeId||patientExamType))||null;
   const policy=examUploadPolicy(examType);
   if(patientFileInput.current){
     patientFileInput.current.value="";
     patientFileInput.current.accept=policy.accept;
     patientFileInput.current.multiple=policy.multiple;
     patientFileInput.current.click();
   }
 }
 function confirmOrderExamUpload(order){
   setExamUploadConfirm({
     target:{kind:"order",id:order.id,examTypeId:order.examType.id},
     patientName:patientDetail?.patient?.name||selectedPatient?.name||"Paciente",
     examTypeName:order.examType.name,
     locked:true
   });
 }
 function choosePatientExam(target){
   setExamUploadConfirm({
     target,
     patientName:patientDetail?.patient?.name||selectedPatient?.name||"Paciente",
     examTypeName:patientDetail?.examTypes?.find(t=>t.id===(target.examTypeId||patientExamType))?.name||"Exame DICOM",
     locked:target.kind==="order"
   });
 }
 async function processPatientExamFiles(files,target=patientTarget){
   const incoming=Array.from(files||[]);
   if(!target||!incoming.length)return;
   setPatientTarget(target);
   const examType=(patientDetail?.examTypes||radiologyExamTypes).find(t=>t.id===(target.examTypeId||patientExamType))||null;
   const policy=examUploadPolicy(examType);
   setPatientIngest({status:"reading",progress:{phase:policy.kind==="dicom"?"start":"single"}});
   try{
     const result=policy.kind==="dicom"
       ?await importExam(incoming,{onProgress:progress=>setPatientIngest({status:"reading",progress})})
       :await importSingleFileExam(incoming,examType);
     setPatientIngest({status:"ready",result});
   }catch(e){setPatientIngest({status:"error",message:e.message||"Falha ao abrir exame."})}
 }
 async function handlePatientExamFiles(event){
   await processPatientExamFiles(Array.from(event.target.files||[]),patientTarget);
 }
 function dropPatientExamFiles(event,target){
   event.preventDefault();
   event.stopPropagation();
   const files=Array.from(event.dataTransfer?.files||[]);
   if(files.length)processPatientExamFiles(files,target);
 }
 async function sendPatientExam(){
   if(!patientIngest?.result||!patientTarget)return;
   const r=patientIngest.result;
   try{
     setPatientIngest(prev=>({...prev,send:{status:"uploading",done:0,total:r.files.length}}));
     const body=uploadMetaFromResult(r);
     let created;
     if(patientTarget.kind==="order"){
       created=await api("/api/unit/orders/"+patientTarget.id+"/study",{method:"POST",body:JSON.stringify(body)});
     }else{
       created=await api("/api/unit/patients/"+patientTarget.id+"/studies",{method:"POST",body:JSON.stringify({...body,examTypeId:patientTarget.examTypeId||patientExamType||null})});
     }
     await uploadStudyFiles(created.study.id,r,setPatientIngest);
     await api("/api/unit/studies/"+created.study.id+"/complete",{method:"POST",body:"{}"});
     setPatientIngest(prev=>({...prev,send:{status:"done",done:r.files.length,total:r.files.length,studyId:created.study.id}}));
     await Promise.all([refreshPatientDetail(),load(),loadPatients("")]);
   }catch(e){
     setPatientIngest(prev=>({...prev,send:{status:"error",done:prev?.send?.done||0,total:r.files.length,message:e.message||"Falha no envio."}}));
   }
 }
 function closeDocumentationGallery(){
   setDocumentationGallery(prev=>{
     prev?.items?.forEach(item=>item.url&&URL.revokeObjectURL(item.url));
     return null;
   });
 }
 async function openDocumentationGallery(manifest){
   setGalleryBusy(true);
   try{
     const files=manifest.files||[];
     const items=await Promise.all(files.map(async meta=>{
       const blob=await studyBlobFromCloudOrCache({manifest,meta,path:"/api/unit/studies/"+manifest.study.id+"/files/"+meta.id});
       const typed=new Blob([blob],{type:meta.contentType||blob.type||"application/octet-stream"});
       return {
         ...meta,
         blob:typed,
         contentType:typed.type||meta.contentType||"application/octet-stream",
         url:URL.createObjectURL(typed),
         previewKind:(typed.type||"").startsWith("image/")?"image":typed.type==="application/pdf"?"pdf":"file"
       };
     }));
     setDocumentationGallery({
       study:manifest.study,
       patient:manifest.patient,
       examType:manifest.examType,
       items,
       activeIndex:0
     });
   }finally{setGalleryBusy(false)}
 }
 async function openUnitStudy(study){
   void requestPersistentStudyStorage();
   setOpeningUnitStudy(study.id);setErr("");
   try{
     const manifest=await api("/api/unit/studies/"+study.id);
     if(!isDicomStudySource(manifest.study?.sourceType)){
       if(!manifest.files?.length)throw new Error("Arquivo do exame não encontrado.");
       await openDocumentationGallery(manifest);
       return;
     }
     const files=new Array(manifest.files.length);
     let cursor=0,done=0;
     const worker=async()=>{
       while(true){
         const i=cursor++;
         if(i>=manifest.files.length)return;
         const meta=manifest.files[i];
         const blob=await studyBlobFromCloudOrCache({manifest,meta,path:"/api/unit/studies/"+manifest.study.id+"/files/"+meta.id});
         files[i]=new File([blob],meta.fileName||("dicom-"+String(i+1).padStart(4,"0")+".dcm"),{type:"application/dicom"});
         done++;setOpeningUnitStudy(study.id+":"+done+"/"+manifest.files.length);
       }
     };
     await Promise.all(Array.from({length:Math.min(6,manifest.files.length)},()=>worker()));
     const result=await importExam(files);
     setViewerSession({result,order:{patient:manifest.patient,examType:manifest.examType||{name:"Exame DICOM"},unit:data?.unit||null}});
     nav(viewerRoute("radiology","/radiologia?tab="+tab));
   }catch(e){setErr(e.message||"Não foi possível abrir o exame.");}
   finally{setOpeningUnitStudy("")}
 }

 async function createRadiologyDentistInvite(){
   if(!selectedPatient)return;
   setErr("");
   try{
     const latestStudy=patientDetail?.studies?.find(s=>s.status==="READY");
     const out=await api("/api/unit/patients/"+selectedPatient.id+"/dentist-invite",{method:"POST",body:JSON.stringify({studyId:latestStudy?.id||null})});
     setShareInvite(out.inviteUrl);
   }catch(e){setErr(e.message)}
 }
 const goRadiologyTab=next=>{
   setTab(next);
   nav("/radiologia?tab="+encodeURIComponent(next),{replace:true});
 };
 const startRadiologyPatient=()=>{
   setSelectedPatient(null);setPatientDetail(null);setPatientIngest(null);
   goRadiologyTab("patients");
   setTimeout(()=>document.getElementById("radio-patient-name")?.focus(),60);
 };
 const startLocalImport=()=>{
   setPatientIngest(null);setPatientTarget(null);
   goRadiologyTab("import");
 };
 const localImportPatients=(patients?.patients||[]).filter(p=>p.source==="RADIOLOGIA");
 const selectedImportPatient=localImportPatients.find(p=>p.id===importPatientId)||null;
 const selectedImportType=radiologyExamTypes.find(t=>t.id===importExamType)||null;
 const selectedImportPolicy=examUploadPolicy(selectedImportType);
 const selectedPatientExamType=(patientDetail?.examTypes||radiologyExamTypes).find(t=>t.id===patientExamType)||null;
 const selectedPatientUploadPolicy=examUploadPolicy(selectedPatientExamType);
 const operationalOrders=data?.orders||[];
 const tomorrow=()=>{const x=new Date();x.setDate(x.getDate()+1);setDate(localDateValue(x))};
 return <main className="page radiology"><section className="wide">
   <input className="hidden-file" ref={fileInput} type="file" multiple onChange={handleExamFiles}/>
   <input className="hidden-file" ref={patientFileInput} type="file" multiple onChange={handlePatientExamFiles}/>
   {documentationGallery&&<div className="documentation-gallery-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeDocumentationGallery()}}>
     <section className="documentation-gallery" role="dialog" aria-modal="true">
       <header className="documentation-gallery-head">
         <div><p className="eyebrow">DOCUMENTAÇÃO / IMAGENS</p><h2>{documentationGallery.examType?.name||"Documentação"}</h2><p>{documentationGallery.patient?.name||"Paciente"} • {documentationGallery.items.length} arquivo(s)</p></div>
         <button className="ghost compact" onClick={closeDocumentationGallery}>Fechar</button>
       </header>
       <div className="documentation-gallery-stage">
         {(()=>{
           const item=documentationGallery.items[documentationGallery.activeIndex];
           if(!item)return <div className="empty">Nenhum arquivo.</div>;
           if(item.previewKind==="image")return <img src={item.url} alt={item.fileName}/>;
           if(item.previewKind==="pdf")return <iframe src={item.url} title={item.fileName}/>;
           return <div className="documentation-gallery-file"><span>3D</span><strong>{item.fileName}</strong><button className="secondary compact" onClick={()=>openBlobFile(item.blob,item.fileName)}>Baixar / abrir modelo 3D</button></div>;
         })()}
       </div>
       <div className="documentation-gallery-grid">
         {documentationGallery.items.map((item,index)=><button type="button" key={item.id||index} className={"documentation-thumb "+(index===documentationGallery.activeIndex?"active":"")} onClick={()=>setDocumentationGallery(prev=>({...prev,activeIndex:index}))}>
           {item.previewKind==="image"?<img src={item.url} alt=""/>:<span>{item.previewKind==="pdf"?"PDF":"3D"}</span>}
           <small title={item.fileName}>{item.fileName}</small>
         </button>)}
       </div>
     </section>
   </div>}
   {examUploadConfirm&&<div className="exam-upload-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setExamUploadConfirm(null)}}>
     <section className="exam-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="exam-upload-title" onDragOver={e=>e.preventDefault()} onDrop={e=>{dropPatientExamFiles(e,examUploadConfirm.target);setExamUploadConfirm(null)}}>
       <div className="exam-upload-dialog-head"><div><p className="eyebrow">ADICIONAR EXAME</p><h2 id="exam-upload-title">Confirme antes de selecionar o arquivo.</h2></div><button type="button" className="ghost compact" onClick={()=>setExamUploadConfirm(null)}>Fechar</button></div>
       <div className="exam-upload-summary">
         <label><span>Paciente</span><strong>{examUploadConfirm.patientName}</strong></label>
         <label><span>Tipo de exame</span><strong>{examUploadConfirm.examTypeName}</strong><small>Este tipo vem do pedido e será mantido no vínculo com o dentista. {examUploadPolicy(examUploadConfirm.examTypeName).help}</small></label>
       </div>
       <div className="exam-upload-drop-hint">⬆ Arraste os arquivos aqui ou use o botão abaixo.</div>
       <div className="exam-upload-dialog-actions">
         <button type="button" className="ghost" onClick={()=>setExamUploadConfirm(null)}>Cancelar</button>
         <button type="button" className="primary" onClick={()=>beginPatientExamFileSelection(examUploadConfirm.target)}>{examUploadPolicy(examUploadConfirm.examTypeName).buttonLabel}</button>
       </div>
     </section>
   </div>}
   <header className="topbar"><BrandLockup role="RADIOLOGIA"/><button className="ghost" onClick={logout}>Sair</button></header>
   <div className="hero-row radiology-hero"><div><p className="eyebrow">OPERAÇÃO DA RADIOLOGIA</p><h1>{tab==="home"?"Visão geral da unidade.":tab==="agenda"?"Agenda da unidade.":tab==="patients"?"Pacientes da unidade.":tab==="exams"?"Exames em andamento.":"Importar exame."}</h1><p className="muted">{data?.unit?data.unit.organization.name+" • "+data.unit.name:patients?.unit?patients.unit.organization.name+" • "+patients.unit.name:"Carregando unidade…"}</p></div><div className="radiology-hero-actions"><button className="primary" onClick={startRadiologyPatient}>＋ Novo paciente</button><button className="secondary" onClick={startLocalImport}>⬆ Importar exame</button></div></div>
   <nav className="workspace-tabs radiology-tabs">
     <button className={tab==="home"?"active":""} onClick={()=>goRadiologyTab("home")}>Visão geral</button>
     <button className={tab==="agenda"?"active":""} onClick={()=>goRadiologyTab("agenda")}>Agenda</button>
     <button className={tab==="patients"?"active":""} onClick={()=>goRadiologyTab("patients")}>Pacientes</button>
     <button className={tab==="exams"?"active":""} onClick={()=>goRadiologyTab("exams")}>Exames</button>
     <button className={tab==="import"?"active":""} onClick={()=>goRadiologyTab("import")}>Importar exame</button>
   </nav>
   {err&&<div className="error">{err}</div>}
   {tab==="home"&&<div className="radiology-home">
     <section className="radiology-home-actions">
       <button type="button" className="radiology-action-card is-primary" onClick={startRadiologyPatient}>
         <span className="radiology-action-icon">＋</span><span><strong>Novo paciente</strong><small>Cadastre um atendimento local.</small></span><b>→</b>
       </button>
       <button type="button" className="radiology-action-card" onClick={startLocalImport}>
         <span className="radiology-action-icon">⬆</span><span><strong>Importar exame</strong><small>Adicione um exame local já realizado.</small></span><b>→</b>
       </button>
     </section>
     <section className="radiology-home-shortcuts">
       <button type="button" className="radiology-shortcut" onClick={()=>goRadiologyTab("agenda")}><span>📅</span><div><strong>Agenda de hoje</strong><small>{operationalOrders.length} atendimento(s) em {new Date(date+"T12:00:00").toLocaleDateString("pt-BR")}</small></div><b>→</b></button>
       <button type="button" className="radiology-shortcut" onClick={()=>goRadiologyTab("patients")}><span>👥</span><div><strong>Pacientes</strong><small>{patients?.patients?.length||0} na base visível</small></div><b>→</b></button>
     </section>
     <section className="card radiology-ops-card">
       <div className="section-title"><div><p className="eyebrow">EXAMES EM ANDAMENTO</p><h2>Fila operacional de hoje.</h2><p className="muted">Acompanhe chegada, realização e recebimento das imagens.</p></div><div className="date-actions"><input aria-label="Data operacional" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button className="secondary compact" onClick={()=>goRadiologyTab("exams")}>Ver exames</button></div></div>
       {!data?<div className="empty">Carregando operação…</div>:operationalOrders.length===0?<div className="radiology-home-empty"><strong>Nenhum exame nesta data.</strong><p>Use a agenda para consultar outro dia ou importe um exame local.</p></div>:
       <div className="radiology-ops-list">{operationalOrders.slice(0,8).map(o=>{
         const st=STATUS[o.status]||{label:o.status,tone:""};
         const at=new Date(o.appointment.availability.startAt);
         return <article className="radiology-ops-row" key={o.id}>
           <div className="radiology-ops-time"><strong>{at.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</strong><span className={"badge "+st.tone}>{st.label}</span></div>
           <div className="radiology-ops-main"><strong>{o.patient.name}</strong><small>{o.examType.name} • {o.dentist.name}</small></div>
           <div className="radiology-ops-actions">
             {o.status==="AGENDADO"&&<button className="primary compact" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"Atualizando…":"Confirmar chegada"}</button>}
             {o.status==="PACIENTE_CHEGOU"&&<button className="primary compact" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"Atualizando…":"Marcar realizado"}</button>}
             {o.status==="EXAME_REALIZADO"&&<button className="primary compact" onClick={()=>pickExam(o)}>Importar exame</button>}
             {o.status==="IMAGENS_RECEBIDAS"&&<span className="done">✓ Disponível no OdontoView</span>}
           </div>
           {ingest?.orderId===o.id&&<div className="radiology-ops-ingest"><IngestResult state={ingest} onClear={()=>setIngest(null)} onOpenViewer={()=>{if(ingest.result?.kind==="collection"){previewLocalExam(ingest.result);return}setViewerSession({result:ingest.result,order:o});nav(viewerRoute("radiology","/radiologia?tab=home"))}} onSend={()=>sendExamToDentist(o)}/></div>}
         </article>
       })}</div>}
     </section>
   </div>}
   {tab==="agenda"&&<div className="radiology-datebar"><div className="date-actions"><input aria-label="Data da agenda" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button className="secondary compact" onClick={tomorrow}>Amanhã</button></div></div>}
   {tab==="agenda"&&(!data?<section className="card">Carregando agenda…</section>:data.orders.length===0?<section className="card empty"><strong>Nenhum exame nesta data.</strong><p>Escolha outra data para visualizar os agendamentos da unidade.</p></section>:
   <div className="agenda stack">{data.orders.map(o=>{
     const st=STATUS[o.status]||{label:o.status,tone:""};
     const at=new Date(o.appointment.availability.startAt);
     return <article className="card appointment-wrap network-patient" key={o.id}>
       <div className="appointment">
         <div className="time"><strong>{at.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</strong><span className={"badge "+st.tone}>{st.label}</span><span className="source-badge odontoview">OdontoView</span></div>
         <div className="appointment-main"><p className="eyebrow">{o.examType.name}</p><h2>{o.patient.name}</h2><p className="muted">Solicitante: {o.dentist.name} • CRO {o.dentist.cro}/{o.dentist.uf}</p>{o.patient.phone&&<p className="muted">Telefone: {o.patient.phone}</p>}</div>
         <div className="appointment-actions">
           {o.status==="AGENDADO"&&<button className="primary" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"Atualizando…":"Confirmar chegada"}</button>}
           {o.status==="PACIENTE_CHEGOU"&&<button className="primary" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"Atualizando…":"Marcar exame realizado"}</button>}
           {o.status==="EXAME_REALIZADO"&&<button className="primary" onClick={()=>pickExam(o)}>Selecionar exame</button>}
           {o.status==="IMAGENS_RECEBIDAS"&&<span className="done">✓ Exame recebido pelo OdontoView</span>}
         </div>
       </div>
       {ingest?.orderId===o.id&&<IngestResult state={ingest} onClear={()=>setIngest(null)} onOpenViewer={()=>{if(ingest.result?.kind==="collection"){previewLocalExam(ingest.result);return}setViewerSession({result:ingest.result,order:o});nav(viewerRoute("radiology","/radiologia?tab=agenda"))}} onSend={()=>sendExamToDentist(o)}/>}
     </article>
   })}</div>)}
   {tab==="exams"&&<section className="card radiology-exams-card">
     <div className="section-title"><div><p className="eyebrow">EXAMES</p><h2>Operação por status.</h2><p className="muted">Exames vinculados aos atendimentos da data selecionada.</p></div><div className="date-actions"><input aria-label="Data dos exames" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button className="secondary compact" onClick={tomorrow}>Amanhã</button></div></div>
     {!data?<div className="empty">Carregando exames…</div>:operationalOrders.length===0?<div className="empty"><strong>Nenhum exame nesta data.</strong></div>:
     <div className="radiology-exam-list">{operationalOrders.map(o=>{
       const st=STATUS[o.status]||{label:o.status,tone:""};
       return <article className="radiology-exam-row" key={o.id}>
         <div className="radiology-exam-main"><div className="patient-name-line"><strong>{o.patient.name}</strong><span className={"badge "+st.tone}>{st.label}</span></div><small>{o.examType.name}</small><small>Solicitante: {o.dentist.name} • CRO {o.dentist.cro}/{o.dentist.uf}</small></div>
         <div className="radiology-exam-actions">
           {o.status==="AGENDADO"&&<button className="secondary compact" disabled={busy===o.id} onClick={()=>advance(o)}>Confirmar chegada</button>}
           {o.status==="PACIENTE_CHEGOU"&&<button className="secondary compact" disabled={busy===o.id} onClick={()=>advance(o)}>Marcar realizado</button>}
           {o.status==="EXAME_REALIZADO"&&<button className="primary compact" onClick={()=>pickExam(o)}>Selecionar exame</button>}
           {o.status==="IMAGENS_RECEBIDAS"&&<span className="done">✓ Imagens recebidas</span>}
         </div>
         {ingest?.orderId===o.id&&<div className="radiology-exam-ingest"><IngestResult state={ingest} onClear={()=>setIngest(null)} onOpenViewer={()=>{if(ingest.result?.kind==="collection"){previewLocalExam(ingest.result);return}setViewerSession({result:ingest.result,order:o});nav(viewerRoute("radiology","/radiologia?tab=exams"))}} onSend={()=>sendExamToDentist(o)}/></div>}
       </article>
     })}</div>}
   </section>}
   {tab==="import"&&<section className="card radiology-import-card">
     <div className="section-title"><div><p className="eyebrow">IMPORTAR EXAME</p><h2>Adicionar exame local.</h2><p className="muted">CBCT usa série DICOM. Os demais exames podem reunir várias imagens/arquivos na mesma documentação. Pedidos vindos do OdontoView devem receber o arquivo pela Agenda/Exames para manter o vínculo com o dentista.</p></div><button className="secondary compact" onClick={startRadiologyPatient}>＋ Novo paciente</button></div>
     {!patients?<div className="empty">Carregando pacientes…</div>:localImportPatients.length===0?<div className="dentist-home-empty"><strong>Nenhum paciente local disponível.</strong><p>Cadastre um paciente da radiologia antes de importar o exame.</p><button className="primary compact" onClick={startRadiologyPatient}>Cadastrar paciente</button></div>:<>
       <div className="radiology-import-grid">
         <label><span>Paciente</span><select value={importPatientId} onChange={e=>setImportPatientId(e.target.value)}><option value="">Selecione o paciente</option>{localImportPatients.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
         <label><span>Tipo de exame</span><select value={importExamType} onChange={e=>{setImportExamType(e.target.value);setPatientExamType(e.target.value);setPatientIngest(null)}}>{radiologyExamTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
       </div>
       <div className={"documentation-dropzone "+(!importPatientId?"disabled":"")} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(importPatientId){setPatientExamType(importExamType);dropPatientExamFiles(e,{kind:"patient",id:importPatientId,examTypeId:importExamType})}}}>
         <span className="documentation-drop-icon">⬆</span><strong>Arraste os arquivos aqui</strong><small>{selectedImportPolicy.help}</small>
         <button className="primary" disabled={!importPatientId} onClick={()=>{setPatientExamType(importExamType);beginPatientExamFileSelection({kind:"patient",id:importPatientId,examTypeId:importExamType})}}>{selectedImportPolicy.buttonLabel}</button>
       </div>
       {patientIngest&&<IngestResult state={patientIngest} onClear={()=>setPatientIngest(null)} onOpenViewer={()=>{if(patientIngest.result?.kind==="collection"){previewLocalExam(patientIngest.result);return}setViewerSession({result:patientIngest.result,order:{patient:selectedImportPatient,examType:selectedImportType||{name:"Tomografia CBCT"},unit:data?.unit}});nav(viewerRoute("radiology","/radiologia?tab=import"))}} onSend={sendPatientExam} sendLabel="Salvar exame na radiologia"/>}
     </>}
   </section>}
   {tab==="patients"&&<div className={"radiology-patient-layout"+(selectedPatient?" has-detail":"")}>
     {!selectedPatient&&<section className="card patient-create-card">
       <p className="eyebrow">CADASTRO LOCAL</p><h2>Novo paciente</h2><p className="muted">Cadastre pacientes atendidos diretamente pela radiologia. Eles ficam identificados como “Radiologia”.</p>
       <form className="stack" onSubmit={savePatient}>
         <input id="radio-patient-name" required placeholder="Nome completo" value={patientForm.name} onChange={e=>setPatientForm({...patientForm,name:e.target.value})}/>
         <div className="two"><input type="date" value={patientForm.birthDate} onChange={e=>setPatientForm({...patientForm,birthDate:e.target.value})}/><input placeholder="Telefone / WhatsApp" value={patientForm.phone} onChange={e=>setPatientForm({...patientForm,phone:e.target.value})}/></div>
         <input type="email" placeholder="Email (opcional)" value={patientForm.email} onChange={e=>setPatientForm({...patientForm,email:e.target.value})}/>
         <button className="primary" disabled={patientSaving}>{patientSaving?"Salvando…":"Cadastrar paciente"}</button>
       </form>
     </section>}
     <section className="card patient-list-card">
       <div className="section-title"><div><p className="eyebrow">BASE DA UNIDADE</p><h2>Pacientes</h2></div><form className="patient-search" onSubmit={e=>{e.preventDefault();loadPatients(patientSearch)}}><input placeholder="Buscar por nome" value={patientSearch} onChange={e=>setPatientSearch(e.target.value)}/><button className="secondary compact">Buscar</button></form></div>
       {!patients?<div className="empty">Carregando pacientes…</div>:patients.patients.length===0?<div className="empty"><strong>Nenhum paciente encontrado.</strong></div>:
       <div className="patient-registry">{patients.patients.map(p=><button type="button" className={"patient-registry-row patient-row-button "+(p.source==="ODONTOVIEW"?"is-network":"is-local")+(selectedPatient?.id===p.id?" selected":"")} key={p.id} onClick={()=>openPatient(p)}>
         <div className="patient-registry-main"><div className="patient-name-line"><strong>{p.name}</strong><span className={"source-badge "+(p.source==="ODONTOVIEW"?"odontoview":"radiology")}>{p.sourceLabel}</span></div><small>{p.phone||"Sem telefone"}{p.birthDate?" • "+new Date(p.birthDate).toLocaleDateString("pt-BR"):""}</small>{p.dentist&&<small>Solicitante: {p.dentist.name} • CRO {p.dentist.cro}/{p.dentist.uf}</small>}</div>
         <span className="patient-open-hint">Abrir ›</span>
       </button>)}</div>}
     </section>
     {selectedPatient&&<section className="card patient-detail-card">
       <div className="patient-detail-head"><div><p className="eyebrow">FICHA DO PACIENTE</p><h2>{selectedPatient.name}</h2></div><div className="patient-detail-head-actions"><button className="secondary compact" onClick={createRadiologyDentistInvite}>Compartilhar com dentista</button><button className="ghost compact" onClick={()=>{setSelectedPatient(null);setPatientDetail(null);setPatientIngest(null);setExamUploadConfirm(null);setShareInvite(null);closeDocumentationGallery()}}>Fechar</button></div></div>
       {patientDetailBusy||!patientDetail?<div className="empty">Abrindo ficha…</div>:<>
         <div className="patient-detail-meta">
           <span className={"source-badge "+(patientDetail.source==="ODONTOVIEW"?"odontoview":"radiology")}>{patientDetail.source==="ODONTOVIEW"?"OdontoView":"Radiologia"}</span>
           <span>{patientDetail.patient.phone||"Sem telefone"}</span>
           {patientDetail.patient.birthDate&&<span>{new Date(patientDetail.patient.birthDate).toLocaleDateString("pt-BR")}</span>}
         </div>
         {shareInvite&&<div className="share-invite-box"><strong>Link seguro para o dentista</strong><code>{shareInvite}</code><div className="share-actions"><button className="secondary compact" onClick={()=>navigator.clipboard.writeText(shareInvite)}>Copiar link</button><a className="secondary compact" target="_blank" rel="noreferrer" href={"https://wa.me/?text="+encodeURIComponent("Olá! "+selectedPatient.name+" compartilhou um exame no OdontoView. Acesse ou crie seu cadastro: "+shareInvite)}>WhatsApp</a><a className="secondary compact" href={"mailto:?subject="+encodeURIComponent("Exame compartilhado no OdontoView")+"&body="+encodeURIComponent("Olá! "+selectedPatient.name+" compartilhou um exame com você no OdontoView. Acesse: "+shareInvite)}>Email</a></div><small>O convite expira em 7 dias e vincula o paciente ao cadastro do dentista que aceitar.</small></div>}
         <section className="patient-detail-section">
           <div className="section-title"><div><p className="eyebrow">PEDIDOS / EXAMES</p><h3>Histórico clínico da unidade</h3></div></div>
           {patientDetail.orders.length===0&&patientDetail.studies.length===0&&<div className="empty"><strong>Nenhum exame ainda.</strong><p>Você já pode adicionar o primeiro exame deste paciente.</p></div>}
           {patientDetail.orders.map(o=><div className="patient-order-card" key={o.id}>
             <div><strong>{o.examType.name}</strong><small>Solicitante: {o.dentist.name} • CRO {o.dentist.cro}/{o.dentist.uf}</small><small>Status: {STATUS[o.status]?.label||o.status}</small></div>
             <div className="patient-order-actions">
               {o.study?.status==="READY"?<button className="secondary compact" disabled={openingUnitStudy.startsWith(o.study.id)} onClick={()=>openUnitStudy({...o.study,examType:o.examType})}>{openingUnitStudy.startsWith(o.study.id)?"Abrindo…":isDicomStudySource(o.study.sourceType)?"Abrir Viewer":"Ver imagens"}</button>:
               o.status==="AGENDADO"?<button className="secondary compact" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"Atualizando…":"Confirmar chegada"}</button>:
               o.status==="PACIENTE_CHEGOU"?<button className="secondary compact" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"Atualizando…":"Marcar exame realizado"}</button>:
               o.status==="EXAME_REALIZADO"?<button className="primary compact" onClick={()=>confirmOrderExamUpload(o)}>＋ Adicionar exame</button>:
               o.status==="IMAGENS_RECEBIDAS"?<span className="done">✓ Imagens recebidas</span>:
               <span className="muted">{STATUS[o.status]?.label||o.status}</span>}
             </div>
           </div>)}
           {patientDetail.studies.filter(s=>!s.orderId).map(s=><div className="patient-order-card local-study" key={s.id}>
             <div><strong>{s.examType?.name||s.modality||"Exame DICOM"}</strong><small>{s.fileCount} arquivo(s) • {formatBytes(s.totalBytes)}</small><small>{s.completedAt?new Date(s.completedAt).toLocaleString("pt-BR"):""}</small></div>
             <button className="secondary compact" disabled={openingUnitStudy.startsWith(s.id)} onClick={()=>openUnitStudy(s)}>{openingUnitStudy.startsWith(s.id)?"Abrindo…":isDicomStudySource(s.sourceType)?"Abrir Viewer":"Ver imagens"}</button>
           </div>)}
         </section>
         {patientDetail.source==="RADIOLOGIA"&&<section className="patient-detail-section add-local-exam">
           <div><p className="eyebrow">NOVA DOCUMENTAÇÃO / EXAME</p><h3>Adicionar imagens ao paciente</h3><p className="muted">{selectedPatientUploadPolicy.help}</p></div>
           <div className="patient-local-exam-actions"><select value={patientExamType} onChange={e=>{setPatientExamType(e.target.value);setPatientIngest(null)}}>{patientDetail.examTypes.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></div>
           <div className="documentation-dropzone compact" onDragOver={e=>e.preventDefault()} onDrop={e=>dropPatientExamFiles(e,{kind:"patient",id:patientDetail.patient.id,examTypeId:patientExamType})}>
             <span className="documentation-drop-icon">⬆</span><strong>Arraste a documentação aqui</strong><small>Você pode selecionar vários arquivos de uma vez.</small>
             <button className="primary" onClick={()=>beginPatientExamFileSelection({kind:"patient",id:patientDetail.patient.id,examTypeId:patientExamType})}>{selectedPatientUploadPolicy.buttonLabel}</button>
           </div>
         </section>}
         {patientIngest&&<IngestResult state={patientIngest} onClear={()=>setPatientIngest(null)} onOpenViewer={()=>{if(patientIngest.result?.kind==="collection"){previewLocalExam(patientIngest.result);return}setViewerSession({result:patientIngest.result,order:{patient:patientDetail.patient,examType:patientDetail.examTypes.find(t=>t.id===(patientTarget?.examTypeId||patientExamType))||{name:"Tomografia CBCT"},unit:data?.unit}});nav(viewerRoute("radiology","/radiologia?tab="+tab))}} onSend={sendPatientExam}/>}
       </>}
     </section>}
   </div>}
 </section></main>
}
function DentistInvitePage(){
 const [q]=useSearchParams(),nav=useNavigate(),token=q.get("token"),[d,setD]=useState(null),[err,setErr]=useState("");
 useEffect(()=>{if(token)api("/api/public/dentist-invites/"+encodeURIComponent(token)).then(setD).catch(e=>setErr(e.message));else setErr("Convite incompleto.")},[token]);
 if(err)return <main className="page centered"><section className="card auth"><BrandLockup role="COMPARTILHAMENTO"/><h2>Convite indisponível</h2><p>{err}</p></section></main>;
 if(!d)return <main className="page centered">Carregando convite…</main>;
 return <main className="page centered"><section className="card auth invite-card"><BrandLockup role="ACESSO DO DENTISTA"/><p className="eyebrow">PACIENTE COMPARTILHADO</p><h1>{d.invite.patient.name}</h1><p>{d.invite.unit?"Compartilhado por "+d.invite.unit.organization+" • "+d.invite.unit.name:"O paciente compartilhou este acesso com você."}</p>{d.invite.study&&<p className="muted">{d.invite.study.examType?.name||"Exame DICOM"} • {d.invite.study.fileCount} arquivo(s)</p>}<div className="stack"><button className="primary" onClick={()=>nav("/cadastro-dentista?invite="+encodeURIComponent(token))}>Criar cadastro e acessar</button><button className="secondary" onClick={()=>nav("/?invite="+encodeURIComponent(token))}>Já tenho cadastro</button></div></section></main>
}

function Patient(){
 const [q]=useSearchParams(),nav=useNavigate(),token=q.get("token"),[d,setD]=useState(null),[err,setErr]=useState(""),[inviteUrl,setInviteUrl]=useState("");
 useEffect(()=>{if(token)api("/api/public/orders/access/"+token).then(setD).catch(e=>setErr(e.message));else setErr("Link incompleto.")},[token]);
 async function shareWithDentist(){
   try{
     const out=await api("/api/public/orders/access/"+token+"/dentist-invite",{method:"POST",body:"{}"});
     setInviteUrl(out.inviteUrl);
   }catch(e){setErr(e.message)}
 }
 if(err)return <main className="page centered"><section className="card"><h2>Link indisponível</h2><p>{err}</p></section></main>;
 if(!d)return <main className="page centered">Carregando…</main>;
 if(d.order.status!=="SOLICITADO")return <main className="page centered"><section className="card auth patient-card"><BrandLockup role="PACIENTE"/><p className="eyebrow">SEU EXAME</p><h1>{d.order.examType.name}</h1><p>Olá, {d.order.patient.name}. Status: <strong>{STATUS[d.order.status]?.label||d.order.status}</strong>.</p>{d.order.appointment&&<p>{new Date(d.order.appointment.availability.startAt).toLocaleString("pt-BR")}</p>}
   <section className="patient-documents-card"><p className="eyebrow">DOCUMENTOS DO EXAME</p><h3>Laudo e template</h3><p className="muted">Quando o laudo e os templates forem liberados pela radiologia/BR Laudos, eles aparecerão aqui para acesso do paciente.</p></section>
   <button className="secondary" onClick={shareWithDentist}>Compartilhar com outro dentista</button>
   {inviteUrl&&<div className="share-invite-box"><strong>Convite pronto</strong><code>{inviteUrl}</code><div className="share-actions"><button className="secondary compact" onClick={()=>navigator.clipboard.writeText(inviteUrl)}>Copiar</button><a className="secondary compact" target="_blank" rel="noreferrer" href={"https://wa.me/?text="+encodeURIComponent("Olá! Quero compartilhar meu exame no OdontoView com você. Acesse ou crie seu cadastro: "+inviteUrl)}>WhatsApp</a><a className="secondary compact" href={"mailto:?subject="+encodeURIComponent("Meu exame no OdontoView")+"&body="+encodeURIComponent("Olá! Quero compartilhar meu exame com você no OdontoView: "+inviteUrl)}>Email</a></div></div>}
 </section></main>;
 return <main className="page centered"><section className="card auth patient-card"><BrandLockup role="PACIENTE"/><p className="eyebrow">EXAME SOLICITADO</p><h1>{d.order.examType.name}</h1><p>Olá, {d.order.patient.name}. Solicitação de {d.order.dentist.name} • CRO {d.order.dentist.cro}/{d.order.dentist.uf}.</p><button className="primary" onClick={()=>nav("/paciente/unidade?token="+encodeURIComponent(token))}>Escolher onde fazer</button></section></main>
}

function Units(){
 const [q]=useSearchParams(),nav=useNavigate(),token=q.get("token"),[d,setD]=useState(null);
 useEffect(()=>{api("/api/public/orders/access/"+token).then(setD)},[token]);
 return <main className="page"><section className="content"><p className="eyebrow">UNIDADES</p><h1>Escolha onde fazer.</h1><div className="stack">{d?.offers.map(o=><button className="offer" key={o.id} onClick={()=>nav("/paciente/agendar?token="+encodeURIComponent(token)+"&offerId="+o.id)}><span><strong>{o.unit.name}</strong><small>{o.unit.addressLine} • {o.unit.city}/{o.unit.state}</small></span><b>R$ {Number(o.priceClient).toFixed(2).replace(".",",")}</b></button>)}</div></section></main>
}

function Schedule(){
 const [q]=useSearchParams(),token=q.get("token"),offerId=q.get("offerId"),[slots,setSlots]=useState([]),[done,setDone]=useState(false),[err,setErr]=useState("");
 useEffect(()=>{api("/api/public/orders/access/"+token+"/availability?offerId="+offerId).then(setSlots).catch(e=>setErr(e.message))},[token,offerId]);
 async function choose(id){try{await api("/api/public/orders/access/"+token+"/schedule",{method:"POST",body:JSON.stringify({offerId,availabilityId:id})});setDone(true)}catch(e){setErr(e.message)}}
 if(done)return <main className="page centered"><section className="card success"><p className="eyebrow">AGENDADO</p><h1>Pronto. Horário reservado.</h1></section></main>;
 return <main className="page"><section className="content"><p className="eyebrow">AGENDA</p><h1>Escolha um horário.</h1>{err&&<div className="error">{err}</div>}<div className="stack">{slots.map(s=><button className="offer" key={s.id} onClick={()=>choose(s.id)}><strong>{new Date(s.startAt).toLocaleDateString("pt-BR")}</strong><span>{new Date(s.startAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span></button>)}</div></section></main>
}

export default function App(){return <Routes>
 <Route path="/" element={<Login/>}/>
 <Route path="/cadastro-dentista" element={<Login initialMode="register"/>}/>
 <Route path="/convite-dentista" element={<DentistInvitePage/>}/>
 <Route path="/dentista" element={<DentistDashboard/>}/>
 <Route path="/novo-pedido" element={<Navigate to="/dentista"/>}/>
 <Route path="/radiologia" element={<Radiology/>}/>
 <Route path="/viewer2" element={<Viewer2/>}/>
 <Route path="/paciente" element={<Patient/>}/>
 <Route path="/paciente/unidade" element={<Units/>}/>
 <Route path="/paciente/agendar" element={<Schedule/>}/>
 <Route path="*" element={<Navigate to="/"/>}/>
</Routes>}
