import React,{useCallback,useEffect,useMemo,useState} from "react";
import {api} from "./api.js";
import "./admin-dashboard.css";

const EMPTY_OVERVIEW={onlineNow:0,uniqueToday:0,unique7d:0,unique30d:0,pageViews:0,dailySeries:[],topRoutes:[],topRegions:[],deviceBreakdown:[],sourceBreakdown:[]};

function number(value){return new Intl.NumberFormat("pt-BR").format(Number(value)||0)}
function timeAgo(value){
  const date=new Date(value),seconds=Math.max(0,Math.round((Date.now()-date.getTime())/1000));
  if(!Number.isFinite(seconds))return "—";
  if(seconds<60)return "agora";
  if(seconds<3600)return Math.floor(seconds/60)+" min";
  if(seconds<86400)return Math.floor(seconds/3600)+" h";
  return Math.floor(seconds/86400)+" d";
}
function formatDuration(value){
  const seconds=Math.max(0,Number(value)||0);
  if(seconds<60)return seconds+"s";
  const minutes=Math.round(seconds/60);
  if(minutes<60)return minutes+"min";
  return Math.floor(minutes/60)+"h "+String(minutes%60).padStart(2,"0")+"min";
}
function roleLabel(role){return ({DENTIST:"Dentista",UNIT_USER:"Radiologia",ADMIN:"Admin",ANONYMOUS:"Visitante"})[role]||role||"Visitante"}
function deviceLabel(value){return ({desktop:"Desktop",mobile:"Celular",tablet:"Tablet",unknown:"Não informado"})[value]||value||"Não informado"}
function sourceLabel(value){return value==="direct"?"Direto":value||"Não informado"}

function Metric({label,value,detail,live=false}){
  return <article className="admin-metric"><div className="admin-metric-label">{live&&<span className="admin-live-dot"/>}{label}</div><strong>{number(value)}</strong><small>{detail}</small></article>;
}
function RankList({title,items=[],formatter=x=>x}){
  const max=Math.max(1,...items.map(item=>Number(item.count)||0));
  return <section className="admin-panel admin-rank"><header><h2>{title}</h2></header>{items.length?<div className="admin-rank-list">{items.map((item,index)=><div className="admin-rank-row" key={item.label+index}>
    <div className="admin-rank-line"><span>{formatter(item.label)}</span><strong>{number(item.count)}</strong></div>
    <div className="admin-rank-track"><i style={{width:Math.max(4,(Number(item.count)||0)/max*100)+"%"}}/></div>
  </div>)}</div>:<p className="admin-empty">Ainda não há dados neste período.</p>}</section>;
}
function TrendChart({series=[]}){
  const max=Math.max(1,...series.map(item=>Math.max(Number(item.pageViews)||0,Number(item.sessions)||0)));
  const visible=series.length>14?series.filter((_,i)=>i%3===0||i===series.length-1):series;
  return <section className="admin-panel admin-trend"><header><div><p className="admin-kicker">MOVIMENTO DO PRODUTO</p><h2>Acessos por dia</h2></div><div className="admin-chart-legend"><span><i className="views"/> Visualizações</span><span><i className="sessions"/> Sessões</span></div></header>
    {series.length?<div className="admin-chart-wrap"><div className="admin-chart-bars">{series.map(item=><div className="admin-chart-day" key={item.day} title={`${item.day}: ${item.pageViews} visualizações / ${item.sessions} sessões`}>
      <div className="admin-chart-pair"><i className="views" style={{height:Math.max(3,(Number(item.pageViews)||0)/max*100)+"%"}}/><i className="sessions" style={{height:Math.max(3,(Number(item.sessions)||0)/max*100)+"%"}}/></div>
    </div>)}</div><div className="admin-chart-labels">{visible.map(item=><span key={item.day}>{String(item.day).slice(5).split("-").reverse().join("/")}</span>)}</div></div>:<p className="admin-empty">Os primeiros acessos aparecerão aqui automaticamente.</p>}
  </section>;
}

