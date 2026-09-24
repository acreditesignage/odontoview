import React,{useEffect,useMemo,useRef,useState} from "react";
import "@kitware/vtk.js/Rendering/Profiles/Volume";

import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "@kitware/vtk.js/Common/DataModel/PiecewiseFunction";
import vtkVolume from "@kitware/vtk.js/Rendering/Core/Volume";
import vtkVolumeMapper from "@kitware/vtk.js/Rendering/Core/VolumeMapper";

import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkPoints from "@kitware/vtk.js/Common/Core/Points";
import vtkCellArray from "@kitware/vtk.js/Common/Core/CellArray";
import vtkTubeFilter from "@kitware/vtk.js/Filters/General/TubeFilter";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkSTLReader from "@kitware/vtk.js/IO/Geometry/STLReader";
import vtkPLYReader from "@kitware/vtk.js/IO/Geometry/PLYReader";
import {NEODENT_GM_LIBRARY} from "./implantLibrary.js";

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}

function sampledStats(volume){
  const values=[];
  const step=Math.max(1,Math.floor(volume.length/90000));
  for(let i=0;i<volume.length;i+=step)values.push(volume[i]);
  values.sort((a,b)=>a-b);
  const p=q=>values[Math.floor((values.length-1)*q)]||0;
  const raw=[p(.03),p(.48),p(.70),p(.84),p(.94),p(.985),p(.998)];
  for(let i=1;i<raw.length;i++)if(raw[i]<=raw[i-1])raw[i]=raw[i-1]+1;
  return {
    air:raw[0],soft:raw[1],trab:raw[2],bone:raw[3],
    cortical:raw[4],dense:raw[5],max:raw[6]
  };
}

const PRESETS={
  teethNerve:{
    label:"Dentes + nervo",bg:[.012,.020,.030],
    colors:[
      ["air",0,0,0],["soft",0,0,0],["trab",.10,.10,.10],
      ["bone",.18,.18,.18],["cortical",.82,.79,.72],["dense",1,.98,.90],["max",1,1,1]
    ],
    opacity:[["air",0],["soft",0],["trab",0],["bone",0],["cortical",.012],["dense",.74],["max",.96]],
    ambient:.48,diffuse:.68,specular:.58,specularPower:30
  },
  impacted:{
    label:"Incluso",bg:[.016,.026,.038],
    colors:[
      ["air",0,0,0],["soft",0,0,0],["trab",.20,.16,.12],
      ["bone",.45,.36,.27],["cortical",.92,.82,.68],["dense",1,.98,.88],["max",1,1,.98]
    ],
    opacity:[["air",0],["soft",0],["trab",.001],["bone",.004],["cortical",.035],["dense",.82],["max",1]],
    ambient:.44,diffuse:.72,specular:.55,specularPower:28
  },
  planning:{
    label:"Planejamento",bg:[.022,.04,.058],
    colors:[
      ["air",0,0,0],["soft",.07,.055,.05],["trab",.34,.25,.18],
      ["bone",.72,.58,.42],["cortical",.90,.78,.61],["dense",1,.97,.88],["max",1,1,.98]
    ],
    opacity:[["air",0],["soft",0],["trab",.002],["bone",.012],["cortical",.045],["dense",.58],["max",.84]],
    ambient:.40,diffuse:.72,specular:.36,specularPower:22
  },
  clinical:{
    label:"Clínico",bg:[.035,.055,.075],
    colors:[
      ["air",0,0,0],["soft",.11,.08,.065],["trab",.38,.27,.18],
      ["bone",.73,.57,.39],["cortical",.93,.80,.61],["dense",1,.96,.86],["max",1,1,.96]
    ],
    opacity:[["air",0],["soft",0],["trab",.008],["bone",.055],["cortical",.18],["dense",.52],["max",.72]],
    ambient:.32,diffuse:.78,specular:.32,specularPower:18
  },
  anatomic:{
    label:"Anatômico",bg:[.03,.045,.06],
    colors:[
      ["air",0,0,0],["soft",.08,.055,.045],["trab",.34,.22,.13],
      ["bone",.68,.50,.31],["cortical",.88,.70,.48],["dense",.98,.90,.76],["max",1,.98,.90]
    ],
    opacity:[["air",0],["soft",0],["trab",.014],["bone",.09],["cortical",.26],["dense",.58],["max",.78]],
    ambient:.26,diffuse:.82,specular:.24,specularPower:14
  },
  patient:{
    label:"Paciente",bg:[.055,.085,.11],
    colors:[
      ["air",0,0,0],["soft",.16,.10,.075],["trab",.48,.31,.17],
      ["bone",.82,.62,.38],["cortical",1,.84,.57],["dense",1,.98,.90],["max",1,1,1]
    ],
    opacity:[["air",0],["soft",0],["trab",.006],["bone",.045],["cortical",.16],["dense",.64],["max",.86]],
    ambient:.42,diffuse:.74,specular:.44,specularPower:24
  },
  translucent:{
    label:"Translúcido",bg:[.025,.045,.065],
    colors:[
      ["air",0,0,0],["soft",.06,.05,.04],["trab",.30,.23,.18],
      ["bone",.64,.53,.39],["cortical",.85,.73,.56],["dense",1,.95,.84],["max",1,1,.94]
    ],
    opacity:[["air",0],["soft",0],["trab",.003],["bone",.018],["cortical",.07],["dense",.42],["max",.66]],
    ambient:.38,diffuse:.70,specular:.34,specularPower:20
  },
  detail:{
    label:"Detalhe",bg:[.018,.028,.04],
    colors:[
      ["air",0,0,0],["soft",.04,.04,.04],["trab",.28,.26,.24],
      ["bone",.62,.60,.56],["cortical",.88,.86,.80],["dense",1,1,1],["max",1,1,1]
    ],
    opacity:[["air",0],["soft",0],["trab",.004],["bone",.035],["cortical",.17],["dense",.72],["max",.92]],
    ambient:.30,diffuse:.82,specular:.50,specularPower:30
  }
};

