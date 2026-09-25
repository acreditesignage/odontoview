const BASE=import.meta.env.VITE_API_URL||(import.meta.env.PROD?"":"http://localhost:3001");
export async function api(path,options={}){const headers={"Content-Type":"application/json",...(options.headers||{})};const token=localStorage.getItem("odontoview_token");if(token)headers.Authorization="Bearer "+token;const r=await fetch(BASE+path,{...options,headers});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||"Operação não concluída.");return data;}


export async function apiBinary(path,body,headers={}){
  const token=localStorage.getItem("odontoview_token");
  const finalHeaders={...headers};
  if(token)finalHeaders.Authorization="Bearer "+token;
  const r=await fetch(BASE+path,{method:"PUT",body,headers:finalHeaders});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||"Upload não concluído.");
  return data;
}

export async function apiBlob(path,options={}){
  const headers={...(options.headers||{})};
  const token=localStorage.getItem("odontoview_token");
  if(token)headers.Authorization="Bearer "+token;
  const r=await fetch(BASE+path,{...options,headers});
  if(!r.ok){
    const data=await r.json().catch(()=>({}));
    throw new Error(data.error||"Arquivo não disponível.");
  }
  return r.blob();
}
