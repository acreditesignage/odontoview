import React from "react";
import {useEffect,useMemo,useRef,useState} from "react";
import {Navigate,Route,Routes,useNavigate,useSearchParams} from "react-router-dom";
import {api} from "./api.js";
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
 const nav=useNavigate(),[mode,setMode]=useState(initialMode),[err,setErr]=useState(""),[f,setF]=useState({name:"",email:"",password:"",cro:"",uf:"RJ"});
 async function submit(e){
   e.preventDefault();setErr("");
   try{
     const d=await api(mode==="login"?"/api/auth/login":"/api/auth/register-dentist",{method:"POST",body:JSON.stringify(f)});
     localStorage.setItem("odontoview_token",d.token);
     localStorage.setItem("odontoview_role",d.user.role);
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
 const [data,setData]=useState(null),[types,setTypes]=useState([]),[tab,setTab]=useState("home"),[err,setErr]=useState(""),[busy,setBusy]=useState(false);
 const [patientMode,setPatientMode]=useState("existing"),[selectedPatient,setSelectedPatient]=useState(""),[type,setType]=useState("");
 const [p,setP]=useState({name:"",birthDate:"",phone:"",email:""}),[out,setOut]=useState(null);

 async function load(){
   setErr("");
   try{
     const [dashboard,examTypes]=await Promise.all([api("/api/dentist/dashboard"),api("/api/catalog/exam-types")]);
     setData(dashboard);setTypes(examTypes);
     if(!type&&examTypes[0])setType(examTypes[0].id);
     if(!selectedPatient&&dashboard.patients[0])setSelectedPatient(dashboard.patients[0].id);
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
 const statusLabel=s=>STATUS[s]?.label||s;
 return <main className="page dentist-dashboard"><section className="wide">
   <header className="topbar"><BrandLockup role="DENTISTA"/><div className="topbar-actions"><a className="ghost compact" href="/cadastro-dentista" target="_blank" rel="noreferrer">Link de cadastro</a><button className="ghost" onClick={logout}>Sair</button></div></header>
   <div className="hero-row dentist-hero"><div><p className="eyebrow">ODONTOVIEW NETWORK</p><h1>{data?.dentist?.user?.name||"Seu painel clínico"}</h1><p className="muted">{data?.dentist?("CRO "+data.dentist.cro+"/"+data.dentist.uf+" • pacientes, pedidos e exames em um só lugar."):"Carregando perfil…"}</p></div><button className="primary" onClick={()=>setTab("new")}>+ Novo pedido</button></div>
   <nav className="workspace-tabs">
     <button className={tab==="home"?"active":""} onClick={()=>setTab("home")}>Visão geral</button>
     <button className={tab==="new"?"active":""} onClick={()=>setTab("new")}>Novo pedido</button>
     <button className={tab==="patients"?"active":""} onClick={()=>setTab("patients")}>Pacientes</button>
   </nav>
   {err&&<div className="error">{err}</div>}
   {!data?<section className="card">Carregando painel…</section>:<>
     {tab==="home"&&<div className="dashboard-grid">
       <section className="metric-card"><span>Pacientes</span><strong>{data.patients.length}</strong><small>cadastrados por você</small></section>
       <section className="metric-card"><span>Pedidos</span><strong>{data.orders.length}</strong><small>últimos registros</small></section>
       <section className="card dashboard-main">
         <div className="section-title"><div><p className="eyebrow">PEDIDOS RECENTES</p><h2>Acompanhe a jornada.</h2></div><button className="secondary compact" onClick={()=>setTab("new")}>Novo pedido</button></div>
         {data.orders.length===0?<div className="empty"><strong>Nenhum pedido ainda.</strong><p>Crie o primeiro pedido para testar o fluxo completo.</p></div>:
         <div className="dentist-order-list">{data.orders.slice(0,12).map(o=><div className="dentist-order-row" key={o.id}>
           <div><strong>{o.patient.name}</strong><small>{o.examType.name}{o.unit?" • "+o.unit.name:""}</small></div>
           <span className={"badge "+(STATUS[o.status]?.tone||"")}>{statusLabel(o.status)}</span>
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

function IngestResult({state,onClear,onOpenViewer}){
 if(!state)return null;
 if(state.status==="reading"){
   const p=state.progress||{};
   const label=p.phase==="metadata"?`Lendo metadados DICOM • ${p.current||0}/${p.total||"?"}`:"Abrindo arquivo compactado…";
   return <div className="ingest-panel"><strong>OdontoView Ingest</strong><p className="muted">{label}</p><div className="ingest-bar"><span/></div></div>;
 }
 if(state.status==="error")return <div className="ingest-panel ingest-error"><strong>Não foi possível abrir este exame.</strong><p>{state.message}</p><button className="ghost compact" onClick={onClear}>Fechar</button></div>;
 if(state.status!=="ready")return null;
 const r=state.result;
 return <div className="ingest-panel">
   <div className="ingest-head"><div><strong>Exame reconhecido localmente ✓</strong><p className="muted">{r.sourceType} • {r.totalFiles} DICOM • {formatBytes(r.totalBytes)} • {r.seriesCount} série(s)</p></div><button className="ghost compact" onClick={onClear}>Descartar</button></div>
   {r.failedFiles.length>0&&<div className="warn">{r.failedFiles.length} arquivo(s) não puderam ser lidos e foram ignorados.</div>}
   <div className="series-list">{r.series.map(s=><div className="series-card" key={s.index}>
     <div><strong>{s.description}</strong><small>{s.modality} • {s.files} corte(s){s.dimensions?" • "+s.dimensions:""}</small><small>{s.manufacturer}{s.model?" • "+s.model:""}</small></div>
     <span className={"series-status "+(s.valid?"ok":"bad")}>{s.valid?"Série válida":"Revisar"}</span>
   </div>)}</div>
   <p className="privacy-note">Leitura local. Nesta etapa nenhum arquivo foi enviado para a nuvem e o pedido ainda permanece como “Exame realizado”.</p>
   <div className="ingest-actions"><button className="primary" onClick={onOpenViewer}>Abrir Viewer 2.0 Beta</button><button className="secondary" disabled>Associar ao pedido e enviar • próxima etapa</button></div>
 </div>;
}

function Radiology(){
 const nav=useNavigate();
 const [date,setDate]=useState(localDateValue()),[data,setData]=useState(null),[err,setErr]=useState(""),[busy,setBusy]=useState(""),[ingest,setIngest]=useState(null);
 const fileInput=useRef(null),orderForFile=useRef(null);
 const range=useMemo(()=>dayRange(date),[date]);
 async function load(){
   setErr("");
   try{setData(await api("/api/unit/agenda?from="+encodeURIComponent(range.from)+"&to="+encodeURIComponent(range.to)))}catch(e){setErr(e.message)}
 }
 useEffect(()=>{load()},[date]);
 async function advance(order){
   const next=order.status==="AGENDADO"?"PACIENTE_CHEGOU":order.status==="PACIENTE_CHEGOU"?"EXAME_REALIZADO":null;
   if(!next)return;
   setBusy(order.id);setErr("");
   try{await api("/api/unit/orders/"+order.id+"/status",{method:"PATCH",body:JSON.stringify({status:next})});await load()}catch(e){setErr(e.message)}finally{setBusy("")}
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
 const tomorrow=()=>{const x=new Date();x.setDate(x.getDate()+1);setDate(localDateValue(x))};
 return <main className="page radiology"><section className="wide">
   <input className="hidden-file" ref={fileInput} type="file" multiple onChange={handleExamFiles}/>
   <header className="topbar"><BrandLockup role="RADIOLOGIA"/><button className="ghost" onClick={logout}>Sair</button></header>
   <div className="hero-row"><div><p className="eyebrow">AQUISIÇÃO + ENVIO</p><h1>Agenda da unidade.</h1><p className="muted">{data?.unit?data.unit.organization.name+" • "+data.unit.name:"Carregando unidade…"}</p></div><div className="date-actions"><input aria-label="Data da agenda" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button className="secondary compact" onClick={tomorrow}>Amanhã</button></div></div>
   {err&&<div className="error">{err}</div>}
   {!data?<section className="card">Carregando agenda…</section>:data.orders.length===0?<section className="card empty"><strong>Nenhum exame nesta data.</strong><p>Escolha outra data para visualizar os agendamentos da unidade.</p></section>:
   <div className="agenda stack">{data.orders.map(o=>{
     const st=STATUS[o.status]||{label:o.status,tone:""};
     const at=new Date(o.appointment.availability.startAt);
     return <article className="card appointment-wrap" key={o.id}>
       <div className="appointment">
         <div className="time"><strong>{at.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</strong><span className={"badge "+st.tone}>{st.label}</span></div>
         <div className="appointment-main"><p className="eyebrow">{o.examType.name}</p><h2>{o.patient.name}</h2><p className="muted">Solicitante: {o.dentist.name} • CRO {o.dentist.cro}/{o.dentist.uf}</p>{o.patient.phone&&<p className="muted">Telefone: {o.patient.phone}</p>}</div>
         <div className="appointment-actions">
           {o.status==="AGENDADO"&&<button className="primary" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"Atualizando…":"Confirmar chegada"}</button>}
           {o.status==="PACIENTE_CHEGOU"&&<button className="primary" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?"Atualizando…":"Marcar exame realizado"}</button>}
           {o.status==="EXAME_REALIZADO"&&<button className="primary" onClick={()=>pickExam(o)}>Selecionar exame</button>}
           {o.status==="IMAGENS_RECEBIDAS"&&<span className="done">✓ Exame recebido pelo OdontoView</span>}
         </div>
       </div>
       {ingest?.orderId===o.id&&<IngestResult state={ingest} onClear={()=>setIngest(null)} onOpenViewer={()=>{setViewerSession({result:ingest.result,order:o});nav("/viewer2")}}/>}
     </article>
   })}</div>}
 </section></main>
}

function Patient(){
 const [q]=useSearchParams(),nav=useNavigate(),token=q.get("token"),[d,setD]=useState(null),[err,setErr]=useState("");
 useEffect(()=>{if(token)api("/api/public/orders/access/"+token).then(setD).catch(e=>setErr(e.message));else setErr("Link incompleto.")},[token]);
 if(err)return <main className="page centered"><section className="card"><h2>Link indisponível</h2><p>{err}</p></section></main>;
 if(!d)return <main className="page centered">Carregando…</main>;
 if(d.order.status!=="SOLICITADO")return <main className="page centered"><section className="card auth patient-card"><BrandLockup role="PACIENTE"/><p className="eyebrow">SEU EXAME</p><h1>{d.order.examType.name}</h1><p>Olá, {d.order.patient.name}. Status: <strong>{STATUS[d.order.status]?.label||d.order.status}</strong>.</p>{d.order.appointment&&<p>{new Date(d.order.appointment.availability.startAt).toLocaleString("pt-BR")}</p>}</section></main>;
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
 <Route path="/novo-pedido" element={<NewOrder/>}/>
 <Route path="/radiologia" element={<Radiology/>}/>
 <Route path="/viewer2" element={<Viewer2/>}/>
 <Route path="/paciente" element={<Patient/>}/>
 <Route path="/paciente/unidade" element={<Units/>}/>
 <Route path="/paciente/agendar" element={<Schedule/>}/>
 <Route path="*" element={<Navigate to="/"/>}/>
</Routes>}