function buildTransferFunctions(stats,presetName,boneOpacityScale,denseBoost){
  const cfg=PRESETS[presetName]||PRESETS.clinical;
  const ctf=vtkColorTransferFunction.newInstance();
  cfg.colors.forEach(([key,r,g,b])=>ctf.addRGBPoint(stats[key],r,g,b));
  const ofun=vtkPiecewiseFunction.newInstance();
  cfg.opacity.forEach(([key,value])=>{
    const boost=denseBoost&&(key==="dense"||key==="max")?1.28:1;
    const boneScale=(key==="trab"||key==="bone"||key==="cortical")?boneOpacityScale:1;
    ofun.addPoint(stats[key],clamp(value*boneScale*boost,0,1));
  });
  return {cfg,ctf,ofun};
}

function nervePointToWorld(n,curve,meta){
  const c=curve[n.curveIndex];if(!c)return null;
  const prev=curve[Math.max(0,n.curveIndex-1)]||c;
  const next=curve[Math.min(curve.length-1,n.curveIndex+1)]||c;
  let tx=(next.x-prev.x)*meta.spacingX,ty=(next.y-prev.y)*meta.spacingY;
  const len=Math.hypot(tx,ty)||1;tx/=len;ty/=len;
  const nx=-ty,ny=tx;
  const x=c.x+nx*n.offsetMm/meta.spacingX;
  const y=c.y+ny*n.offsetMm/meta.spacingY;
  return [x*meta.spacingX,y*meta.spacingY,n.z*meta.spacingZ];
}

function createTubeActor(worldPoints,radius,color){
  if(worldPoints.length<2)return null;
  const pts=vtkPoints.newInstance();
  const flat=new Float32Array(worldPoints.length*3);
  worldPoints.forEach((p,i)=>{flat[i*3]=p[0];flat[i*3+1]=p[1];flat[i*3+2]=p[2]});
  pts.setData(flat,3);

  const ids=new Uint32Array(worldPoints.length+1);
  ids[0]=worldPoints.length;
  for(let i=0;i<worldPoints.length;i++)ids[i+1]=i;

  const lines=vtkCellArray.newInstance({values:ids});
  const poly=vtkPolyData.newInstance();
  poly.setPoints(pts);
  poly.setLines(lines);

  const tube=vtkTubeFilter.newInstance({radius,numberOfSides:16,capping:true});
  tube.setInputData(poly);
  const mapper=vtkMapper.newInstance();
  mapper.setInputConnection(tube.getOutputPort());
  const actor=vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setColor(...color);
  actor.getProperty().setOpacity(1);
  actor.getProperty().setAmbient(1);
  actor.getProperty().setDiffuse(.22);
  actor.getProperty().setSpecular(.18);
  actor.getProperty().setSpecularPower(10);
  return {actor,tube,mapper,poly,pts,lines};
}

