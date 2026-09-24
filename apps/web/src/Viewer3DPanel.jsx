import React,{useEffect,useMemo,useRef,useState} from "react";
import "@kitware/vtk.js/Rendering/Profiles/Volume";
import "@kitware/vtk.js/Rendering/Profiles/Geometry";

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
import vtkRenderer from "@kitware/vtk.js/Rendering/Core/Renderer";
import vtkSTLReader from "@kitware/vtk.js/IO/Geometry/STLReader";
import vtkPLYReader from "@kitware/vtk.js/IO/Geometry/PLYReader";
import {NEODENT_GM_LIBRARY,implantAxisVector} from "./implantLibrary.js";

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
  implant:{
    label:"Implante",bg:[.012,.022,.032],
    colors:[
      ["air",0,0,0],["soft",.04,.04,.04],["trab",.22,.18,.14],
      ["bone",.55,.45,.34],["cortical",.80,.70,.58],["dense",.95,.91,.82],["max",1,.98,.92]
    ],
    opacity:[["air",0],["soft",0],["trab",.001],["bone",.003],["cortical",.012],["dense",.07],["max",.12]],
    ambient:.50,diffuse:.62,specular:.35,specularPower:22
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

function segmentSegmentDistance(p1,q1,p2,q2){
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const u=sub(q1,p1),v=sub(q2,p2),w=sub(p1,p2);
  const a=dot(u,u),b=dot(u,v),c=dot(v,v),d=dot(u,w),e=dot(v,w);
  const EPS=1e-9;
  if(a<EPS&&c<EPS)return Math.hypot(...w);
  if(a<EPS){
    const t=clamp(e/c,0,1);
    return Math.hypot(p1[0]-(p2[0]+v[0]*t),p1[1]-(p2[1]+v[1]*t),p1[2]-(p2[2]+v[2]*t));
  }
  if(c<EPS){
    const t=clamp(-d/a,0,1);
    return Math.hypot((p1[0]+u[0]*t)-p2[0],(p1[1]+u[1]*t)-p2[1],(p1[2]+u[2]*t)-p2[2]);
  }

  const D=a*c-b*b;
  let sN,sD=D,tN,tD=D;
  if(D<EPS){sN=0;sD=1;tN=e;tD=c}
  else{
    sN=b*e-c*d;
    tN=a*e-b*d;
    if(sN<0){sN=0;tN=e;tD=c}
    else if(sN>sD){sN=sD;tN=e+b;tD=c}
  }
  if(tN<0){
    tN=0;
    if(-d<0)sN=0;
    else if(-d>a)sN=sD;
    else{sN=-d;sD=a}
  }else if(tN>tD){
    tN=tD;
    if((-d+b)<0)sN=0;
    else if((-d+b)>a)sN=sD;
    else{sN=-d+b;sD=a}
  }
  const sc=Math.abs(sN)<EPS?0:sN/sD;
  const tc=Math.abs(tN)<EPS?0:tN/tD;
  return Math.hypot(
    w[0]+sc*u[0]-tc*v[0],
    w[1]+sc*u[1]-tc*v[1],
    w[2]+sc*u[2]-tc*v[2]
  );
}

function implantNerveClearance(implant,nerveWorldPoints){
  if(!implant||nerveWorldPoints.length<2)return null;
  const axis=implantAxisVector(implant);
  const half=Math.max(0,Number(implant.length)||0)/2;
  const radius=Math.max(0,Number(implant.diameter)||0)/2;
  const center=[Number(implant.x)||0,Number(implant.y)||0,Number(implant.z)||0];
  const a=[center[0]-axis.x*half,center[1]-axis.y*half,center[2]-axis.z*half];
  const b=[center[0]+axis.x*half,center[1]+axis.y*half,center[2]+axis.z*half];
  let axisDistance=Infinity;
  for(let i=0;i<nerveWorldPoints.length-1;i++){
    axisDistance=Math.min(axisDistance,segmentSegmentDistance(a,b,nerveWorldPoints[i],nerveWorldPoints[i+1]));
  }
  if(!Number.isFinite(axisDistance))return null;
  return {
    axisDistance,
    clearance:Math.max(0,axisDistance-radius)
  };
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
  prop.setColor(...(active?[.04,1,.86]:[.96,.75,.30]));
  prop.setOpacity(1);
  prop.setAmbient(active?.92:.72);prop.setDiffuse(active?.46:.58);prop.setSpecular(.92);prop.setSpecularPower(54);
  prop.setEdgeVisibility?.(active);
  if(active)prop.setEdgeColor?.(.72,1,.96);
  const guide=createTubeActor([[0,0,-length/2-1.4],[0,0,length/2+1.4]],Math.max(.20,radius*.14),active?[.05,1,.84]:[1,.78,.24]);
  if(guide){
    guide.actor.setPosition(implant.x,implant.y,implant.z);
    guide.actor.setOrientation(implant.rx||0,implant.ry||0,implant.rz||0);
    const gp=guide.actor.getProperty();gp.setAmbient(1);gp.setDiffuse(.15);gp.setOpacity(1);
  }
  return {actor,mapper,poly,points:vtkPts,guide,diameter:implant.diameter,length:implant.length};
}

function createCrosshairBundle(){
  const radius=.28,span=10;
  const axes=[
    createTubeActor([[-span,0,0],[span,0,0]],radius,[.12,1,.90]),
    createTubeActor([[0,-span,0],[0,span,0]],radius,[.12,1,.90]),
    createTubeActor([[0,0,-span],[0,0,span]],radius,[.12,1,.90])
  ].filter(Boolean);
  axes.forEach(bundle=>{
    const prop=bundle.actor.getProperty();
    prop.setOpacity(.98);prop.setAmbient(1);prop.setDiffuse(.08);prop.setSpecular(.2);
  });
  return axes;
}

function updateImplantBundle(bundle,implant,active){
  if(!bundle?.actor)return;
  bundle.actor.setPosition(implant.x,implant.y,implant.z);
  bundle.actor.setOrientation(implant.rx||0,implant.ry||0,implant.rz||0);
  const prop=bundle.actor.getProperty();
  prop.setColor(...(active?[.04,1,.86]:[.96,.75,.30]));
  prop.setOpacity(1);
  prop.setAmbient(active?.92:.72);
  prop.setDiffuse(active?.46:.58);
  prop.setSpecular(.92);
  prop.setSpecularPower(54);
  prop.setEdgeVisibility?.(active);
  if(active)prop.setEdgeColor?.(.72,1,.96);
  if(bundle.guide?.actor){
    bundle.guide.actor.setPosition(implant.x,implant.y,implant.z);
    bundle.guide.actor.setOrientation(implant.rx||0,implant.ry||0,implant.rz||0);
    const gp=bundle.guide.actor.getProperty();
    gp.setColor(...(active?[.05,1,.84]:[1,.78,.24]));gp.setOpacity(1);gp.setAmbient(1);gp.setDiffuse(.15);
  }
}

export default function Viewer3DPanel({volume,meta,nervePoints=[],curve=[],cursor=null,crosshairVisible=true,onCrosshairVisibleChange=()=>{},onCursorChange=()=>{},globalTool="navigate",implants=[],activeImplantId=null,onImplantsChange=()=>{},onActiveImplantChange=()=>{},layoutMode="mosaic"}){
  const hostRef=useRef(null);
  const genericRef=useRef(null);
  const rendererRef=useRef(null);
  const overlayRendererRef=useRef(null);
  const renderWindowRef=useRef(null);
  const imageDataRef=useRef(null);
  const volumeActorRef=useRef(null);
  const mapperRef=useRef(null);
  const statsRef=useRef(null);
  const nerveActorRef=useRef(null);
  const scanActorRef=useRef(null);
  const scanInitialRef=useRef(null);
  const scanInputRef=useRef(null);
  const crosshairActorsRef=useRef([]);
  const placementDragRef=useRef(false);

  const [ready,setReady]=useState(false);
  const [status,setStatus]=useState("Preparando GPU Volume Rendering…");
  const [preset,setPreset]=useState("planning");
  const [volumeVisible,setVolumeVisible]=useState(true);
  const [nerveVisible,setNerveVisible]=useState(true);
  const [denseBoost,setDenseBoost]=useState(true);
  const [lighting,setLighting]=useState(true);
  const [boneOpacityScale,setBoneOpacityScale]=useState(.68);
  const [interactionMode,setInteractionMode]=useState("camera");
  const [pickMessage,setPickMessage]=useState("");
  const [scanName,setScanName]=useState("");
  const [scanStatus,setScanStatus]=useState("Nenhum scan intraoral carregado.");
  const [scanVisible,setScanVisible]=useState(true);
  const [scanOpacity,setScanOpacity]=useState(.96);
  const [scanTransform,setScanTransform]=useState({x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1});
  const implantActorsRef=useRef(new Map());
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
  const [nerveSafetyMargin,setNerveSafetyMargin]=useState(2);
  const activeImplant=implants.find(x=>x.id===activeImplantId)||null;
  const nerveWorldPoints=useMemo(()=>meta&&curve.length>=2?nervePoints.map(n=>nervePointToWorld(n,curve,meta)).filter(Boolean):[],[nervePoints,curve,meta]);
  const activeNerveClearance=useMemo(()=>implantNerveClearance(activeImplant,nerveWorldPoints),[activeImplant,nerveWorldPoints]);
  const nerveMarginDelta=activeNerveClearance?activeNerveClearance.clearance-nerveSafetyMargin:null;

  useEffect(()=>{
    if(!activeImplantId)return;
    setPreset("implant");
    setDenseBoost(false);
    setNerveVisible(true);
    setBoneOpacityScale(.18);
  },[activeImplantId]);

  useEffect(()=>{
    if(globalTool==="navigate"){
      setInteractionMode("cursor");
      setPickMessage("Cruzeta 3D ativa • clique ou arraste sobre o osso.");
    }else{
      setInteractionMode(current=>current==="cursor"?"camera":current);
      setPickMessage(current=>interactionMode==="cursor"?"":current);
    }
  },[globalTool]);

  function renderNow(){renderWindowRef.current?.render?.()}

  function disposeCrosshair(){
    const renderer=rendererRef.current;
    crosshairActorsRef.current.forEach(bundle=>{
      if(bundle?.actor&&renderer)renderer.removeActor(bundle.actor);
      bundle?.actor?.delete?.();bundle?.tube?.delete?.();bundle?.mapper?.delete?.();bundle?.poly?.delete?.();bundle?.pts?.delete?.();bundle?.lines?.delete?.();
    });
    crosshairActorsRef.current=[];
  }

  function pickWorldAtEvent(event){
    const host=hostRef.current,renderer=rendererRef.current;
    if(!host||!renderer||!meta||!volume?.length)return null;
    const rect=host.getBoundingClientRect();
    if(rect.width<2||rect.height<2)return null;

    const cam=renderer.getActiveCamera();
    const position=cam.getPosition(),focal=cam.getFocalPoint(),viewUp=cam.getViewUp();
    const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l]};
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
    const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];

    const forward=norm([focal[0]-position[0],focal[1]-position[1],focal[2]-position[2]]);
    const right=norm(cross(forward,viewUp));
    const up=norm(cross(right,forward));
    const ndcX=((event.clientX-rect.left)/rect.width)*2-1;
    const ndcY=1-((event.clientY-rect.top)/rect.height)*2;
    const aspect=rect.width/rect.height;

    let origin,dir;
    if(cam.getParallelProjection?.()){
      const scale=cam.getParallelScale?.()||1;
      origin=add(add(position,mul(right,ndcX*scale*aspect)),mul(up,ndcY*scale));
      dir=forward;
    }else{
      const angle=(cam.getViewAngle?.()||30)*Math.PI/180;
      const half=Math.tan(angle/2);
      origin=[...position];
      dir=norm(add(add(forward,mul(right,ndcX*half*aspect)),mul(up,ndcY*half)));
    }

    const bounds=[
      [0,(meta.w-1)*meta.spacingX],
      [0,(meta.h-1)*meta.spacingY],
      [0,(meta.d-1)*meta.spacingZ]
    ];
    let tMin=-Infinity,tMax=Infinity;
    for(let axis=0;axis<3;axis++){
      if(Math.abs(dir[axis])<1e-9){
        if(origin[axis]<bounds[axis][0]||origin[axis]>bounds[axis][1])return null;
        continue;
      }
      let t1=(bounds[axis][0]-origin[axis])/dir[axis];
      let t2=(bounds[axis][1]-origin[axis])/dir[axis];
      if(t1>t2)[t1,t2]=[t2,t1];
      tMin=Math.max(tMin,t1);tMax=Math.min(tMax,t2);
      if(tMax<tMin)return null;
    }
    if(tMax<0)return null;
    tMin=Math.max(0,tMin);

    const stats=statsRef.current;
    const threshold=stats?.bone??stats?.trab??0;
    const fallbackThreshold=stats?.trab??threshold;
    const step=Math.max(.08,Math.min(meta.spacingX,meta.spacingY,meta.spacingZ)*.45);
    let best=null,bestValue=-Infinity;
    for(let t=tMin;t<=tMax;t+=step){
      const wx=origin[0]+dir[0]*t,wy=origin[1]+dir[1]*t,wz=origin[2]+dir[2]*t;
      const ix=clamp(Math.round(wx/meta.spacingX),0,meta.w-1);
      const iy=clamp(Math.round(wy/meta.spacingY),0,meta.h-1);
      const iz=clamp(Math.round(wz/meta.spacingZ),0,meta.d-1);
      const value=volume[iz*meta.w*meta.h+iy*meta.w+ix];
      if(value>bestValue){bestValue=value;best=[wx,wy,wz]}
      if(value>=threshold)return [wx,wy,wz];
    }

    // Guaranteed fallback: intersect the click ray with the plane through the current cursor,
    // perpendicular to the camera direction. This keeps the 3D crosshair movable even when
    // the volume preset is too translucent to yield a density hit.
    if(cursor){
      const planePoint=[cursor.x*meta.spacingX,cursor.y*meta.spacingY,cursor.z*meta.spacingZ];
      const denom=dir[0]*forward[0]+dir[1]*forward[1]+dir[2]*forward[2];
      if(Math.abs(denom)>1e-6){
        const t=((planePoint[0]-origin[0])*forward[0]+(planePoint[1]-origin[1])*forward[1]+(planePoint[2]-origin[2])*forward[2])/denom;
        if(Number.isFinite(t)&&t>=0){
          return [
            clamp(origin[0]+dir[0]*t,bounds[0][0],bounds[0][1]),
            clamp(origin[1]+dir[1]*t,bounds[1][0],bounds[1][1]),
            clamp(origin[2]+dir[2]*t,bounds[2][0],bounds[2][1])
          ];
        }
      }
    }
    return bestValue>=fallbackThreshold?best:null;
  }

  function applyPickedWorld(world){
    if(!world||!meta)return;
    const nextCursor={
      x:clamp(world[0]/meta.spacingX,0,meta.w-1),
      y:clamp(world[1]/meta.spacingY,0,meta.h-1),
      z:clamp(world[2]/meta.spacingZ,0,meta.d-1)
    };
    onCursorChange(nextCursor);
    if(interactionMode==="implant"){
      if(!activeImplantId){
        setPickMessage("Selecione ou insira um implante antes de posicionar.");
        return;
      }
      updateActiveImplant({x:world[0],y:world[1],z:world[2]});
      setPickMessage("Implante reposicionado no 3D.");
    }else{
      setPickMessage(`Cruzeta • X ${Math.round(nextCursor.x)+1} • Y ${Math.round(nextCursor.y)+1} • Z ${Math.round(nextCursor.z)+1}`);
    }
  }

  function pickFromPointer(event){
    const world=pickWorldAtEvent(event);
    if(world)applyPickedWorld(world);
    else setPickMessage("Não encontrei superfície do CBCT nesse ponto.");
  }

  function onStagePointerDownCapture(event){
    if(interactionMode==="camera")return;
    event.preventDefault();event.stopPropagation();
    placementDragRef.current=true;
    try{hostRef.current?.setPointerCapture?.(event.pointerId)}catch{}
    pickFromPointer(event);
  }
  function onStagePointerMoveCapture(event){
    if(interactionMode==="camera"||!placementDragRef.current)return;
    event.preventDefault();event.stopPropagation();
    if(event.buttons)pickFromPointer(event);
  }
  function onStagePointerUpCapture(event){
    if(interactionMode==="camera")return;
    event.preventDefault();event.stopPropagation();
    placementDragRef.current=false;
    try{hostRef.current?.releasePointerCapture?.(event.pointerId)}catch{}
  }

  function disposeImplantBundle(bundle){
    const renderer=rendererRef.current;
    if(bundle?.actor&&renderer)renderer.removeActor(bundle.actor);
    if(bundle?.guide?.actor&&renderer)renderer.removeActor(bundle.guide.actor);
    bundle?.actor?.delete?.();bundle?.mapper?.delete?.();bundle?.poly?.delete?.();bundle?.points?.delete?.();
    bundle?.guide?.actor?.delete?.();bundle?.guide?.tube?.delete?.();bundle?.guide?.mapper?.delete?.();bundle?.guide?.poly?.delete?.();bundle?.guide?.pts?.delete?.();bundle?.guide?.lines?.delete?.();
  }

  function disposeImplants(){
    implantActorsRef.current.forEach(bundle=>disposeImplantBundle(bundle));
    implantActorsRef.current.clear();
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
  function alignImplantAxis(axis){
    if(axis==="z")updateActiveImplant({rx:0,ry:0,rz:0});
    if(axis==="y")updateActiveImplant({rx:-90,ry:0,rz:0});
    if(axis==="x")updateActiveImplant({rx:0,ry:90,rz:0});
  }
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
    }else if(name==="implant"){
      setBoneOpacityScale(.18);
      setDenseBoost(false);
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

    // Clinical overlay: implant + mandibular nerve must remain visible through the volume.
    renderWindow.setNumberOfLayers(2);
    const overlayRenderer=vtkRenderer.newInstance();
    overlayRenderer.setLayer(1);
    overlayRenderer.setInteractive(false);
    overlayRenderer.setPreserveColorBuffer(true);
    overlayRenderer.setPreserveDepthBuffer(false);
    overlayRenderer.setActiveCamera(renderer.getActiveCamera());
    renderWindow.addRenderer(overlayRenderer);

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

    const crosshairBundles=createCrosshairBundle();
    crosshairBundles.forEach(bundle=>renderer.addActor(bundle.actor));
    crosshairActorsRef.current=crosshairBundles;

    genericRef.current=generic;
    rendererRef.current=renderer;
    overlayRendererRef.current=overlayRenderer;
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

    let resizeRaf=0;
    const resizeViewport=()=>{
      cancelAnimationFrame(resizeRaf);
      resizeRaf=requestAnimationFrame(()=>{
        if(cancelled)return;
        const rect=host.getBoundingClientRect();
        if(rect.width<32||rect.height<32)return;
        generic.resize();
        const gl=generic.getOpenGLRenderWindow?.();
        if(gl?.setSize){
          const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,2));
          gl.setSize(
            Math.max(1,Math.round(rect.width*dpr)),
            Math.max(1,Math.round(rect.height*dpr))
          );
        }
        overlayRenderer.setActiveCamera(renderer.getActiveCamera());
        renderer.resetCameraClippingRange();
        renderWindow.render();
      });
    };
    const ro=new ResizeObserver(resizeViewport);
    ro.observe(host);
    window.addEventListener("resize",resizeViewport);
    resizeViewport();

    if(!cancelled){
      setReady(true);
      setStatus("GPU Volume Rendering • CBCT completo • interação em tempo real");
    }

    return()=>{
      cancelled=true;
      ro.disconnect();
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener("resize",resizeViewport);
      if(nerveActorRef.current?.actor)overlayRenderer.removeActor(nerveActorRef.current.actor);
      disposeScan();
      disposeImplants();
      disposeCrosshair();
      renderer.removeVolume(actor);
      nerveActorRef.current=null;
      renderWindow.removeRenderer(overlayRenderer);
      overlayRenderer.delete();
      overlayRendererRef.current=null;
      generic.delete();
      genericRef.current=null;rendererRef.current=null;renderWindowRef.current=null;
      imageDataRef.current=null;volumeActorRef.current=null;mapperRef.current=null;statsRef.current=null;
    };
  },[volume,meta]);

  useEffect(()=>{applyPreset(preset)},[preset,boneOpacityScale,denseBoost,lighting]);

  useEffect(()=>{
    const generic=genericRef.current,renderer=rendererRef.current,renderWindow=renderWindowRef.current,host=hostRef.current;
    if(!generic||!renderer||!renderWindow||!host)return;
    let raf=0;
    const timers=[];
    const resize=()=>{
      const rect=host.getBoundingClientRect();
      if(rect.width<32||rect.height<32)return;
      generic.resize();
      const gl=generic.getOpenGLRenderWindow?.();
      if(gl?.setSize){
        const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,2));
        gl.setSize(
          Math.max(1,Math.round(rect.width*dpr)),
          Math.max(1,Math.round(rect.height*dpr))
        );
      }
      overlayRendererRef.current?.setActiveCamera?.(renderer.getActiveCamera());
      renderer.resetCameraClippingRange();
      renderWindow.render();
    };
    const schedule=()=>{
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>{
        resize();
        raf=requestAnimationFrame(resize);
      });
      [60,160,320,650].forEach(ms=>timers.push(setTimeout(resize,ms)));
    };
    schedule();
    return()=>{
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  },[layoutMode]);

  useEffect(()=>{
    if(!meta||!cursor||!crosshairActorsRef.current.length)return;
    const world=[
      clamp(cursor.x,0,meta.w-1)*meta.spacingX,
      clamp(cursor.y,0,meta.h-1)*meta.spacingY,
      clamp(cursor.z,0,meta.d-1)*meta.spacingZ
    ];
    crosshairActorsRef.current.forEach(bundle=>{
      bundle.actor.setPosition(...world);
      bundle.actor.setVisibility(crosshairVisible);
    });
    renderNow();
  },[cursor?.x,cursor?.y,cursor?.z,crosshairVisible,meta,ready]);

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
    const pts=nerveWorldPoints;
    const radius=Math.max(1.25,Math.min(meta.spacingX,meta.spacingY,meta.spacingZ)*6.2);
    const bundle=createTubeActor(pts,radius,[1,0,0]);
    if(bundle){
      const prop=bundle.actor.getProperty();
      prop.setOpacity(1);prop.setAmbient(1);prop.setDiffuse(.08);prop.setSpecular(.15);
      renderer.addActor(bundle.actor);
      nerveActorRef.current=bundle;
      renderNow();
    }
  },[nerveWorldPoints,meta,nerveVisible,ready]);

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
    if(!renderer||!ready)return;
    const liveIds=new Set(implants.map(implant=>implant.id));
    implantActorsRef.current.forEach((bundle,id)=>{
      if(liveIds.has(id))return;
      disposeImplantBundle(bundle);
      implantActorsRef.current.delete(id);
    });
    implants.forEach(implant=>{
      const active=implant.id===activeImplantId;
      let bundle=implantActorsRef.current.get(implant.id);
      const geometryChanged=!bundle||bundle.diameter!==implant.diameter||bundle.length!==implant.length;
      if(geometryChanged){
        if(bundle)disposeImplantBundle(bundle);
        bundle=createParametricImplantBundle(implant,active);
        renderer.addActor(bundle.actor);
        if(bundle.guide?.actor)renderer.addActor(bundle.guide.actor);
        implantActorsRef.current.set(implant.id,bundle);
      }else{
        updateImplantBundle(bundle,implant,active);
      }
    });
    renderer.resetCameraClippingRange();
    renderNow();
  },[implants,activeImplantId,ready]);

  return <div className="viewer3d-panel viewer3d-v2">
    <div className={"viewer3d-stage "+(interactionMode!=="camera"?"is-picking":"")} ref={hostRef}
      onPointerDownCapture={onStagePointerDownCapture}
      onPointerMoveCapture={onStagePointerMoveCapture}
      onPointerUpCapture={onStagePointerUpCapture}
      onPointerCancelCapture={onStagePointerUpCapture}>
      {!ready&&<div className="viewer3d-loading"><span className="viewer3d-orbit">◌</span><strong>OdontoView 3D Engine v2</strong><small>{status}</small></div>}
      {ready&&<div className="viewer3d-status">{status}</div>}
      {ready&&<div className="viewer3d-engine-badge">VTK.js • GPU</div>}
    </div>
    <div className="viewer3d-controls">
      <div className="viewer3d-quickbar">
        <button type="button" className="viewer3d-add-scan" onClick={()=>scanInputRef.current?.click()}>＋ Adicionar scan intraoral</button>
        <span>{scanName?"Fusion ativo • "+scanName:"CBCT aberto • adicione STL/PLY para fusionar"}</span>
      </div>
      <div className="viewer3d-interaction" role="group" aria-label="Interação 3D">
        <button type="button" className={interactionMode==="camera"?"active":""} onClick={()=>{setInteractionMode("camera");setPickMessage("")}}>↻ Câmera</button>
        <button type="button" className={interactionMode==="cursor"?"active":""} onClick={()=>{setInteractionMode("cursor");setPickMessage("Clique no 3D para mover a cruzeta.")}}>⌖ Cruzeta 3D</button>
        <button type="button" className={interactionMode==="implant"?"active implant":""} disabled={!activeImplant} onClick={()=>{setInteractionMode("implant");setPickMessage(activeImplant?"Clique/arraste no osso para posicionar o implante.":"Insira ou selecione um implante.")}}>◈ Posicionar implante</button>
        <button type="button" className={crosshairVisible?"active":""} onClick={()=>onCrosshairVisibleChange(!crosshairVisible)}>{crosshairVisible?"Cruzeta visível":"Mostrar cruzeta"}</button>
      </div>
      {pickMessage&&<div className="viewer3d-pick-note">{pickMessage}</div>}
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
          <section className={"viewer3d-nerve-clearance "+(!activeNerveClearance?"unavailable":nerveMarginDelta>=0?"within":"below")}>
            <div className="viewer3d-nerve-clearance-head">
              <span>Distância implante ↔ nervo</span>
              <strong>{activeNerveClearance?activeNerveClearance.clearance.toFixed(2)+" mm":"—"}</strong>
            </div>
            {activeNerveClearance?<>
              <div className="viewer3d-nerve-clearance-state">
                {nerveMarginDelta>=0
                  ?"Margem configurada atendida • +"+nerveMarginDelta.toFixed(2)+" mm"
                  :"Abaixo da margem configurada • "+Math.abs(nerveMarginDelta).toFixed(2)+" mm"}
              </div>
              <label className="viewer3d-nerve-margin">Margem
                <input type="range" min=".5" max="5" step=".25" value={nerveSafetyMargin} onChange={e=>setNerveSafetyMargin(Number(e.target.value))}/>
                <b>{nerveSafetyMargin.toFixed(2)} mm</b>
              </label>
              <small>Estimativa geométrica da superfície nominal do implante até o traçado central do nervo. O traçado manual/assistido não representa a parede real do canal mandibular.</small>
            </>:<small>Marque pelo menos 2 pontos do nervo para calcular a distância em milímetros.</small>}
          </section>
          <span>Posição fina • 0,25 mm — ajuste nos cortes ou use “Posicionar implante” diretamente no 3D</span>
          <div><button onClick={()=>moveImplant("x",-.25)}>X−</button><button onClick={()=>moveImplant("x",.25)}>X+</button><button onClick={()=>moveImplant("y",-.25)}>Y−</button><button onClick={()=>moveImplant("y",.25)}>Y+</button><button onClick={()=>moveImplant("z",-.25)}>Z−</button><button onClick={()=>moveImplant("z",.25)}>Z+</button></div>
          <span>Direção inicial do implante</span>
          <div><button onClick={()=>alignImplantAxis("z")}>Eixo Z</button><button onClick={()=>alignImplantAxis("y")}>Eixo Y</button><button onClick={()=>alignImplantAxis("x")}>Eixo X</button></div>
          <span>Inclinação livre • 1°</span>
          <div><button onClick={()=>rotateImplant("x",-1)}>RX−</button><button onClick={()=>rotateImplant("x",1)}>RX+</button><button onClick={()=>rotateImplant("y",-1)}>RY−</button><button onClick={()=>rotateImplant("y",1)}>RY+</button><button onClick={()=>rotateImplant("z",-1)}>RZ−</button><button onClick={()=>rotateImplant("z",1)}>RZ+</button></div>
          <div className="viewer3d-implant-angle-sliders">
            <label>Rotação X <input type="range" min="-180" max="180" step="1" value={activeImplant.rx||0} onChange={e=>updateActiveImplant({rx:Number(e.target.value)})}/><b>{Math.round(activeImplant.rx||0)}°</b></label>
            <label>Rotação Y <input type="range" min="-180" max="180" step="1" value={activeImplant.ry||0} onChange={e=>updateActiveImplant({ry:Number(e.target.value)})}/><b>{Math.round(activeImplant.ry||0)}°</b></label>
            <label>Rotação Z <input type="range" min="-180" max="180" step="1" value={activeImplant.rz||0} onChange={e=>updateActiveImplant({rz:Number(e.target.value)})}/><b>{Math.round(activeImplant.rz||0)}°</b></label>
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
