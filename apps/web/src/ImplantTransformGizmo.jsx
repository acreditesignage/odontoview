import React,{useRef,useState} from 'react';
import {applyImplantGizmoDelta} from './implantTransformGizmo.js';

const AXIS_LABEL={x:'X',y:'Y',z:'Z'};

export default function ImplantTransformGizmo({implant,onChange}){
  const [mode,setMode]=useState('translate');
  const dragRef=useRef(null);
  if(!implant)return null;

  function fieldFor(axis){return mode==='translate'?axis:`r${axis}`}
  function emitDelta(base,axis,delta){
    const next=applyImplantGizmoDelta(base,{mode,axis,delta});
    const field=fieldFor(axis);
    onChange?.({[field]:next[field]});
  }
  function begin(axis,e){
    e.preventDefault();e.stopPropagation();
    const target=e.currentTarget;
    dragRef.current={axis,startX:e.clientX,startY:e.clientY,base:{...implant},target};
    try{target.setPointerCapture(e.pointerId)}catch{}
  }
  function move(e){
    const drag=dragRef.current;if(!drag)return;
    e.preventDefault();e.stopPropagation();
    const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
    const pixels=drag.axis==='x'?dx:-dy;
    const scale=mode==='translate'?.06:.65;
    emitDelta(drag.base,drag.axis,pixels*scale);
  }
  function end(e){
    const drag=dragRef.current;if(!drag)return;
    e.preventDefault();e.stopPropagation();
    try{drag.target?.releasePointerCapture?.(e.pointerId)}catch{}
    dragRef.current=null;
  }
  function nudge(axis,direction){
    emitDelta(implant,axis,direction*(mode==='translate'?.25:1));
  }
  function keyNudge(axis,e){
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();
    const positive=e.key==='ArrowRight'||e.key==='ArrowUp';
    nudge(axis,positive?1:-1);
  }

  return <div className={'viewer3d-implant-gizmo mode-'+mode} data-implant-gizmo role="group" aria-label="Manipulador visual do implante" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    <div className="viewer3d-gizmo-mode" role="group" aria-label="Modo do manipulador">
      <button type="button" className={mode==='translate'?'active':''} onPointerDown={e=>e.stopPropagation()} onClick={()=>setMode('translate')} title="Mover implante">↔</button>
      <button type="button" className={mode==='rotate'?'active':''} onPointerDown={e=>e.stopPropagation()} onClick={()=>setMode('rotate')} title="Girar implante">↻</button>
    </div>
    <div className="viewer3d-gizmo-head" aria-hidden="true">
      <svg viewBox="0 0 92 92">
        <path d="M31 17c-8 6-12 17-10 29 2 10 7 15 13 20 4 3 5 8 5 13h25c0-7-2-12-8-16 10-4 16-13 16-25 0-15-10-26-24-26-7 0-12 2-17 5Z"/>
        <path d="M43 31c6-5 16-4 21 2M47 49c5 3 11 3 15-1"/>
        <circle cx="52" cy="39" r="2.4"/>
      </svg>
    </div>
    <div className="viewer3d-gizmo-ring" aria-hidden="true"/>
    {['x','y','z'].map(axis=><button type="button" key={axis} className={'viewer3d-gizmo-axis axis-'+axis} data-axis={axis} aria-label={(mode==='translate'?'Mover':'Girar')+' implante no eixo '+AXIS_LABEL[axis]} title={(mode==='translate'?'Arraste para mover':'Arraste para girar')+' • '+AXIS_LABEL[axis]} onPointerDown={e=>begin(axis,e)} onKeyDown={e=>keyNudge(axis,e)}>
      <span>{AXIS_LABEL[axis]}</span><i aria-hidden="true"/>
    </button>)}
    <div className="viewer3d-gizmo-caption">{mode==='translate'?'Mover implante':'Girar implante'}</div>
  </div>;
}
