import React,{useEffect,useMemo,useRef,useState} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";
import {MarchingCubes} from "three/examples/jsm/objects/MarchingCubes.js";

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}

function sampledPercentiles(volume){
  const values=[];
  const step=Math.max(1,Math.floor(volume.length/45000));
  for(let i=0;i<volume.length;i+=step)values.push(volume[i]);
  values.sort((a,b)=>a-b);
  const pick=q=>values[Math.floor((values.length-1)*q)]||0;
  return {lo:pick(.28),hi:pick(.995)};
}

function buildField(volume,meta,resolution){
  const {w,h,d}=meta;
  const {lo,hi}=sampledPercentiles(volume);
  const span=Math.max(1,hi-lo);
  const field=new Float32Array(resolution*resolution*resolution);
  let q=0;
  for(let z=0;z<resolution;z++){
    const oz=Math.round(z*(d-1)/(resolution-1));
    const zOff=oz*w*h;
    for(let y=0;y<resolution;y++){
      const oy=Math.round(y*(h-1)/(resolution-1));
      const yOff=zOff+oy*w;
      for(let x=0;x<resolution;x++){
        const ox=Math.round(x*(w-1)/(resolution-1));
        const n=clamp((volume[yOff+ox]-lo)/span,0,1);
        field[q++]=n*100;
      }
    }
  }
  return field;
}

function physicalScales(meta){
  const px=meta.w*meta.spacingX,py=meta.h*meta.spacingY,pz=meta.d*meta.spacingZ;
  const max=Math.max(px,py,pz)||1;
  return {x:px/max*46,y:py/max*46,z:pz/max*46};
}

function curvePointToLocal(n,curve,meta,scale){
  const c=curve[n.curveIndex];if(!c)return null;
  const prev=curve[Math.max(0,n.curveIndex-1)]||c;
  const next=curve[Math.min(curve.length-1,n.curveIndex+1)]||c;
  let tx=(next.x-prev.x)*meta.spacingX,ty=(next.y-prev.y)*meta.spacingY;
  const len=Math.hypot(tx,ty)||1;tx/=len;ty/=len;
  const nx=-ty,ny=tx;
  const x=c.x+nx*n.offsetMm/meta.spacingX;
  const y=c.y+ny*n.offsetMm/meta.spacingY;
  const z=n.z;
  return new THREE.Vector3(
    ((x/(meta.w-1))*2-1)*scale.x,
    ((y/(meta.h-1))*2-1)*scale.y,
    ((z/(meta.d-1))*2-1)*scale.z
  );
}

