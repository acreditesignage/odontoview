import React from "react";
import ReactDOM from "react-dom/client";
import {BrowserRouter} from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={error:null}}
  static getDerivedStateFromError(error){return {error}}
  componentDidCatch(error,info){console.error("OdontoView render error",error,info)}
  render(){
    if(this.state.error){
      return <main className="page centered"><section className="card auth">
        <div className="brand">OdontoView</div>
        <p className="eyebrow">RECUPERAÇÃO</p>
        <h2>Não foi possível abrir esta tela.</h2>
        <div className="error">{this.state.error?.message||"Erro inesperado."}</div>
        <button className="secondary" onClick={()=>window.location.assign("/")}>Voltar ao início</button>
      </section></main>
    }
    return this.props.children;
  }
}

const rootEl=document.getElementById("root");
const fallback=document.getElementById("startup-fallback");
if(fallback)fallback.remove();
window.__ODONTOVIEW_STARTED__=true;
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter><App/></BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
