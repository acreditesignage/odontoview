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

// Defensive compatibility layer for browser translators/extensions that can
// move React-owned text nodes. Scope the workaround to the React root only.
const nativeRemoveChild=Node.prototype.removeChild;
const nativeInsertBefore=Node.prototype.insertBefore;
Node.prototype.removeChild=function(child){
  const root=document.getElementById("root");
  if(root&&root.contains(this)&&child&&child.parentNode!==this){
    console.warn("OdontoView DOM recovery: ignored stale removeChild", {parent:this,child});
    return child;
  }
  return nativeRemoveChild.call(this,child);
};
Node.prototype.insertBefore=function(newNode,referenceNode){
  const root=document.getElementById("root");
  if(root&&root.contains(this)&&referenceNode&&referenceNode.parentNode!==this){
    console.warn("OdontoView DOM recovery: repaired stale insertBefore", {parent:this,referenceNode});
    return this.appendChild(newNode);
  }
  return nativeInsertBefore.call(this,newNode,referenceNode);
};

// Network pilot must not be controlled by the legacy cache-first PWA worker.
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations().then(registrations=>{
    registrations.forEach(registration=>registration.unregister().catch(()=>{}));
  }).catch(()=>{});
}
if("caches" in window){
  caches.keys().then(keys=>Promise.all(
    keys.filter(key=>/^odontoview-(shell|runtime)-v/i.test(key)).map(key=>caches.delete(key))
  )).catch(()=>{});
}

const rootEl=document.getElementById("root");
const fallback=document.getElementById("startup-fallback");
if(fallback)fallback.remove();
window.__ODONTOVIEW_STARTED__=true;

/*
 * Viewer 2.0 owns imperative canvas state and integrates browser-side DICOM
 * libraries. StrictMode intentionally stays off here: its development-only
 * double mount/unmount cycle can conflict with imperative DOM/canvas consumers
 * and browser translation extensions, producing NotFoundError/removeChild.
 */
ReactDOM.createRoot(rootEl).render(
  <AppErrorBoundary>
    <BrowserRouter><App/></BrowserRouter>
  </AppErrorBoundary>
);
