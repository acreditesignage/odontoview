import React,{useEffect,useRef,useState} from "react";
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

function buildTransferFunctions(stats,presetName,opacityScale,denseBoost){
  const cfg=PRESETS[presetName]||PRESETS.clinical;
  const ctf=vtkColorTransferFunction.newInstance();
  cfg.colors.forEach(([key,r,g,b])=>ctf.addRGBPoint(stats[key],r,g,b));
  const ofun=vtkPiecewiseFunction.newInstance();
  cfg.opacity.forEach(([key,value])=>{
    const boost=denseBoost&&(key==="dense"||key==="max")?1.28:1;
    ofun.addPoint(stats[key],clamp(value*opacityScale*boost,0,1));
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
  actor.getProperty().setAmbient(.35);
  actor.getProperty().setDiffuse(.75);
  actor.getProperty().setSpecular(.45);
  actor.getProperty().setSpecularPower(24);
  return {actor,tube,mapper,poly,pts,lines};
}

export default function Viewer3DPanel({volume,meta,nervePoints=[],curve=[]}){
  const hostRef=useRef(null);
  const genericRef=useRef(null);
  const rendererRef=useRef(null);
  const renderWindowRef=useRef(null);
  const imageDataRef=useRef(null);
  const volumeActorRef=useRef(null);
  const mapperRef=useRef(null);
  const statsRef=useRef(null);
  const nerveActorRef=useRef(null);

  const [ready,setReady]=useState(false);
  const [status,setStatus]=useState("Preparando GPU Volume Rendering…");
  const [preset,setPreset]=useState("clinical");
  const [volumeVisible,setVolumeVisible]=useState(true);
  const [nerveVisible,setNerveVisible]=useState(true);
  const [denseBoost,setDenseBoost]=useState(true);
  const [lighting,setLighting]=useState(true);
  const [opacityScale,setOpacityScale]=useState(1);

  function renderNow(){renderWindowRef.current?.render?.()}

  function applyPreset(name=preset){
    const actor=volumeActorRef.current,stats=statsRef.current,renderer=rendererRef.current;
    if(!actor||!stats||!renderer)return;
    const {cfg,ctf,ofun}=buildTransferFunctions(stats,name,opacityScale,denseBoost);
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

    applyPreset("clinical");
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
      renderer.removeVolume(actor);
      nerveActorRef.current=null;
      generic.delete();
      genericRef.current=null;rendererRef.current=null;renderWindowRef.current=null;
      imageDataRef.current=null;volumeActorRef.current=null;mapperRef.current=null;statsRef.current=null;
    };
  },[volume,meta]);

  useEffect(()=>{applyPreset(preset)},[preset,opacityScale,denseBoost,lighting]);

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
    const radius=Math.max(.45,Math.min(meta.spacingX,meta.spacingY,meta.spacingZ)*3.4);
    const bundle=createTubeActor(pts,radius,[1,.08,.08]);
    if(bundle){
      renderer.addActor(bundle.actor);
      nerveActorRef.current=bundle;
      renderNow();
    }
  },[nervePoints,curve,meta,nerveVisible]);

  return <div className="viewer3d-panel viewer3d-v2">
    <div className="viewer3d-stage" ref={hostRef}>
      {!ready&&<div className="viewer3d-loading"><span className="viewer3d-orbit">◌</span><strong>OdontoView 3D Engine v2</strong><small>{status}</small></div>}
      {ready&&<div className="viewer3d-status">{status}</div>}
      {ready&&<div className="viewer3d-engine-badge">VTK.js • GPU</div>}
    </div>
    <div className="viewer3d-controls">
      <div className="viewer3d-presets" role="group" aria-label="Presets 3D">
        {Object.entries(PRESETS).map(([key,cfg])=><button key={key} className={preset===key?"active":""} onClick={()=>setPreset(key)}>{cfg.label}</button>)}
      </div>
      <div className="viewer3d-switches">
        <button className={volumeVisible?"active":""} onClick={()=>setVolumeVisible(v=>!v)}>Volume</button>
        <button className={denseBoost?"active":""} onClick={()=>setDenseBoost(v=>!v)}>Realçar denso</button>
        <button className={nerveVisible?"active nerve":""} onClick={()=>setNerveVisible(v=>!v)}>Nervo</button>
        <button className={lighting?"active":""} onClick={()=>setLighting(v=>!v)}>Shading</button>
      </div>
      <label className="viewer3d-opacity">
        <span>Intensidade do volume</span>
        <input type="range" min=".45" max="1.55" step=".05" value={opacityScale} onChange={e=>setOpacityScale(Number(e.target.value))}/>
        <b>{Math.round(opacityScale*100)}%</b>
      </label>
      <div className="viewer3d-views">
        <button onClick={()=>setView("oblique")}>3/4</button>
        <button onClick={()=>setView("side")}>Lateral</button>
        <button onClick={()=>setView("front")}>Frontal</button>
        <button onClick={()=>setView("top")}>Superior</button>
      </div>
    </div>
  </div>;
}