function createParametricImplantBundle(implant,active){
  const segments=72;
  const radius=Math.max(.4,Number(implant.diameter)||3.5)/2;
  const length=Math.max(4,Number(implant.length)||10);
  const pitch=Math.max(.65,Math.min(1.05,(Number(implant.diameter)||3.5)*.22));
  const threadHeight=Math.max(.10,Math.min(.22,radius*.13));
  const collar=Math.min(1.15,length*.11);
  const axialSteps=Math.max(44,Math.round(length/.18));
  const points=[];
  const rings=[];
  for(let j=0;j<=axialSteps;j++){
    const t=j/axialSteps;
    const z=length/2-t*length;
    const fromTop=t*length;
    let bodyRadius=radius*.90;
    if(fromTop<collar)bodyRadius=radius*(.98-.05*(fromTop/collar));
    const apexStart=.78;
    if(t>apexStart){
      const q=(t-apexStart)/(1-apexStart);
      bodyRadius*=1-q*.62;
    }
    const ringStart=points.length;
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2;
      let ridge=0;
      if(fromTop>collar*.82&&t<.985){
        const phase=a-(fromTop/pitch)*Math.PI*2;
        const crest=Math.max(0,Math.cos(phase));
        ridge=Math.pow(crest,8)*threadHeight;
      }
      const micro=Math.sin(a*3+fromTop*.55)*threadHeight*.05;
      const r=Math.max(radius*.24,bodyRadius+ridge+micro);
      points.push([Math.cos(a)*r,Math.sin(a)*r,z]);
    }
    rings.push(ringStart);
  }
  const topCenter=points.length;points.push([0,0,length/2]);
  const tipCenter=points.length;points.push([0,0,-length/2]);
  const cells=[];
  for(let j=0;j<rings.length-1;j++){
    const a0=rings[j],b0=rings[j+1];
    for(let i=0;i<segments;i++){
      const n=(i+1)%segments;
      cells.push(3,a0+i,b0+i,b0+n,3,a0+i,b0+n,a0+n);
    }
  }
  for(let i=0;i<segments;i++){
    const n=(i+1)%segments;
    cells.push(3,topCenter,rings[0]+n,rings[0]+i);
    const last=rings[rings.length-1];
    cells.push(3,tipCenter,last+i,last+n);
  }
  const flat=new Float32Array(points.length*3);
  points.forEach((p,i)=>{flat[i*3]=p[0];flat[i*3+1]=p[1];flat[i*3+2]=p[2]});
  const poly=vtkPolyData.newInstance();
  const vtkPts=vtkPoints.newInstance();vtkPts.setData(flat,3);poly.setPoints(vtkPts);
  poly.setPolys(vtkCellArray.newInstance({values:new Uint32Array(cells)}));
  const mapper=vtkMapper.newInstance();mapper.setInputData(poly);
  const actor=vtkActor.newInstance();actor.setMapper(mapper);
  actor.setPosition(implant.x,implant.y,implant.z);
  actor.setOrientation(implant.rx||0,implant.ry||0,implant.rz||0);
  const prop=actor.getProperty();
  prop.setColor(...(active?[.08,.92,.82]:[.88,.72,.34]));
  prop.setOpacity(active ? .98 : .90);
  prop.setAmbient(.26);prop.setDiffuse(.80);prop.setSpecular(.86);prop.setSpecularPower(46);
  return {actor,mapper,poly,points:vtkPts};
}

