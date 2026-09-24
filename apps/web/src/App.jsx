import React from "react";
import {useEffect,useMemo,useRef,useState} from "react";
import {Navigate,Route,Routes,useNavigate,useSearchParams} from "react-router-dom";
import {api,apiBinary,apiBlob} from "./api.js";
import {importExam} from "./ingest.js";
import Viewer2 from "./Viewer2.jsx";
import {setViewerSession} from "./viewerSession.js";

function routeForRole(role){return role==="UNIT_USER"?"/radiologia":"/dentista"}
function logout(){localStorage.removeItem("odontoview_token");localStorage.removeItem("odontoview_role");location.href="/"}
function formatBytes(value){if(!value)return "0 MB";return (value/1024/1024).toFixed(value>10*1024*1024?1:2)+" MB"}
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
 const nav=useNavigate();
 const [data,setData]=useState(null),[types,setTypes]=useState([]),[tab,setTab]=useState("home"),[err,setErr]=useState(""),[busy,setBusy]=useState(false),[openingStudy,setOpeningStudy]=useState("");
 const [patientMode,setPatientMode]=useState("existing"),[selectedPatient,setSelectedPatient]=useState(""),[type,setType]=useState("");
 const [p,setP]=useState({name:"",birthDate:"",phone:"",email:""}),[out,setOut]=useState(null);
 const dentistFileInput=useRef(null);
 const [dentistIngest,setDentistIngest]=useState(null),[dentistImportPatient,setDentistImportPatient]=useState(""),[dentistImportType,setDentistImportType]=useState("");

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
 async function submitOrder(e){
   e.preventDefault();setBusy(true);setErr("");setOut(null);
   try{
     let patientId=selectedPatient;
     if(patientMode==="new"){
       const patient=await api("/api/patients",{method:"POST",body:JSON.stringify(p)});
       patientId=patient.id;
     }
     if(!patientId)throw new Error("Selecione ou cadastre um paciente.");
     const order=await api("/api/orders",{method:"POST",body:JSON.stringify({patientId,examTypeId:type})});
     setOut(order);setP({name:"",birthDate:"",phone:"",email:""});setPatientMode("existing");
     await load();
   }catch(e){setErr(e.message)}finally{setBusy(false)}
 }
 async function handleDentistImportFiles(event){
   const files=Array.from(event.target.files||[]);
   if(!files.length)return;
   setDentistIngest({status:"reading",progress:{phase:"start"}});
   try{
     const result=await importExam(files,{onProgress:progress=>setDentistIngest({status:"reading",progress})});
     setDentistIngest({status:"ready",result});
   }catch(e){setDentistIngest({status:"error",message:e.message||"Falha ao abrir exame."})}
 }
 async function sendDentistImport(){
   if(!dentistIngest?.result||!dentistImportPatient)return;
   const r=dentistIngest.result,firstValid=r.series.find(s=>s.valid)||r.series[0]||{};
   try{
     setDentistIngest(prev=>({...prev,send:{status:"uploading",done:0,total:r.files.length}}));
     const created=await api("/api/dentist/patients/"+dentistImportPatient+"/studies",{method:"POST",body:JSON.stringify({
       examTypeId:dentistImportType||null,sourceType:r.sourceType,modality:firstValid.modality,
       manufacturer:firstValid.manufacturer,model:firstValid.model,seriesCount:r.seriesCount
     })});
     let next=0,done=0;
     const worker=async()=>{
       while(true){
         const index=next++;
         if(index>=r.files.length)return;
         const file=r.files[index];
         await apiBinary("/api/dentist/studies/"+created.study.id+"/files/"+index,file,{
           "Content-Type":"application/octet-stream",
           "X-File-Name":encodeURIComponent(file.name||("dicom-"+(index+1)+".dcm"))
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

 async function openStudy(order){
   if(!order?.study?.id)return;
   setOpeningStudy(order.study.id);setErr("");
   try{
     const manifest=await api("/api/dentist/studies/"+order.study.id);
     const files=new Array(manifest.files.length);
     let cursor=0,done=0;
     const worker=async()=>{
       while(true){
         const i=cursor++;
         if(i>=manifest.files.length)return;
         const meta=manifest.files[i];
         const blob=await apiBlob("/api/dentist/studies/"+order.study.id+"/files/"+meta.id);
         files[i]=new File([blob],meta.fileName||("dicom-"+String(i+1).padStart(4,"0")+".dcm"),{type:"application/dicom"});
         done++;
         setOpeningStudy(order.study.id+":"+done+"/"+manifest.files.length);
       }
     };
     await Promise.all(Array.from({length:Math.min(6,manifest.files.length)},()=>worker()));
     const result=await importExam(files);
     setViewerSession({result,order:{...order,patient:manifest.order.patient,examType:manifest.order.examType,unit:manifest.order.unit}});
     nav("/viewer2");
   }catch(e){setErr(e.message||"Não foi possível abrir o exame.");}
   finally{setOpeningStudy("")}
 }
 const statusLabel=s=>STATUS[s]?.label||s;
 return <main className="page dentist-dashboard"><section className="wide">
   <input className="hidden-file" ref={dentistFileInput} type="file" multiple onChange={handleDentistImportFiles}/>
   <header className="topbar"><BrandLockup role="DENTISTA"/><div className="topbar-actions"><a className="ghost compact" href="/cadastro-dentista" target="_blank" rel="noreferrer">Link de cadastro</a><button className="ghost" onClick={logout}>Sair</button></div></header>
   <div className="hero-row dentist-hero"><div><p className="eyebrow">ODONTOVIEW NETWORK</p><h1>{data?.dentist?.user?.name||"Seu painel clínico"}</h1><p className="muted">{data?.dentist?("CRO "+data.dentist.cro+"/"+data.dentist.uf+" • pacientes, pedidos e exames em um só lugar."):"Carregando perfil…"}</p></div><div className="hero-actions"><button className="secondary" onClick={()=>setTab("import")}>Importar DICOM</button><button className="primary" onClick={()=>setTab("new")}>+ Novo pedido</button></div></div>
   <nav className="workspace-tabs">
     <button className={tab==="home"?"active":""} onClick={()=>setTab("home")}>Visão geral</button>
     <button className={tab==="new"?"active":""} onClick={()=>setTab("new")}>Novo pedido</button>
     <button className={tab==="patients"?"active":""} onClick={()=>setTab("patients")}>Pacientes</button>\n     <button className={tab==="exams"?"active":""} onClick={()=>setTab("exams")}>Meus exames</button>
     <button className={tab==="import"?"active":""} onClick={()=>setTab("import")}>Importar DICOM</button>
   </nav>
   {err&&<div className="error">{err}</div>}
   {!data?<section className="card">Carregando painel…</section>:<>
     {tab==="home"&&<div className="dashboard-grid">
       <section className="metric-card"><span>Pacientes</span><strong>{data.patients.length}</strong><small>cadastrados por você</small></section>
       <section className="metric-card"><span>Pedidos</span><strong>{data.orders.length}</strong><small>últimos registros</small></section>
       <section className="card dashboard-main">
         <div className="section-title"><div><p className="eyebrow">PEDIDOS RECENTES</p><h2>Acompanhe a jornada.</h2></div><button className="secondary compact" onClick={()=>setTab("new")}>Novo pedido</button></div>
         {data.orders.length===0?<div className="empty"><strong>Nenhum pedido ainda.</strong><p>Crie o primeiro pedido para testar o fluxo completo.</p></div>:
         <div className="dentist-order-list">{data.orders.slice(0,12).map(o=><div className={"dentist-order-row"+(o.study?.status==="READY"?" has-exam":"")} key={o.id}>
           <div><strong>{o.patient.name}</strong><small>{o.examType.name}{o.unit?" • "+o.unit.name:""}</small></div>
           <div className="dentist-order-actions">
             <span className={"badge "+(STATUS[o.status]?.tone||"")}>{o.study?.status==="READY"?"Exame disponível":statusLabel(o.status)}</span>
             {o.study?.status==="READY"&&<button className="primary compact" disabled={openingStudy.startsWith(o.study.id)} onClick={()=>openStudy(o)}>{openingStudy.startsWith(o.study.id)?("Abrindo "+(openingStudy.split(":")[1]||"…")):"Abrir Viewer"}</button>}
           </div>
         </div>)}</div>}
       </section>
     </div>}
     {tab==="new"&&<section className="card dentist-order-card">
       <div className="section-title"><div><p className="eyebrow">NOVO PEDIDO</p><h2>Solicite o exame em poucos passos.</h2></div></div>
       <form className="stack" onSubmit={submitOrder}>
         <div className="choice-tabs"><button type="button" className={patientMode==="existing"?"active":""} onClick={()=>setPatientMode("existing")}>Paciente cadastrado</button><button type="button" className={patientMode==="new"?"active":""} onClick={()=>setPatientMode("new")}>Novo paciente</button></div>
         {patientMode==="existing"?<select value={selectedPatient} onChange={e=>setSelectedPatient(e.target.value)}><option value="">Selecione o paciente</option>{data.patients.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>:
         <div className="stack"><input required placeholder="Nome do paciente" value={p.name} onChange={e=>setP({...p,name:e.target.value})}/><div className="two"><input type="date" value={p.birthDate} onChange={e=>setP({...p,birthDate:e.target.value})}/><input placeholder="Telefone / WhatsApp" value={p.phone} onChange={e=>setP({...p,phone:e.target.value})}/></div><input type="email" placeholder="Email (opcional)" value={p.email} onChange={e=>setP({...p,email:e.target.value})}/></div>}
         <select value={type} onChange={e=>setType(e.target.value)}>{types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
         <button className="primary" disabled={busy}>{busy?"Criando…":"Criar pedido e gerar link"}</button>
       </form>
       {out&&<section className="success order-link-box"><strong>Pedido criado ✓</strong><p>Envie este link seguro ao paciente para escolher a radiologia e o horário:</p><code>{out.patientAccessUrl}</code><button className="secondary" onClick={()=>navigator.clipboard.writeText(out.patientAccessUrl)}>Copiar link</button></section>}
     </section>}
     {tab==="import"&&<section className="card dentist-import-card">
       <div className="section-title"><div><p className="eyebrow">IMPORTAR DICOM</p><h2>Abra qualquer exame no OdontoView.</h2><p className="muted">Escolha um paciente e envie ZIP/DICOM para salvar de forma privada na sua biblioteca.</p></div></div>
       {data.patients.length===0?<div className="empty"><strong>Cadastre um paciente primeiro.</strong><p>Depois você poderá associar qualquer DICOM a ele.</p></div>:<>
         <div className="dentist-import-grid">
           <label><span>Paciente</span><select value={dentistImportPatient} onChange={e=>setDentistImportPatient(e.target.value)}>{data.patients.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
           <label><span>Tipo de exame</span><select value={dentistImportType} onChange={e=>setDentistImportType(e.target.value)}>{types.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
           <button className="primary" onClick={()=>{setDentistIngest(null);dentistFileInput.current?.click()}}>Selecionar ZIP / DICOM</button>
         </div>
         {dentistIngest&&<IngestResult state={dentistIngest} onClear={()=>setDentistIngest(null)} onOpenViewer={()=>{setViewerSession({result:dentistIngest.result,order:{patient:data.patients.find(p=>p.id===dentistImportPatient),examType:types.find(t=>t.id===dentistImportType)||{name:"Exame DICOM"}}});nav("/viewer2")}} onSend={sendDentistImport} sendLabel="Salvar em Meus exames"/>}
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
       <div className="section-title"><div><p className="eyebrow">PACIENTES</p><h2>Sua base de pacientes.</h2></div><button className="primary compact" onClick={()=>{setPatientMode("new");setTab("new")}}>+ Cadastrar</button></div>
       {data.patients.length===0?<div className="empty">Nenhum paciente cadastrado.</div>:<div className="patient-registry">{data.patients.map(x=><div className="patient-registry-row" key={x.id}><div><strong>{x.name}</strong><small>{x.phone||"Sem telefone"}{x.birthDate?" • "+new Date(x.birthDate).toLocaleDateString("pt-BR"):""}</small></div><button className="secondary compact" onClick={()=>{setSelectedPatient(x.id);setPatientMode("existing");setTab("new")}}>Criar pedido</button></div>)}</div>}
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
   const label=p.phase==="metadata"?`Lendo metadados DICOM • ${p.current||0}/${p.total||"?"}`:"Abrindo arquivo compactado…";
   return <div className="ingest-panel"><strong>OdontoView Ingest</strong><p className="muted">{label}</p><div className="ingest-bar"><span/></div></div>;
 }
 if(state.status==="error")return <div className="ingest-panel ingest-error"><strong>Não foi possível abrir este exame.</strong><p>{state.message}</p><button className="ghost compact" onClick={onClear}>Fechar</button></div>;
 if(state.status!=="ready")return null;
 const r=state.result;
 const sending=state.send?.status==="uploading",sent=state.send?.status==="done";
 return <div className="ingest-panel">
   <div className="ingest-head"><div><strong>Exame reconhecido localmente ✓</strong><p className="muted">{r.sourceType} • {r.totalFiles} DICOM • {formatBytes(r.totalBytes)} • {r.seriesCount} série(s)</p></div><button className="ghost compact" onClick={onClear} disabled={sending}>Descartar</button></div>
   {r.failedFiles.length>0&&<div className="warn">{r.failedFiles.length} arquivo(s) não puderam ser lidos e foram ignorados.</div>}
   <div className="series-list">{r.series.map(s=><div className="series-card" key={s.index}>
     <div><strong>{s.description}</strong><small>{s.modality} • {s.files} corte(s){s.dimensions?" • "+s.dimensions:""}</small><small>{s.manufacturer}{s.model?" • "+s.model:""}</small></div>
     <span className={"series-status "+(s.valid?"ok":"bad")}>{s.valid?"Série válida":"Revisar"}</span>
   </div>)}</div>
   {sending&&<div className="cloud-send-progress"><strong>Enviando com segurança… {state.send.done}/{state.send.total}</strong><div className="ingest-bar"><span style={{width:Math.round((state.send.done/Math.max(1,state.send.total))*100)+"%"}}/></div><small>Gravando no storage privado do OdontoView.</small></div>}
   {sent&&<div className="success cloud-send-done"><strong>Exame enviado ✓</strong><p>O estudo foi associado ao paciente/pedido e já pode ser acessado conforme as permissões do fluxo.</p></div>}
   {state.send?.status==="error"&&<div className="error">Falha no envio: {state.send.message}</div>}
   {!state.send&&<p className="privacy-note">Leitura local concluída. Clique em “{sendLabel}” para gravar os DICOMs no storage privado e associá-los ao paciente/pedido.</p>}
   <div className="ingest-actions">
     <button className="primary" onClick={onOpenViewer} disabled={sending}>Abrir Viewer 2.0</button>
     <button className="secondary" onClick={onSend} disabled={sending||sent||!onSend}>{sent?"Enviado ✓":sending?"Enviando…":sendLabel}</button>
   </div>
 </div>;
}

function Radiology(){
 const nav=useNavigate();
 const [tab,setTab]=useState("agenda"),[date,setDate]=useState(localDateValue()),[data,setData]=useState(null),[patients,setPatients]=useState(null),[patientSearch,setPatientSearch]=useState(""),[err,setErr]=useState(""),[busy,setBusy]=useState(""),[ingest,setIngest]=useState(null);
 const [patientForm,setPatientForm]=useState({name:"",birthDate:"",phone:"",email:""}),[patientSaving,setPatientSaving]=useState(false);
 const [selectedPatient,setSelectedPatient]=useState(null),[patientDetail,setPatientDetail]=useState(null),[patientDetailBusy,setPatientDetailBusy]=useState(false);
 const [patientIngest,setPatientIngest]=useState(null),[patientTarget,setPatientTarget]=useState(null),[patientExamType,setPatientExamType]=useState("");
 const [openingUnitStudy,setOpeningUnitStudy]=useState(""),[shareInvite,setShareInvite]=useState(null);
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
   setSelectedPatient(p);setPatientDetail(null);setPatientIngest(null);setShareInvite(null);setPatientDetailBusy(true);setErr("");
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
 useEffect(()=>{if(tab==="patients")loadPatients()},[tab]);

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
   if(fileInput.current){fileInput.current.value="";fileInput.current.click()}
 }
 async function handleExamFiles(event){
   const files=Array.from(event.target.files||[]);
   const order=orderForFile.current;
   if(!order||!files.length)return;
   setIngest({orderId:order.id,status:"reading",progress:{phase:"start"}});
   try{
     const result=await importExam(files,{onProgress:progress=>setIngest({orderId:order.id,status:"reading",progress})});
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
       await apiBinary("/api/unit/studies/"+studyId+"/files/"+index,file,{
         "Content-Type":"application/octet-stream",
         "X-File-Name":encodeURIComponent(file.name||("dicom-"+(index+1)+".dcm"))
       });
       done++;
       setState(prev=>({...prev,send:{status:"uploading",done,total:result.files.length}}));
     }
   };
   await Promise.all(Array.from({length:Math.min(4,result.files.length)},()=>worker()));
 }

 async function sendExamToDentist(order){
   if(!ingest?.result||ingest.orderId!==order.id)return;
   const r=ingest.result,firstValid=r.series.find(s=>s.valid)||r.series[0]||{};
   try{
     setIngest(prev=>({...prev,send:{status:"uploading",done:0,total:r.files.length}}));
     const created=await api("/api/unit/orders/"+order.id+"/study",{method:"POST",body:JSON.stringify({
       sourceType:r.sourceType,modality:firstValid.modality,manufacturer:firstValid.manufacturer,model:firstValid.model,seriesCount:r.seriesCount
     })});
     await uploadStudyFiles(created.study.id,r,setIngest);
     await api("/api/unit/studies/"+created.study.id+"/complete",{method:"POST",body:"{}"});
     setIngest(prev=>({...prev,send:{status:"done",done:r.files.length,total:r.files.length,studyId:created.study.id}}));
     await load();await loadPatients("");
   }catch(e){
     setIngest(prev=>({...prev,send:{status:"error",done:prev?.send?.done||0,total:r.files.length,message:e.message||"Falha no envio."}}));
   }
 }

 function choosePatientExam(target){
   setPatientTarget(target);setPatientIngest(null);
   if(patientFileInput.current){patientFileInput.current.value="";patientFileInput.current.click()}
 }
 async function handlePatientExamFiles(event){
   const files=Array.from(event.target.files||[]);
   if(!patientTarget||!files.length)return;
   setPatientIngest({status:"reading",progress:{phase:"start"}});
   try{
     const result=await importExam(files,{onProgress:progress=>setPatientIngest({status:"reading",progress})});
     setPatientIngest({status:"ready",result});
   }catch(e){setPatientIngest({status:"error",message:e.message||"Falha ao abrir exame."})}
 }
 async function sendPatientExam(){
   if(!patientIngest?.result||!patientTarget)return;
   const r=patientIngest.result,firstValid=r.series.find(s=>s.valid)||r.series[0]||{};
   try{
     setPatientIngest(prev=>({...prev,send:{status:"uploading",done:0,total:r.files.length}}));
     const body={
       sourceType:r.sourceType,modality:firstValid.modality,manufacturer:firstValid.manufacturer,model:firstValid.model,seriesCount:r.seriesCount
     };
     let created;
     if(patientTarget.kind==="order"){
       created=await api("/api/unit/orders/"+patientTarget.id+"/study",{method:"POST",body:JSON.stringify(body)});
     }else{
       created=await api("/api/unit/patients/"+patientTarget.id+"/studies",{method:"POST",body:JSON.stringify({...body,examTypeId:patientExamType||null})});
     }
     await uploadStudyFiles(created.study.id,r,setPatientIngest);
     await api("/api/unit/studies/"+created.study.id+"/complete",{method:"POST",body:"{}"});
     setPatientIngest(prev=>({...prev,send:{status:"done",done:r.files.length,total:r.files.length,studyId:created.study.id}}));
     await Promise.all([refreshPatientDetail(),load(),loadPatients("")]);
   }catch(e){
     setPatientIngest(prev=>({...prev,send:{status:"error",done:prev?.send?.done||0,total:r.files.length,message:e.message||"Falha no envio."}}));
   }
 }
 async function openUnitStudy(study){
   setOpeningUnitStudy(study.id);setErr("");
   try{
     const manifest=await api("/api/unit/studies/"+study.id);
     const files=new Array(manifest.files.length);
     let cursor=0,done=0;
     const worker=async()=>{
       while(true){
         const i=cursor++;
         if(i>=manifest.files.length)return;
         const meta=manifest.files[i];
         const blob=await apiBlob("/api/unit/studies/"+study.id+"/files/"+meta.id);
         files[i]=new File([blob],meta.fileName||("dicom-"+String(i+1).padStart(4,"0")+".dcm"),{type:"application/dicom"});
         done++;setOpeningUnitStudy(study.id+":"+done+"/"+manifest.files.length);
       }
     };
     await Promise.all(Array.from({length:Math.min(6,manifest.files.length)},()=>worker()));
     const result=await importExam(files);
     setViewerSession({result,order:{patient:manifest.patient,examType:manifest.examType||{name:"Exame DICOM"},unit:data?.unit||null}});
     nav("/viewer2");
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
  const tomorrow=()=>{const x=new Date();x.setDate(x.getDate()+1);setDate(localDateValue(x))};
 return <main className="page radiology"><section className="wide">
   <input className="hidden-file" ref={fileInput} type="file" multiple onChange={handleExamFiles}/>
   <input className="hidden-file" ref={patientFileInput} type="file" multiple onChange={handlePatientExamFiles}/>
   <header className="topbar"><BrandLockup role="RADIOLOGIA"/><button className="ghost" onClick={logout}>Sair</button></header>
   <div className="hero-row"><div><p className="eyebrow">AQUISIÇÃO + ENVIO</p><h1>{tab==="agenda"?"Agenda da unidade.":"Pacientes da unidade."}</h1><p className="muted">{data?.unit?data.unit.organization.name+" • "+data.unit.name:patients?.unit?patients.unit.organization.name+" • "+patients.unit.name:"Carregando unidade…"}</p></div>{tab==="agenda"?<div className="date-actions"><input aria-label="Data da agenda" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button className="secondary compact" onClick={tomorrow}>Amanhã</button></div>:<button className="primary compact" onClick={()=>document.getElementById("radio-patient-name")?.focus()}>+ Novo paciente</button>}</div>
   <nav className="workspace-tabs radiology-tabs">
     <button className={tab==="agenda"?"active":""} onClick={()=>setTab("agenda")}>Agenda</button>
     <button className={tab==="patients"?"active":""} onClick={()=>setTab("patients")}>Pacientes</button>
   </nav>
   {err&&<div className="error">{err}</div>}
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
       {ingest?.orderId===o.id&&<IngestResult state={ingest} onClear={()=>setIngest(null)} onOpenViewer={()=>{setViewerSession({result:ingest.result,order:o});nav("/viewer2")}} onSend={()=>sendExamToDentist(o)}/>}
     </article>
   })}</div>)}
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
       <div className="patient-detail-head"><div><p className="eyebrow">FICHA DO PACIENTE</p><h2>{selectedPatient.name}</h2></div><div className="patient-detail-head-actions"><button className="secondary compact" onClick={createRadiologyDentistInvite}>Compartilhar com dentista</button><button className="ghost compact" onClick={()=>{setSelectedPatient(null);setPatientDetail(null);setPatientIngest(null);setShareInvite(null)}}>Fechar</button></div></div>
       {patientDetailBusy||!patientDetail?<div className="empty">Abrindo ficha…</div>:<>
         <div className="patient-detail-meta">
           <span className={"source-badge "+(patientDetail.source==="ODONTOVIEW"?"odontoview":"radiology")}>{patientDetail.source==="ODONTOVIEW"?"OdontoView":"Radiologia"}</span>
           <span>{patientDetail.patient.phone||"Sem telefone"}</span>
           {patientDetail.patient.birthDate&&<span>{new Date(patientDetail.patient.birthDate).toLocaleDateString("pt-BR")}</span>}
         </div>
         {shareInvite&&<div className="share-invite-box"><strong>Link seguro para o dentista</strong><code>{shareInvite}</code><div className="share-actions"><button className="secondary compact" onClick={()=>navigator.clipboard.writeText(shareInvite)}>Copiar link</button><a className="secondary compact" target="_blank" rel="noreferrer" href={"https://wa.me/?text="+encodeURIComponent("Olá! "+selectedPatient.name+" compartilhou um exame no OdontoView. Acesse ou crie seu cadastro: "+shareInvite)}>WhatsApp</a><a className="secondary compact" href={"mailto:?subject="+encodeURIComponent("Exame compartilhado no OdontoView")+"&body="+encodeURIComponent("Olá! "+selectedPatient.name+" compartilhou um exame com você no OdontoView. Acesse: "+shareInvite)}>Email</a></div><small>O convite expira em 7 dias e vincula o paciente ao cadastro do dentista que aceitar.</small></div>}
         <section className="patient-detail-section">
           <div className="section-title"><div><p className="eyebrow">PEDIDOS / EXAMES</p><h3>Histórico clínico da unidade</h3></div></div>
           {patientDetail.orders.length===0&&patientDetail.studies.length===0&&<div className="empty"><strong>Nenhum exame ainda.</strong><p>Você já pode adicionar o primeiro DICOM deste paciente.</p></div>}
           {patientDetail.orders.map(o=><div className="patient-order-card" key={o.id}>
             <div><strong>{o.examType.name}</strong><small>Solicitante: {o.dentist.name} • CRO {o.dentist.cro}/{o.dentist.uf}</small><small>Status: {STATUS[o.status]?.label||o.status}</small></div>
             <div className="patient-order-actions">
               {o.study?.status==="READY"?<button className="secondary compact" disabled={openingUnitStudy.startsWith(o.study.id)} onClick={()=>openUnitStudy({...o.study,examType:o.examType})}>{openingUnitStudy.startsWith(o.study.id)?"Abrindo…":"Abrir exame"}</button>:
               o.status==="EXAME_REALIZADO"?<button className="primary compact" onClick={()=>choosePatientExam({kind:"order",id:o.id,examTypeId:o.examType.id})}>+ Adicionar exame</button>:
               <span className="muted">Aguardando etapa clínica</span>}
             </div>
           </div>)}
           {patientDetail.studies.filter(s=>!s.orderId).map(s=><div className="patient-order-card local-study" key={s.id}>
             <div><strong>{s.examType?.name||s.modality||"Exame DICOM"}</strong><small>{s.fileCount} arquivo(s) • {formatBytes(s.totalBytes)}</small><small>{s.completedAt?new Date(s.completedAt).toLocaleString("pt-BR"):""}</small></div>
             <button className="secondary compact" disabled={openingUnitStudy.startsWith(s.id)} onClick={()=>openUnitStudy(s)}>{openingUnitStudy.startsWith(s.id)?"Abrindo…":"Abrir exame"}</button>
           </div>)}
         </section>
         {patientDetail.source==="RADIOLOGIA"&&<section className="patient-detail-section add-local-exam">
           <div><p className="eyebrow">NOVO EXAME LOCAL</p><h3>Adicionar DICOM ao paciente</h3></div>
           <div className="patient-local-exam-actions"><select value={patientExamType} onChange={e=>setPatientExamType(e.target.value)}>{patientDetail.examTypes.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select><button className="primary" onClick={()=>choosePatientExam({kind:"patient",id:patientDetail.patient.id})}>Selecionar exame</button></div>
         </section>}
         {patientIngest&&<IngestResult state={patientIngest} onClear={()=>setPatientIngest(null)} onOpenViewer={()=>{setViewerSession({result:patientIngest.result,order:{patient:patientDetail.patient,examType:patientDetail.examTypes.find(t=>t.id===(patientTarget?.examTypeId||patientExamType))||{name:"Exame DICOM"},unit:data?.unit}});nav("/viewer2")}} onSend={sendPatientExam}/>}
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