export default function Viewer3DPanel({volume,meta,nervePoints=[],curve=[]}){
  const hostRef=useRef(null);
  const sceneRef=useRef(null);
  const cameraRef=useRef(null);
  const controlsRef=useRef(null);
  const boneRef=useRef(null);
  const denseRef=useRef(null);
  const nerveRef=useRef(null);
  const lightRigRef=useRef(null);
  const rendererRef=useRef(null);
  const groupRef=useRef(null);
  const rafRef=useRef(0);

  const [ready,setReady]=useState(false);
  const [status,setStatus]=useState("Preparando reconstrução 3D…");
  const [boneVisible,setBoneVisible]=useState(true);
  const [denseVisible,setDenseVisible]=useState(true);
  const [nerveVisible,setNerveVisible]=useState(true);
  const [boneOpacity,setBoneOpacity]=useState(.42);
  const [realistic,setRealistic]=useState(true);
  const [lighting,setLighting]=useState(true);

  const quality=useMemo(()=>{
    if(typeof window==="undefined")return 52;
    if(window.innerWidth<760)return 42;
    if(window.innerWidth<1200)return 50;
    return 58;
  },[]);

  useEffect(()=>{
    if(!hostRef.current||!volume||!meta)return;
    let cancelled=false;
    setReady(false);
    setStatus("Gerando superfície óssea a partir do CBCT…");

    const host=hostRef.current;
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x05080c);
    scene.fog=new THREE.FogExp2(0x05080c,.012);

    const camera=new THREE.PerspectiveCamera(34,1,.1,1000);
    camera.position.set(72,38,84);

    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:"high-performance"});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
    renderer.setSize(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight),false);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.18;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    host.innerHTML="";
    host.appendChild(renderer.domElement);

    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.dampingFactor=.075;
    controls.rotateSpeed=.55;
    controls.zoomSpeed=.8;
    controls.panSpeed=.7;
    controls.target.set(0,0,0);

    const ambient=new THREE.HemisphereLight(0xd9eeff,0x1d130e,1.45);
    scene.add(ambient);
    const key=new THREE.DirectionalLight(0xfff4df,3.4);key.position.set(55,80,70);key.castShadow=true;scene.add(key);
    const fill=new THREE.DirectionalLight(0x7bbcff,1.5);fill.position.set(-65,24,45);scene.add(fill);
    const rim=new THREE.DirectionalLight(0xffc7a5,1.1);rim.position.set(12,-35,-65);scene.add(rim);
    lightRigRef.current=[ambient,key,fill,rim];

    const group=new THREE.Group();
    group.rotation.x=-Math.PI/2;
    group.rotation.z=Math.PI;
    scene.add(group);

    const floorGeo=new THREE.CircleGeometry(62,96);
    const floorMat=new THREE.MeshStandardMaterial({color:0x071018,roughness:.82,metalness:.02,transparent:true,opacity:.52});
    const floor=new THREE.Mesh(floorGeo,floorMat);
    floor.rotation.x=-Math.PI/2;floor.position.y=-49;floor.receiveShadow=true;scene.add(floor);

    const boneMat=new THREE.MeshPhysicalMaterial({
      color:0xd6bea2,roughness:.5,metalness:0,transparent:true,opacity:boneOpacity,
      clearcoat:.12,clearcoatRoughness:.52,side:THREE.DoubleSide,depthWrite:false
    });
    const denseMat=new THREE.MeshPhysicalMaterial({
      color:0xf4ead8,roughness:.26,metalness:0,transparent:true,opacity:.92,
      clearcoat:.48,clearcoatRoughness:.2,side:THREE.DoubleSide
    });

    const bone=new MarchingCubes(quality,boneMat,false,false,typeof window!=="undefined"&&window.innerWidth<760?70000:180000);
    const dense=new MarchingCubes(quality,denseMat,false,false,typeof window!=="undefined"&&window.innerWidth<760?65000:150000);
    const scale=physicalScales(meta);
    bone.scale.set(scale.x,scale.y,scale.z);
    dense.scale.copy(bone.scale);
    bone.isolation=45;
    dense.isolation=70;
    bone.castShadow=true;dense.castShadow=true;
    group.add(bone);group.add(dense);
    boneRef.current=bone;denseRef.current=dense;

    sceneRef.current=scene;cameraRef.current=camera;controlsRef.current=controls;rendererRef.current=renderer;groupRef.current=group;

    const resize=()=>{
      if(!hostRef.current||!rendererRef.current||!cameraRef.current)return;
      const w=Math.max(1,hostRef.current.clientWidth),h=Math.max(1,hostRef.current.clientHeight);
      rendererRef.current.setSize(w,h,false);
      cameraRef.current.aspect=w/h;cameraRef.current.updateProjectionMatrix();
    };
    const ro=new ResizeObserver(resize);ro.observe(host);resize();

    const animate=()=>{
      if(cancelled)return;
      controls.update();
      renderer.render(scene,camera);
      rafRef.current=requestAnimationFrame(animate);
    };
    animate();

    const timer=setTimeout(()=>{
      if(cancelled)return;
      try{
        const field=buildField(volume,meta,quality);
        bone.field.set(field);dense.field.set(field);
        bone.update();dense.update();

        const box=new THREE.Box3().setFromObject(group);
        const sphere=box.getBoundingSphere(new THREE.Sphere());
        const radius=Math.max(30,sphere.radius||45);
        controls.target.copy(sphere.center);
        camera.position.set(sphere.center.x+radius*1.65,sphere.center.y+radius*.85,sphere.center.z+radius*1.85);
        camera.near=Math.max(.1,radius/100);camera.far=radius*12;camera.updateProjectionMatrix();
        controls.update();
        if(!cancelled){setReady(true);setStatus("Reconstrução 3D experimental • use os cortes para decisão clínica.");}
      }catch(e){
        if(!cancelled)setStatus("Não foi possível gerar o 3D deste volume.");
      }
    },40);

    return()=>{
      cancelled=true;clearTimeout(timer);cancelAnimationFrame(rafRef.current);ro.disconnect();
      controls.dispose();renderer.dispose();
      scene.traverse(o=>{if(o.geometry)o.geometry.dispose?.();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose?.())}});
      if(renderer.domElement.parentElement===host)host.removeChild(renderer.domElement);
      sceneRef.current=null;cameraRef.current=null;controlsRef.current=null;rendererRef.current=null;groupRef.current=null;boneRef.current=null;denseRef.current=null;
    };
  },[volume,meta,quality]);

  useEffect(()=>{if(boneRef.current){boneRef.current.visible=boneVisible;boneRef.current.material.opacity=boneOpacity}},[boneVisible,boneOpacity]);
  useEffect(()=>{if(denseRef.current)denseRef.current.visible=denseVisible},[denseVisible]);
  useEffect(()=>{
    if(!boneRef.current||!denseRef.current)return;
    if(realistic){
      boneRef.current.material.color.setHex(0xd6bea2);boneRef.current.material.roughness=.5;boneRef.current.material.clearcoat=.12;
      denseRef.current.material.color.setHex(0xf4ead8);denseRef.current.material.roughness=.26;denseRef.current.material.clearcoat=.48;
    }else{
      boneRef.current.material.color.setHex(0xc6d2dc);boneRef.current.material.roughness=.78;boneRef.current.material.clearcoat=0;
      denseRef.current.material.color.setHex(0xf1f5f8);denseRef.current.material.roughness=.62;denseRef.current.material.clearcoat=.05;
    }
  },[realistic]);
  useEffect(()=>{lightRigRef.current?.forEach((l,i)=>{l.visible=lighting||i===0})},[lighting]);

  useEffect(()=>{
    const group=groupRef.current;if(!group||!meta)return;
    if(nerveRef.current){group.remove(nerveRef.current);nerveRef.current.geometry?.dispose?.();nerveRef.current.material?.dispose?.();nerveRef.current=null}
    if(!nerveVisible||nervePoints.length<2||curve.length<2)return;
    const scale=physicalScales(meta);
    const pts=nervePoints.map(n=>curvePointToLocal(n,curve,meta,scale)).filter(Boolean);
    if(pts.length<2)return;
    const path=new THREE.CatmullRomCurve3(pts,false,"centripetal",.4);
    const radius=Math.max(.38,Math.min(scale.x,scale.y,scale.z)*.0085);
    const geo=new THREE.TubeGeometry(path,Math.max(24,pts.length*2),radius,10,false);
    const mat=new THREE.MeshPhysicalMaterial({color:0xff2b2b,emissive:0x6f0505,emissiveIntensity:1.35,roughness:.32,clearcoat:.35});
    const tube=new THREE.Mesh(geo,mat);tube.renderOrder=8;group.add(tube);nerveRef.current=tube;
  },[nervePoints,curve,meta,nerveVisible]);

  function setView(kind){
    const camera=cameraRef.current,controls=controlsRef.current,group=groupRef.current;
    if(!camera||!controls||!group)return;
    const box=new THREE.Box3().setFromObject(group),sphere=box.getBoundingSphere(new THREE.Sphere()),r=Math.max(35,sphere.radius||45),c=sphere.center;
    if(kind==="front")camera.position.set(c.x,c.y+r*.25,c.z+r*2.35);
    if(kind==="side")camera.position.set(c.x+r*2.35,c.y+r*.25,c.z);
    if(kind==="top")camera.position.set(c.x,c.y+r*2.45,c.z+.01);
    controls.target.copy(c);camera.lookAt(c);controls.update();
  }
  function resetView(){setView("side")}

  return <div className="viewer3d-panel">
    <div className="viewer3d-stage" ref={hostRef}>
      {!ready&&<div className="viewer3d-loading"><span className="viewer3d-orbit">◌</span><strong>OdontoView 3D</strong><small>{status}</small></div>}
      {ready&&<div className="viewer3d-status">{status}</div>}
    </div>
    <div className="viewer3d-controls">
      <div className="viewer3d-switches">
        <button className={boneVisible?"active":""} onClick={()=>setBoneVisible(v=>!v)}>Osso</button>
        <button className={denseVisible?"active":""} onClick={()=>setDenseVisible(v=>!v)}>Dentes/denso</button>
        <button className={nerveVisible?"active nerve":""} onClick={()=>setNerveVisible(v=>!v)}>Nervo</button>
        <button className={realistic?"active":""} onClick={()=>setRealistic(v=>!v)}>Textura</button>
        <button className={lighting?"active":""} onClick={()=>setLighting(v=>!v)}>Luz</button>
      </div>
      <label className="viewer3d-opacity"><span>Transparência do osso</span><input type="range" min=".12" max=".9" step=".02" value={boneOpacity} onChange={e=>setBoneOpacity(Number(e.target.value))}/><b>{Math.round(boneOpacity*100)}%</b></label>
      <div className="viewer3d-views">
        <button onClick={()=>setView("side")}>Lateral</button>
        <button onClick={()=>setView("front")}>Frontal</button>
        <button onClick={()=>setView("top")}>Superior</button>
        <button onClick={resetView}>Reset</button>
      </div>
    </div>
  </div>;
}