export default function AdminDashboard({fixture=null}){
  const [range,setRange]=useState("7d"),[overview,setOverview]=useState(fixture?.overview||EMPTY_OVERVIEW),[recent,setRecent]=useState(fixture?.recent||[]),[loading,setLoading]=useState(!fixture),[error,setError]=useState(""),[updatedAt,setUpdatedAt]=useState(fixture?new Date():null);
  const load=useCallback(async({quiet=false}={})=>{
    if(fixture)return;
    if(!quiet)setLoading(true);setError("");
    try{
      const [summary,activity]=await Promise.all([api("/api/admin/analytics/overview?range="+range),api("/api/admin/analytics/recent?limit=50")]);
      setOverview(summary||EMPTY_OVERVIEW);setRecent(activity?.sessions||[]);setUpdatedAt(new Date());
    }catch(e){setError(e.message||"Não foi possível carregar os dados.");}
    finally{if(!quiet)setLoading(false);}
  },[range,fixture]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>{
    if(fixture)return;
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")load({quiet:true})},30000);
    return()=>window.clearInterval(timer);
  },[load,fixture]);
  const activePeriod=range==="30d"?overview.unique30d:overview.unique7d;
  const online=useMemo(()=>recent.filter(item=>item.online),[recent]);
  function logout(){localStorage.removeItem("odontoview_token");localStorage.removeItem("odontoview_role");window.location.assign("/")}

  return <main className="admin-shell">
    <header className="admin-header">
      <div className="admin-brand"><div className="admin-brand-mark">OV</div><div><strong>Odonto<span>View</span></strong><small>ADMIN ANALYTICS</small></div></div>
      <div className="admin-header-actions"><div className="admin-live-chip"><span className="admin-live-dot"/>{number(overview.onlineNow)} online agora</div><button className="admin-ghost" onClick={logout}>Sair</button></div>
    </header>

    <section className="admin-main">
      <div className="admin-title-row"><div><p className="admin-kicker">VISÃO DO NEGÓCIO</p><h1>O OdontoView em movimento.</h1><p>Uso real do sistema, sem misturar analytics com dados clínicos.</p></div><div className="admin-toolbar"><div className="admin-range"><button className={range==="7d"?"active":""} onClick={()=>setRange("7d")}>7 dias</button><button className={range==="30d"?"active":""} onClick={()=>setRange("30d")}>30 dias</button></div><button className="admin-refresh" onClick={()=>load()} disabled={loading}>{loading?"Atualizando…":"↻ Atualizar"}</button></div></div>
      {error&&<div className="admin-error">{error}</div>}
      <div className="admin-metrics">
        <Metric live label="Online agora" value={overview.onlineNow} detail="atividade nos últimos 5 minutos"/>
        <Metric label="Pessoas hoje" value={overview.uniqueToday} detail="sessões únicas com atividade hoje"/>
        <Metric label={range==="30d"?"Pessoas em 30 dias":"Pessoas em 7 dias"} value={activePeriod} detail="alcance do período selecionado"/>
        <Metric label="Visualizações" value={overview.pageViews} detail="páginas abertas no período"/>
      </div>

      <div className="admin-grid-primary"><TrendChart series={overview.dailySeries}/><section className="admin-panel admin-now"><header><div><p className="admin-kicker">TEMPO REAL</p><h2>Quem está online</h2></div><span>{online.length}</span></header>{online.length?<div className="admin-now-list">{online.slice(0,8).map((item,index)=><div className="admin-now-row" key={(item.user?.id||"anon")+index}><span className="admin-avatar">{item.user?.name?.[0]?.toUpperCase()||"•"}</span><div><strong>{item.user?.name||"Visitante"}</strong><small>{roleLabel(item.role)} · {item.route}</small></div><i/></div>)}</div>:<p className="admin-empty">Nenhuma sessão ativa neste instante.</p>}</section></div>

      <div className="admin-grid-ranks"><RankList title="Páginas mais acessadas" items={overview.topRoutes}/><RankList title="De onde acessam" items={overview.topRegions}/><RankList title="Dispositivos" items={overview.deviceBreakdown} formatter={deviceLabel}/><RankList title="Origem do tráfego" items={overview.sourceBreakdown} formatter={sourceLabel}/></div>

      <section className="admin-panel admin-activity"><header><div><p className="admin-kicker">ATIVIDADE RECENTE</p><h2>Últimas sessões</h2></div>{updatedAt&&<small>Atualizado {updatedAt.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</small>}</header>
        <div className="admin-table-wrap"><table><thead><tr><th>Status</th><th>Usuário</th><th>Perfil</th><th>Página</th><th>Local</th><th>Dispositivo</th><th>Origem</th><th>Atividade</th></tr></thead><tbody>{recent.length?recent.map((item,index)=><tr key={(item.user?.id||"anon")+String(item.lastSeen)+index}>
          <td><span className={"admin-status "+(item.online?"online":"offline")}><i/>{item.online?"Online":"Recente"}</span></td>
          <td><strong>{item.user?.name||"Visitante anônimo"}</strong>{item.user?.email&&<small>{item.user.email}</small>}</td>
          <td>{roleLabel(item.role)}</td><td><code>{item.route||"/"}</code></td><td>{[item.location?.city,item.location?.region,item.location?.country].filter(Boolean).join(" / ")||"—"}</td>
          <td>{deviceLabel(item.device?.class)}<small>{[item.device?.browser,item.device?.os].filter(Boolean).join(" · ")}</small></td><td>{sourceLabel(item.source)}</td><td>{timeAgo(item.lastSeen)}<small>{formatDuration(item.durationSeconds)}</small></td>
        </tr>):<tr><td colSpan="8" className="admin-table-empty">Ainda não há sessões registradas.</td></tr>}</tbody></table></div>
      </section>
      <footer className="admin-footer"><span>OdontoView Analytics · localização aproximada por rede</span><span>IP bruto não é armazenado</span></footer>
    </section>
  </main>;
}
