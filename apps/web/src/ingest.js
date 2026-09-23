import * as dicomParserModule from "dicom-parser";

const dicomParser=dicomParserModule.default||dicomParserModule;
const scriptLoads=new Map();

function loadScript(src){
  if(scriptLoads.has(src)) return scriptLoads.get(src);
  const promise=new Promise((resolve,reject)=>{
    const existing=document.querySelector(`script[data-odontoview-ingest="${src}"]`);
    if(existing){
      if(existing.dataset.loaded==="true") return resolve();
      existing.addEventListener("load",()=>resolve(),{once:true});
      existing.addEventListener("error",()=>reject(new Error("Falha ao carregar o motor de importação.")),{once:true});
      return;
    }
    const script=document.createElement("script");
    script.src=src;
    script.async=true;
    script.dataset.odontoviewIngest=src;
    script.addEventListener("load",()=>{script.dataset.loaded="true";resolve()},{once:true});
    script.addEventListener("error",()=>reject(new Error("Falha ao carregar o motor de importação.")),{once:true});
    document.head.appendChild(script);
  });
  scriptLoads.set(src,promise);
  return promise;
}

async function ensureLegacyIngest(){
  await loadScript("/legacy-ingest/js/archive-import.js");
  await loadScript("/legacy-ingest/js/dicom-metadata.js");
  if(!window.OdontoArchiveImport||!window.OdontoDicomMetadata) throw new Error("Motor OdontoView Ingest indisponível.");
}

function clean(value){return String(value||"").replace(/\0/g,"").trim()}

async function readDicomMetadata(file,index){
  const buffer=await file.arrayBuffer();
  const dataSet=dicomParser.parseDicom(new Uint8Array(buffer));
  const base=window.OdontoDicomMetadata.readDataSet(dataSet);
  return {
    ...base,
    fileIndex:index,
    fileName:file.name,
    fileSize:file.size,
    modality:clean(dataSet.string("x00080060")),
    manufacturer:clean(dataSet.string("x00080070")),
    manufacturerModel:clean(dataSet.string("x00081090")),
    studyDate:clean(dataSet.string("x00080020"))
  };
}

function seriesSummary(series,index){
  const first=series.items[0]||{};
  return {
    index,
    valid:series.valid,
    files:series.items.length,
    description:first.seriesDescription||first.protocolName||`Série ${index+1}`,
    modality:first.modality||"DICOM",
    manufacturer:first.manufacturer||"Não informado",
    model:first.manufacturerModel||"",
    dimensions:first.rows&&first.columns?`${first.rows} × ${first.columns}`:"",
    slices:series.items.length,
    nominalSpacing:series.nominalSpacing,
    warnings:series.warnings||[],
    errors:series.errors||[]
  };
}

export async function importExam(selectedFiles,{onProgress}={}){
  await ensureLegacyIngest();
  const incoming=Array.from(selectedFiles||[]);
  if(!incoming.length) throw new Error("Selecione um exame.");

  const archives=incoming.filter(file=>window.OdontoArchiveImport.isArchive(file));
  if(archives.length>1 || (archives.length===1&&incoming.length>1)){
    throw new Error("Abra um ZIP ou RAR por vez. Para DICOM solto, selecione os cortes juntos.");
  }

  let files=incoming;
  let sourceType="DICOM";
  if(archives.length===1){
    sourceType=/\.rar$/i.test(archives[0].name)?"RAR":"ZIP";
    files=await window.OdontoArchiveImport.extract(archives[0],{
      onProgress:progress=>onProgress?.({phase:"extract",...progress})
    });
  }

  files=files.filter(file=>file.name.split("/").pop().toUpperCase()!=="DICOMDIR");
  if(!files.length) throw new Error("Nenhum arquivo DICOM encontrado.");

  const parsed=[];
  const failed=[];
  for(let i=0;i<files.length;i++){
    onProgress?.({phase:"metadata",current:i+1,total:files.length});
    try{
      parsed.push(await readDicomMetadata(files[i],i));
    }catch(error){
      failed.push({fileName:files[i].name,message:error?.message||"DICOM inválido"});
    }
  }
  if(!parsed.length) throw new Error("Os arquivos selecionados não puderam ser lidos como DICOM.");

  const report=window.OdontoDicomMetadata.validateImport(parsed);
  const series=report.series.map(seriesSummary);
  return {
    sourceType,
    sourceName:archives[0]?.name||(`${files.length} arquivo(s) DICOM`),
    files,
    parsedFiles:parsed.length,
    failedFiles:failed,
    totalFiles:files.length,
    totalBytes:files.reduce((sum,file)=>sum+(file.size||0),0),
    series,
    seriesCount:series.length,
    validSeriesCount:series.filter(item=>item.valid).length,
    report
  };
}
