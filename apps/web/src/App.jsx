import React from "react";
import {useEffect,useMemo,useRef,useState} from "react";
import {Navigate,Route,Routes,useNavigate,useSearchParams} from "react-router-dom";
import {api} from "./api.js";
import {importExam} from "./ingest.js";
import Viewer2 from "./Viewer2.jsx";
import {setViewerSession} from "./viewerSession.js";

function routeForRole(role){return role==="UNIT_USER"?"/radiologia":"/novo-pedido"}
function logout(){localStorage.removeItem("odontoview_token");localStorage.removeItem("odontoview_role");location.href="/"}
function formatBytes(value){if(!value)return "0 MB";return (value/1024/1024).toFixed(value>10*1024*1024?1:2)+" MB"}

function Login(){
 const nav=useNavigate(),[mode,setMode]=useState("login"),[err,setErr]=useState(""),[f,setF]=useState({name:"",email:"",password:"",cro:"",uf:"RJ"});
 async function submit(e){
   e.preventDefault();setErr("");
   try{
     const d=await api(mode==="login"?"/api/auth/login":"/api/auth/register-dentist",{method:"POST",body:JSON.stringify(f)});
     localStorage.setItem("odontoview_token",d.token);
     localStorage.setItem("odontoview_role",d.user.role);
     nav(routeForRole(d.user.role));
   }catch(x){setErr(x.message)}
 }
 return <main className="page centered"><section className="card auth">
   <div className="brand">OdontoView</div><p className="eyebrow">NETWORK</p>
   <h1>{mode==="login"?"Seu acesso ao ecossistema.":"Cadastro do dentista."}</h1>
   <p className="muted">{mode==="login"?"Dentista ou radiologia entram pelo mesmo OdontoView.":"Crie seu acesso profissional para solicitar exames."}</p>
   <form className="stack" onSubmit={submit}>
     {mode==="register"&&<input placeholder="Nome" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/>}
     <input type="email" placeholder="Email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/>
     <input type="password" placeholder="Senha" value={f.password} onChange={e=>setF({...f,password:e.target.value})}/>
     {mode==="register"&&<div className="two"><input placeholder="CRO" value={f.cro} onChange={e=>setF({...f,cro:e.target.value})}/><input placeholder="UF" value={f.uf} onChange={e=>setF({...f,uf:e.target.value.toUpperCase()})}/></div>}
     {err&&<div className="error">{err}</div>}<button className="primary">{mode==="login"?"Entrar":"Criar conta"}</button>
   </form>
   <button className="link" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"Sou dentista e quero criar conta":"Já tenho conta"}</button>
 </section></main>
}

function NewOrder(){
 const [types,setTypes]=useState([]),[type,setType]=useState(""),[p,setP]=useState({name:"",birthDate:"",phone:"",email:""}),[out,setOut]=useState(null),[err,setErr]=useState("");
 useEffect(()=>{api("/api/catalog/exam-types").then(x=>{setTypes(x);if(x[0])setType(x[0].id)}).catch(e=>setErr(e.message))},[]);
 async function submit(e){e.preventDefault();setErr("");try{const patient=await api("/api/patients",{method:"POST",body:JSON.stringify(p)});const order=await api("/api/orders",{method:"POST",body:JSON.stringify({patientId:patient.id,examTypeId:type})});setOut(order)}catch(x){setErr(x.message)}}
 return <main className="page"><section className="content">
   <header className="topbar"><div><div className="brand">OdontoView</div><p className="eyebrow">DENTISTA</p></div><button className="ghost" onClick={logout}>Sair</button></header>
   <h1>Um pedido simples.</h1>
   <form className="card stack" onSubmit={submit}><input placeholder="Paciente" value={p.name} onChange={e=>setP({...p,name:e.target.value})}/><div className="two"><input type="date" value={p.birthDate} onChange={e=>setP({...p,birthDate:e.target.value})}/><input placeholder="Telefone" value={p.phone} onChange={e=>setP({...p,phone:e.target.value})}/></div><select value={type} onChange={e=>setType(e.target.value)}>{types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>{err&&<div className="error">{err}</div>}<button className="primary">Criar pedido</button></form>
   {out&&<section className="card success"><strong>Pedido criado.</strong><p>Envie este link ao paciente:</p><code>{out.patientAccessUrl}</code><button className="secondary" onClick={()=>navigator.clipboard.writeText(out.patientAccessUrl)}>Copiar link</button></section>}
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
   <header className="topbar"><div><div className="brand">OdontoView</div><p className="eyebrow">RADIOLOGIA</p></div><button className="ghost" onClick={logout}>Sair</button></header>
   <div className="hero-row"><div><h1>Agenda da unidade.</h1><p className="muted">{data?.unit?data.unit.organization.name+" • "+data.unit.name:"Carregando unidade…"}</p></div><div className="date-actions"><input aria-label="Data da agenda" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button className="secondary compact" onClick={tomorrow}>Amanhã</button></div></div>
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
 if(d.order.status!=="SOLICITADO")return <main className="page centered"><section className="card auth"><div className="brand">OdontoView</div><p className="eyebrow">SEU EXAME</p><h1>{d.order.examType.name}</h1><p>Olá, {d.order.patient.name}. Status: <strong>{STATUS[d.order.status]?.label||d.order.status}</strong>.</p>{d.order.appointment&&<p>{new Date(d.order.appointment.availability.startAt).toLocaleString("pt-BR")}</p>}</section></main>;
 return <main className="page centered"><section className="card auth"><div className="brand">OdontoView</div><p className="eyebrow">EXAME SOLICITADO</p><h1>{d.order.examType.name}</h1><p>Olá, {d.order.patient.name}. Solicitação de {d.order.dentist.name} • CRO {d.order.dentist.cro}/{d.order.dentist.uf}.</p><button className="primary" onClick={()=>nav("/paciente/unidade?token="+encodeURIComponent(token))}>Escolher onde fazer</button></section></main>
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