export default function Viewer3DPanel({volume,meta,nervePoints=[],curve=[],cursor=null,implants=[],activeImplantId=null,onImplantsChange=()=>{},onActiveImplantChange=()=>{},layoutMode="mosaic"}){
  const hostRef=useRef(null);
  const genericRef=useRef(null);
  const rendererRef=useRef(null);
  const renderWindowRef=useRef(null);
  const imageDataRef=useRef(null);
  const volumeActorRef=useRef(null);
  const mapperRef=useRef(null);
  const statsRef=useRef(null);
  const nerveActorRef=useRef(null);
  const scanActorRef=useRef(null);
  const scanInitialRef=useRef(null);
  const scanInputRef=useRef(null);

  const [ready,setReady]=useState(false);
  const [status,setStatus]=useState("Preparando GPU Volume Rendering…");
  const [preset,setPreset]=useState("planning");
  const [volumeVisible,setVolumeVisible]=useState(true);
  const [nerveVisible,setNerveVisible]=useState(true);
  const [denseBoost,setDenseBoost]=useState(true);
  const [lighting,setLighting]=useState(true);
  const [boneOpacityScale,setBoneOpacityScale]=useState(.68);
  const [scanName,setScanName]=useState("");
  const [scanStatus,setScanStatus]=useState("Nenhum scan intraoral carregado.");
  const [scanVisible,setScanVisible]=useState(true);
  const [scanOpacity,setScanOpacity]=useState(.96);
  const [scanTransform,setScanTransform]=useState({x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1});
  const implantActorsRef=useRef([]);
  const [implantCatalogId,setImplantCatalogId]=useState(NEODENT_GM_LIBRARY[0]?.id||"");
  const selectedCatalogImplant=useMemo(()=>NEODENT_GM_LIBRARY.find(x=>x.id===implantCatalogId)||NEODENT_GM_LIBRARY[0],[implantCatalogId]);
  const implantGroups=useMemo(()=>{
    const map=new Map();
    NEODENT_GM_LIBRARY.forEach(item=>{
      if(!map.has(item.familyLabel))map.set(item.familyLabel,[]);
      map.get(item.familyLabel).push(item);
    });
    return [...map.entries()];
  },[]);
  const activeImplant=implants.find(x=>x.id===activeImplantId)||null;

  function renderNow(){renderWindowRef.current?.render?.()}

  function disposeImplants(){
    const renderer=rendererRef.current;
    implantActorsRef.current.forEach(bundle=>{
      if(bundle?.actor&&renderer)renderer.removeActor(bundle.actor);
      bundle?.actor?.delete?.();bundle?.mapper?.delete?.();bundle?.poly?.delete?.();bundle?.points?.delete?.();
    });
    implantActorsRef.current=[];
  }

  function disposeScan(){
    const renderer=rendererRef.current,bundle=scanActorRef.current;
    if(bundle?.actor&&renderer)renderer.removeActor(bundle.actor);
    if(bundle){
      bundle.actor?.delete?.();
      bundle.mapper?.delete?.();
      bundle.reader?.delete?.();
    }
    scanActorRef.current=null;
  }

  async function importIntraoralScan(file){
    const renderer=rendererRef.current,img=imageDataRef.current;
    if(!file||!renderer||!img)return;
    const ext=(file.name.split(".").pop()||"").toLowerCase();
    if(ext!=="stl"&&ext!=="ply"){
      setScanStatus("Formato ainda não suportado. Use STL ou PLY.");
      return;
    }
    setScanStatus("Lendo scan intraoral localmente…");
    try{
      const buffer=await file.arrayBuffer();
      const reader=ext==="stl"?vtkSTLReader.newInstance():vtkPLYReader.newInstance();
      reader.parseAsArrayBuffer(buffer);
      const poly=reader.getOutputData(0);
      if(!poly)throw new Error("Malha vazia.");
      const bounds=poly.getBounds();
      if(!bounds||bounds.some(v=>!Number.isFinite(v)))throw new Error("Malha inválida.");

      disposeScan();

      const mapper=vtkMapper.newInstance();
      mapper.setInputData(poly);
      const actor=vtkActor.newInstance();
      actor.setMapper(mapper);
      const prop=actor.getProperty();
      prop.setColor(.97,.94,.86);
      prop.setOpacity(scanOpacity);
      prop.setAmbient(.34);
      prop.setDiffuse(.76);
      prop.setSpecular(.52);
      prop.setSpecularPower(26);

      const mc=[(bounds[0]+bounds[1])/2,(bounds[2]+bounds[3])/2,(bounds[4]+bounds[5])/2];
      const me=Math.max(bounds[1]-bounds[0],bounds[3]-bounds[2],bounds[5]-bounds[4])||1;
      const vb=img.getBounds();
      const vc=[(vb[0]+vb[1])/2,(vb[2]+vb[3])/2,(vb[4]+vb[5])/2];
      const ve=Math.max(vb[1]-vb[0],vb[3]-vb[2],vb[5]-vb[4])||100;
      const initialScale=(me>ve*4||me<ve*.08)?(ve*.65/me):1;

      actor.setOrigin(...mc);
      actor.setPosition(...vc);
      actor.setOrientation(0,0,0);
      actor.setScale(initialScale,initialScale,initialScale);
      renderer.addActor(actor);

      const next={x:vc[0],y:vc[1],z:vc[2],rx:0,ry:0,rz:0,scale:initialScale};
      scanActorRef.current={actor,mapper,reader,poly};
      scanInitialRef.current={...next};
      setScanTransform(next);
      setScanName(file.name);
      setScanVisible(true);
      setScanStatus("Scan carregado • pré-alinhamento por centro/escala concluído • refine manualmente antes de uso clínico.");
      renderer.resetCameraClippingRange();
      renderNow();
    }catch(e){
      setScanStatus("Falha ao abrir o scan: "+(e?.message||"arquivo inválido"));
    }
  }

  function updateScanTransform(patch){
    setScanTransform(prev=>({...prev,...(typeof patch==="function"?patch(prev):patch)}));
  }

  function moveScan(axis,delta){
    updateScanTransform(prev=>({[axis]:prev[axis]+delta}));
  }

  function rotateScan(axis,delta){
    const key="r"+axis;
    updateScanTransform(prev=>({[key]:prev[key]+delta}));
  }

  function scaleScan(factor){
    updateScanTransform(prev=>({scale:Math.max(.01,prev.scale*factor)}));
  }

  function resetScanAlignment(){
    if(scanInitialRef.current)setScanTransform({...scanInitialRef.current});
  }

  function addImplant(){
    const item=selectedCatalogImplant,m=metaRefFallback();
    if(!item||!m)return;
    const c=cursor||{x:m.w/2,y:m.h/2,z:m.d/2};
    const next={
      id:(globalThis.crypto?.randomUUID?.()||("implant-"+Date.now()+"-"+Math.random().toString(36).slice(2))),
      catalogId:item.id,manufacturer:item.manufacturer,connection:item.connection,
      family:item.family,familyLabel:item.familyLabel,model:item.model,
      diameter:item.diameter,length:item.length,geometry:item.geometry,geometryValidated:false,
      x:c.x*m.spacingX,y:c.y*m.spacingY,z:c.z*m.spacingZ,rx:0,ry:0,rz:0
    };
    onImplantsChange([...implants,next]);
    onActiveImplantChange(next.id);
  }

  function metaRefFallback(){return meta}

  function updateActiveImplant(patch){
    if(!activeImplantId)return;
    onImplantsChange(implants.map(item=>item.id===activeImplantId?{...item,...(typeof patch==="function"?patch(item):patch)}:item));
  }
  function moveImplant(axis,delta){updateActiveImplant(item=>({[axis]:(item[axis]||0)+delta}))}
  function rotateImplant(axis,delta){const key="r"+axis;updateActiveImplant(item=>({[key]:(item[key]||0)+delta}))}
  function removeActiveImplant(){
    if(!activeImplantId)return;
    const next=implants.filter(item=>item.id!==activeImplantId);
    onImplantsChange(next);onActiveImplantChange(next[0]?.id||null);
  }

  function choosePreset(name){
    setPreset(name);
    if(name==="teethNerve"){
      setBoneOpacityScale(.2);
      setDenseBoost(true);
      setNerveVisible(true);
    }else if(name==="impacted"){
      setBoneOpacityScale(.25);
      setDenseBoost(true);
      setNerveVisible(true);
    }
  }

  function applyPreset(name=preset){
    const actor=volumeActorRef.current,stats=statsRef.current,renderer=rendererRef.current;
    if(!actor||!stats||!renderer)return;
    const {cfg,ctf,ofun}=buildTransferFunctions(stats,name,boneOpacityScale,denseBoost);
    const prop=actor.getProperty();
    prop.setRGBTransferFunction(0,ctf);
    prop.setScalarOpacity(0,ofun);
    prop.setInterpolationTypeToLinear();
    prop.setShade(lighting);
    prop.setAmbient(cfg.ambient);
    prop.setDiffuse(cfg.diffuse);
    prop.setSpecular(cfg.specular);
    prop.setSpecularPower(cfg.specularPower);
    renderer.setBackground(...cfg.bg);
    renderNow();
  }

  function setView(kind){
    const renderer=rendererRef.current,img=imageDataRef.current;
    if(!renderer||!img)return;
    const b=img.getBounds(),c=[(b[0]+b[1])/2,(b[2]+b[3])/2,(b[4]+b[5])/2];
    const sx=b[1]-b[0],sy=b[3]-b[2],sz=b[5]-b[4],r=Math.max(sx,sy,sz)||100;
    const cam=renderer.getActiveCamera();
    cam.setFocalPoint(...c);
    if(kind==="front"){cam.setPosition(c[0],c[1]-r*2.15,c[2]);cam.setViewUp(0,0,1)}
    if(kind==="side"){cam.setPosition(c[0]+r*2.15,c[1],c[2]);cam.setViewUp(0,0,1)}
    if(kind==="top"){cam.setPosition(c[0],c[1],c[2]+r*2.15);cam.setViewUp(0,-1,0)}
    if(kind==="oblique"){cam.setPosition(c[0]+r*1.55,c[1]-r*1.35,c[2]+r*.75);cam.setViewUp(0,0,1)}
    renderer.resetCameraClippingRange();
    renderNow();
  }

  useEffect(()=>{
    if(!hostRef.current||!volume||!meta)return;
    let cancelled=false;
    setReady(false);
    setStatus("Carregando o volume CBCT completo na GPU…");

    const host=hostRef.current;
    const generic=vtkGenericRenderWindow.newInstance({background:[.035,.055,.075]});
    generic.setContainer(host);
    generic.resize();

    const renderer=generic.getRenderer();
    const renderWindow=generic.getRenderWindow();

    const imageData=vtkImageData.newInstance();
    imageData.setDimensions(meta.w,meta.h,meta.d);
    imageData.setSpacing(meta.spacingX,meta.spacingY,meta.spacingZ);
    imageData.setOrigin(0,0,0);
    const scalars=vtkDataArray.newInstance({
      name:"CBCT",
      numberOfComponents:1,
      values:volume
    });
    imageData.getPointData().setScalars(scalars);

    const mapper=vtkVolumeMapper.newInstance();
    mapper.setInputData(imageData);
    mapper.setAutoAdjustSampleDistances(true);
    mapper.setSampleDistance(Math.max(.18,Math.min(meta.spacingX,meta.spacingY,meta.spacingZ)*1.25));

    const actor=vtkVolume.newInstance();
    actor.setMapper(mapper);
    renderer.addVolume(actor);

    genericRef.current=generic;
    rendererRef.current=renderer;
    renderWindowRef.current=renderWindow;
    imageDataRef.current=imageData;
    volumeActorRef.current=actor;
    mapperRef.current=mapper;
    statsRef.current=sampledStats(volume);

    const prop=actor.getProperty();
    prop.setScalarOpacityUnitDistance(0,Math.max(.4,Math.min(meta.spacingX,meta.spacingY,meta.spacingZ)*2.2));

    applyPreset("planning");
    renderer.resetCamera();
    setView("oblique");
    renderWindow.render();

    const ro=new ResizeObserver(()=>{generic.resize();renderWindow.render()});
    ro.observe(host);

    if(!cancelled){
      setReady(true);
      setStatus("GPU Volume Rendering • CBCT completo • interação em tempo real");
    }

    return()=>{
      cancelled=true;
      ro.disconnect();
      if(nerveActorRef.current?.actor)renderer.removeActor(nerveActorRef.current.actor);
      disposeScan();
      renderer.removeVolume(actor);
      nerveActorRef.current=null;
      generic.delete();
      genericRef.current=null;rendererRef.current=null;renderWindowRef.current=null;
      imageDataRef.current=null;volumeActorRef.current=null;mapperRef.current=null;statsRef.current=null;
    };
  },[volume,meta]);

  useEffect(()=>{applyPreset(preset)},[preset,boneOpacityScale,denseBoost,lighting]);

  useEffect(()=>{
    const generic=genericRef.current,renderer=rendererRef.current,window=renderWindowRef.current;
    if(!generic||!renderer||!window)return;
    let raf1=0,raf2=0,timer=0;
    const resize=()=>{
      generic.resize();
      renderer.resetCameraClippingRange();
      window.render();
    };
    raf1=requestAnimationFrame(()=>{
      resize();
      raf2=requestAnimationFrame(resize);
    });
    timer=setTimeout(resize,180);
    return()=>{cancelAnimationFrame(raf1);cancelAnimationFrame(raf2);clearTimeout(timer)};
  },[layoutMode]);

  useEffect(()=>{
    if(volumeActorRef.current){volumeActorRef.current.setVisibility(volumeVisible);renderNow()}
  },[volumeVisible]);

  useEffect(()=>{
    const renderer=rendererRef.current;if(!renderer||!meta)return;
    if(nerveActorRef.current?.actor){
      renderer.removeActor(nerveActorRef.current.actor);
      nerveActorRef.current=null;
    }
    if(!nerveVisible||nervePoints.length<2||curve.length<2){renderNow();return}
    const pts=nervePoints.map(n=>nervePointToWorld(n,curve,meta)).filter(Boolean);
    const radius=Math.max(1.05,Math.min(meta.spacingX,meta.spacingY,meta.spacingZ)*5.8);
    const bundle=createTubeActor(pts,radius,[1,.08,.08]);
    if(bundle){
      renderer.addActor(bundle.actor);
      nerveActorRef.current=bundle;
      renderNow();
    }
  },[nervePoints,curve,meta,nerveVisible]);

  useEffect(()=>{
    const actor=scanActorRef.current?.actor;
    if(!actor)return;
    actor.setVisibility(scanVisible);
    actor.getProperty().setOpacity(scanOpacity);
    actor.setPosition(scanTransform.x,scanTransform.y,scanTransform.z);
    actor.setOrientation(scanTransform.rx,scanTransform.ry,scanTransform.rz);
    actor.setScale(scanTransform.scale,scanTransform.scale,scanTransform.scale);
    rendererRef.current?.resetCameraClippingRange?.();
    renderNow();
  },[scanVisible,scanOpacity,scanTransform]);

  useEffect(()=>{
    const renderer=rendererRef.current;
    if(!renderer)return;
    disposeImplants();
    implantActorsRef.current=implants.map(implant=>{
      const bundle=createParametricImplantBundle(implant,implant.id===activeImplantId);
      renderer.addActor(bundle.actor);
      return bundle;
    });
    renderer.resetCameraClippingRange();
    renderNow();
    return()=>disposeImplants();
  },[implants,activeImplantId,ready]);

  return <div className="viewer3d-panel viewer3d-v2">
    <div className="viewer3d-stage" ref={hostRef}>
      {!ready&&<div className="viewer3d-loading"><span className="viewer3d-orbit">◌</span><strong>OdontoView 3D Engine v2</strong><small>{status}</small></div>}
      {ready&&<div className="viewer3d-status">{status}</div>}
      {ready&&<div className="viewer3d-engine-badge">VTK.js • GPU</div>}
    </div>
    <div className="viewer3d-controls">
      <div className="viewer3d-quickbar">
        <button type="button" className="viewer3d-add-scan" onClick={()=>scanInputRef.current?.click()}>＋ Adicionar scan intraoral</button>
        <span>{scanName?"Fusion ativo • "+scanName:"CBCT aberto • adicione STL/PLY para fusionar"}</span>
      </div>
      <div className="viewer3d-presets" role="group" aria-label="Presets 3D">
        {Object.entries(PRESETS).map(([key,cfg])=><button key={key} className={preset===key?"active":""} onClick={()=>choosePreset(key)}>{cfg.label}</button>)}
      </div>
      <div className="viewer3d-switches">
        <button className={volumeVisible?"active":""} onClick={()=>setVolumeVisible(v=>!v)}>Volume</button>
        <button className={denseBoost?"active":""} onClick={()=>setDenseBoost(v=>!v)}>Realçar denso</button>
        <button className={nerveVisible?"active nerve":""} onClick={()=>setNerveVisible(v=>!v)}>Nervo 3D {nervePoints.length?`• ${nervePoints.length}`:""}</button>
        <button className={lighting?"active":""} onClick={()=>setLighting(v=>!v)}>Shading</button>
      </div>
      {(preset==="teethNerve"||preset==="impacted")&&<div className="viewer3d-preset-note">
        {preset==="teethNerve"
          ?"Isolamento por densidade: prioriza dentes/estruturas densas + nervo. Não é segmentação dental automática."
          :"Modo incluso: reduz fortemente o osso e prioriza estruturas dentárias densas + nervo para localizar dentes retidos."}
      </div>}
      <label className="viewer3d-opacity">
        <span>Opacidade óssea</span>
        <input type="range" min=".2" max="1.15" step=".05" value={boneOpacityScale} onChange={e=>setBoneOpacityScale(Number(e.target.value))}/>
        <b>{Math.round(boneOpacityScale*100)}%</b>
      </label>
      <div className="viewer3d-views">
        <button onClick={()=>setView("oblique")}>3/4</button>
        <button onClick={()=>setView("side")}>Lateral</button>
        <button onClick={()=>setView("front")}>Frontal</button>
        <button onClick={()=>setView("top")}>Superior</button>
      </div>
      <div className="viewer3d-implant-planner">
        <div className="viewer3d-implant-head">
          <div><strong>Planejamento de implante • Beta</strong><small>Neodent Grand Morse • corpo cônico + rosca helicoidal beta</small></div>
          <button type="button" className="viewer3d-add-implant" onClick={addImplant}>＋ Inserir no cursor</button>
        </div>
        <label className="viewer3d-implant-select">
          <span>Implante</span>
          <select value={implantCatalogId} onChange={e=>setImplantCatalogId(e.target.value)}>
            {implantGroups.map(([label,items])=><optgroup key={label} label={label}>
              {items.map(item=><option value={item.id} key={item.id}>{item.model} • Ø {item.diameter} × {item.length} mm</option>)}
            </optgroup>)}
          </select>
        </label>
        <div className="viewer3d-implant-warning">Geometria beta procedural com corpo cônico e rosca helicoidal visual. Diâmetro/comprimento são nominais; rosca e superfície ainda não são a geometria oficial do fabricante e não devem orientar cirurgia.</div>
        {implants.length>0&&<div className="viewer3d-implant-list">
          {implants.map((item,index)=><button type="button" key={item.id} className={item.id===activeImplantId?"active":""} onClick={()=>onActiveImplantChange(item.id)}>
            <b>#{index+1}</b><span>{item.familyLabel} • {item.model}</span><small>Ø {item.diameter} × {item.length} mm</small>
          </button>)}
        </div>}
        {activeImplant&&<div className="viewer3d-implant-tools">
          <div className="viewer3d-implant-summary"><strong>{activeImplant.model}</strong><span>Ø {activeImplant.diameter} × {activeImplant.length} mm</span></div>
          <span>Posição fina • 0,25 mm — ou arraste o implante diretamente no axial/coronal/sagital</span>
          <div><button onClick={()=>moveImplant("x",-.25)}>X−</button><button onClick={()=>moveImplant("x",.25)}>X+</button><button onClick={()=>moveImplant("y",-.25)}>Y−</button><button onClick={()=>moveImplant("y",.25)}>Y+</button><button onClick={()=>moveImplant("z",-.25)}>Z−</button><button onClick={()=>moveImplant("z",.25)}>Z+</button></div>
          <span>Inclinação fina • 1°</span>
          <div><button onClick={()=>rotateImplant("x",-1)}>RX−</button><button onClick={()=>rotateImplant("x",1)}>RX+</button><button onClick={()=>rotateImplant("y",-1)}>RY−</button><button onClick={()=>rotateImplant("y",1)}>RY+</button><button onClick={()=>rotateImplant("z",-1)}>RZ−</button><button onClick={()=>rotateImplant("z",1)}>RZ+</button></div>
          <div className="viewer3d-implant-angle-sliders">
            <label>Inclinação X <input type="range" min="-45" max="45" step="1" value={activeImplant.rx||0} onChange={e=>updateActiveImplant({rx:Number(e.target.value)})}/><b>{Math.round(activeImplant.rx||0)}°</b></label>
            <label>Inclinação Y <input type="range" min="-45" max="45" step="1" value={activeImplant.ry||0} onChange={e=>updateActiveImplant({ry:Number(e.target.value)})}/><b>{Math.round(activeImplant.ry||0)}°</b></label>
          </div>
          <button type="button" className="viewer3d-remove-implant" onClick={removeActiveImplant}>Remover implante</button>
        </div>}
      </div>
      <div className="viewer3d-fusion">
        <input ref={scanInputRef} type="file" accept=".stl,.ply" hidden onChange={e=>{const file=e.target.files?.[0];if(file)importIntraoralScan(file);e.target.value=""}}/>
        <div className="viewer3d-fusion-head">
          <strong>OdontoView Fusion • CBCT + Scan</strong>
          <button type="button" onClick={()=>scanInputRef.current?.click()}>{scanName?"Trocar scan":"Importar scan STL/PLY"}</button>
          {scanName&&<button type="button" className={scanVisible?"active":""} onClick={()=>setScanVisible(v=>!v)}>{scanVisible?"Scan visível":"Mostrar scan"}</button>}
          {scanName&&<button type="button" onClick={resetScanAlignment}>Reaplicar pré-alinhamento</button>}
        </div>
        <small>{scanName?scanName+" • "+scanStatus:scanStatus}</small>
        {scanName&&<div className="viewer3d-fusion-tools">
          <span>Mover mm</span>
          <button onClick={()=>moveScan("x",-1)}>X−</button><button onClick={()=>moveScan("x",1)}>X+</button>
          <button onClick={()=>moveScan("y",-1)}>Y−</button><button onClick={()=>moveScan("y",1)}>Y+</button>
          <button onClick={()=>moveScan("z",-1)}>Z−</button><button onClick={()=>moveScan("z",1)}>Z+</button>
          <span>Rotacionar 5°</span>
          <button onClick={()=>rotateScan("x",-5)}>RX−</button><button onClick={()=>rotateScan("x",5)}>RX+</button>
          <button onClick={()=>rotateScan("y",-5)}>RY−</button><button onClick={()=>rotateScan("y",5)}>RY+</button>
          <button onClick={()=>rotateScan("z",-5)}>RZ−</button><button onClick={()=>rotateScan("z",5)}>RZ+</button>
          <span>Escala</span>
          <button onClick={()=>scaleScan(.95)}>−5%</button><button onClick={()=>scaleScan(1.05)}>+5%</button>
          <label>Opacidade <input type="range" min=".2" max="1" step=".05" value={scanOpacity} onChange={e=>setScanOpacity(Number(e.target.value))}/></label>
        </div>}
      </div>
    </div>
  </div>;
}
