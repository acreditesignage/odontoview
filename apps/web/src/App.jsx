import React from "react";import {useEffect,useState} from "react";import {Navigate,Route,Routes,useNavigate,useSearchParams} from "react-router-dom";import {api} from "./api.js";

function Login(){
 const nav=useNavigate(),[mode,setMode]=useState("login"),[err,setErr]=useState(""),[f,setF]=useState({name:"",email:"",password:"",cro:"",uf:"RJ"});
 async function submit(e){e.preventDefault();setErr("");try{const d=await api(mode==="login"?"/api/auth/login":"/api/auth/register-dentist",{method:"POST",body:JSON.stringify(f)});localStorage.setItem("odontoview_token",d.token);nav("/novo-pedido");}catch(x){setErr(x.message)}}
 return <main className="page centered"><section className="card auth"><div className="brand">OdontoView</div><p className="eyebrow">NETWORK</p><h1>{mode==="login"?"Solicite um exame.":"Cadastro profissional."}</h1><form className="stack" onSubmit={submit}>{mode==="register"&&<input placeholder="Nome" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/>}<input type="email" placeholder="Email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/><input type="password" placeholder="Senha" value={f.password} onChange={e=>setF({...f,password:e.target.value})}/>{mode==="register"&&<div className="two"><input placeholder="CRO" value={f.cro} onChange={e=>setF({...f,cro:e.target.value})}/><input placeholder="UF" value={f.uf} onChange={e=>setF({...f,uf:e.target.value.toUpperCase()})}/></div>}{err&&<div className="error">{err}</div>}<button className="primary">{mode==="login"?"Entrar":"Criar conta"}</button></form><button className="link" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"Primeiro acesso?":"Já tenho conta"}</button></section></main>
}
function NewOrder(){
 const [types,setTypes]=useState([]),[type,setType]=useState(""),[p,setP]=useState({name:"",birthDate:"",phone:"",email:""}),[out,setOut]=useState(null),[err,setErr]=useState("");
 useEffect(()=>{api("/api/catalog/exam-types").then(x=>{setTypes(x);if(x[0])setType(x[0].id)}).catch(e=>setErr(e.message))},[]);
 async function submit(e){e.preventDefault();try{const patient=await api("/api/patients",{method:"POST",body:JSON.stringify(p)});const order=await api("/api/orders",{method:"POST",body:JSON.stringify({patientId:patient.id,examTypeId:type})});setOut(order)}catch(x){setErr(x.message)}}
 return <main className="page"><section className="content"><p className="eyebrow">SOLICITAÇÃO</p><h1>Um pedido simples.</h1><form className="card stack" onSubmit={submit}><input placeholder="Paciente" value={p.name} onChange={e=>setP({...p,name:e.target.value})}/><div className="two"><input type="date" value={p.birthDate} onChange={e=>setP({...p,birthDate:e.target.value})}/><input placeholder="Telefone" value={p.phone} onChange={e=>setP({...p,phone:e.target.value})}/></div><select value={type} onChange={e=>setType(e.target.value)}>{types.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>{err&&<div className="error">{err}</div>}<button className="primary">Criar pedido</button></form>{out&&<section className="card success"><strong>Pedido criado.</strong><p>Envie este link ao paciente:</p><code>{out.patientAccessUrl}</code><button className="secondary" onClick={()=>navigator.clipboard.writeText(out.patientAccessUrl)}>Copiar link</button></section>}</section></main>
}
function Patient(){
 const [q]=useSearchParams(),nav=useNavigate(),token=q.get("token"),[d,setD]=useState(null),[err,setErr]=useState("");
 useEffect(()=>{if(token)api("/api/public/orders/access/"+token).then(setD).catch(e=>setErr(e.message));else setErr("Link incompleto.")},[token]);
 if(err)return <main className="page centered"><section className="card"><h2>Link indisponível</h2><p>{err}</p></section></main>;
 if(!d)return <main className="page centered">Carregando…</main>;
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
export default function App(){return <Routes><Route path="/" element={<Login/>}/><Route path="/novo-pedido" element={<NewOrder/>}/><Route path="/paciente" element={<Patient/>}/><Route path="/paciente/unidade" element={<Units/>}/><Route path="/paciente/agendar" element={<Schedule/>}/><Route path="*" element={<Navigate to="/"/>}/></Routes>}
