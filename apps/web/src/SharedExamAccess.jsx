import React,{useEffect,useState} from "react";
import {useNavigate,useSearchParams} from "react-router-dom";
import QRCode from "qrcode";
import {api,apiBlob} from "./api.js";
import {importExam} from "./ingest.js";
import {isDicomStudySource} from "./examUpload.js";
import DocumentationWorkspace from "./DocumentationWorkspace.jsx";
import {setViewerSession} from "./viewerSession.js";

function viewerRoute(origin,returnTo){
  const params=new URLSearchParams({from:origin,returnTo});
  return "/viewer2?"+params.toString();
}

export default function SharedExamAccess(){
  const [q]=useSearchParams();
  const nav=useNavigate();
  const token=q.get("token");
  const [meta,setMeta]=useState(null);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState("");
  const [qr,setQr]=useState("");
  const [gallery,setGallery]=useState(null);

  useEffect(()=>{
    if(!token){setErr("Link incompleto.");return}
    api("/api/public/dentist-invites/"+encodeURIComponent(token))
      .then(setMeta)
      .catch(e=>setErr(e.message));
    const url=location.origin+"/acesso-exame?token="+encodeURIComponent(token);
    QRCode.toDataURL(url,{width:280,margin:1,errorCorrectionLevel:"M"})
      .then(setQr)
      .catch(()=>setQr(""));
  },[token]);

  useEffect(()=>{
    return()=>{gallery?.items?.forEach(item=>item.url&&URL.revokeObjectURL(item.url))};
  },[gallery?.study?.id]);

  async function openSharedExam(){
    if(!token||busy)return;
    setBusy(true);setErr("");setProgress("Preparando exame…");
    try{
      const manifest=await api("/api/public/dentist-invites/"+encodeURIComponent(token)+"/study");
      if(isDicomStudySource(manifest.study?.sourceType)){
        const files=new Array(manifest.files.length);
        let cursor=0,done=0;
        const worker=async()=>{
          while(true){
            const i=cursor++;
            if(i>=manifest.files.length)return;
            const fileMeta=manifest.files[i];
            const blob=await apiBlob("/api/public/dentist-invites/"+encodeURIComponent(token)+"/study/files/"+fileMeta.id);
            files[i]=new File(
              [blob],
              fileMeta.fileName||("dicom-"+String(i+1).padStart(4,"0")+".dcm"),
              {type:"application/dicom"}
            );
            done++;
            setProgress("Carregando "+done+"/"+manifest.files.length);
          }
        };
        await Promise.all(Array.from({length:Math.min(5,manifest.files.length)},()=>worker()));
        const result=await importExam(files);
        setViewerSession({
          result,
          order:{patient:manifest.patient,examType:manifest.examType||{name:"Exame odontológico"},unit:manifest.unit||null},
          shared:true
        });
        nav(viewerRoute("shared","/acesso-exame?token="+encodeURIComponent(token)));
        return;
      }

      const items=await Promise.all((manifest.files||[]).map(async fileMeta=>{
        const blob=await apiBlob("/api/public/dentist-invites/"+encodeURIComponent(token)+"/study/files/"+fileMeta.id);
        const typed=new Blob([blob],{type:fileMeta.contentType||blob.type||"application/octet-stream"});
        return {
          ...fileMeta,
          blob:typed,
          contentType:typed.type||fileMeta.contentType||"application/octet-stream",
          url:URL.createObjectURL(typed),
          previewKind:(typed.type||"").startsWith("image/")?"image":typed.type==="application/pdf"?"pdf":"file"
        };
      }));
      setGallery({
        study:manifest.study,
        patient:manifest.patient,
        examType:manifest.examType,
        unit:manifest.unit,
        order:manifest.order,
        items,
        activeIndex:0
      });
    }catch(e){
      setErr(e.message||"Não foi possível abrir o exame.");
    }finally{
      setBusy(false);setProgress("");
    }
  }

  if(gallery){
    return <main className="page shared-exam-page">
      <DocumentationWorkspace gallery={gallery} setGallery={setGallery} onClose={()=>setGallery(null)}/>
    </main>;
  }

  if(err){
    return <main className="page centered shared-exam-page">
      <section className="card auth">
        <div className="shared-exam-brand">Odonto<span>View</span></div>
        <h2>Exame indisponível</h2>
        <p>{err}</p>
      </section>
    </main>;
  }

  if(!meta)return <main className="page centered">Carregando acesso seguro…</main>;

  return <main className="page centered shared-exam-page">
    <section className="card shared-exam-card">
      <div className="shared-exam-brand">Odonto<span>View</span></div>
      <p className="eyebrow">EXAME DISPONÍVEL</p>
      <h1>{meta.invite.study?.examType?.name||"Exame odontológico"}</h1>
      <p>Paciente: <strong>{meta.invite.patient.name}</strong></p>
      {meta.invite.unit&&<p className="muted">{meta.invite.unit.organization} • {meta.invite.unit.name}</p>}
      <div className="shared-exam-access">
        <div>
          <strong>Acesso direto ao OdontoView Viewer</strong>
          <p>Use o botão abaixo ou leia o QR Code. Este link é pessoal e protegido.</p>
          <button className="primary" disabled={busy||!meta.invite.study} onClick={openSharedExam}>
            {busy?(progress||"Abrindo…"):"Abrir exame no Viewer"}
          </button>
        </div>
        {qr&&<img src={qr} alt="QR Code para abrir o exame no OdontoView"/>}
      </div>
      <p className="shared-exam-expiry">Acesso válido até {new Date(meta.invite.expiresAt).toLocaleDateString("pt-BR")}.</p>
    </section>
  </main>;
}
