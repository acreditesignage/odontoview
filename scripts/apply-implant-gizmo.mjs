import fs from 'node:fs';

const panelPath='apps/web/src/Viewer3DPanel.jsx';
const cssPath='apps/web/src/styles.css';
let source=fs.readFileSync(panelPath,'utf8');
let css=fs.readFileSync(cssPath,'utf8');

function replaceOnce(label,needle,replacement){
  if(!source.includes(needle))throw new Error(`Missing Viewer3DPanel marker: ${label}`);
  source=source.replace(needle,replacement);
}

replaceOnce('gizmo import',
  'import React,{useEffect,useMemo,useRef,useState} from "react";\n',
  'import React,{useEffect,useMemo,useRef,useState} from "react";\nimport ImplantTransformGizmo from "./ImplantTransformGizmo.jsx";\n');

replaceOnce('stage pointer down yield',
  '  function onStagePointerDownCapture(event){\n    if(interactionMode==="camera")return;\n',
  '  function onStagePointerDownCapture(event){\n    if(event.target?.closest?.("[data-implant-gizmo]"))return;\n    if(interactionMode==="camera")return;\n');
replaceOnce('stage pointer move yield',
  '  function onStagePointerMoveCapture(event){\n    if(interactionMode==="camera"||!placementDragRef.current)return;\n',
  '  function onStagePointerMoveCapture(event){\n    if(event.target?.closest?.("[data-implant-gizmo]"))return;\n    if(interactionMode==="camera"||!placementDragRef.current)return;\n');
replaceOnce('stage pointer up yield',
  '  function onStagePointerUpCapture(event){\n    if(interactionMode==="camera")return;\n',
  '  function onStagePointerUpCapture(event){\n    if(event.target?.closest?.("[data-implant-gizmo]"))return;\n    if(interactionMode==="camera")return;\n');

replaceOnce('gizmo mount',
  '      {ready&&<div className="viewer3d-engine-badge">{gpuPrepared.optimized?"VTK.js • GPU • "+(performanceProfile==="tablet"?"TABLET":"MOBILE"):"VTK.js • GPU"}</div>}\n',
  '      {ready&&<div className="viewer3d-engine-badge">{gpuPrepared.optimized?"VTK.js • GPU • "+(performanceProfile==="tablet"?"TABLET":"MOBILE"):"VTK.js • GPU"}</div>}\n      {activeImplant&&<ImplantTransformGizmo implant={activeImplant} onChange={updateActiveImplant}/>}\n');

const precisionStart='          <span>Posição fina • 0,25 mm — ajuste nos cortes ou use “Posicionar implante” diretamente no 3D</span>\n';
const precisionEnd='          <div className="viewer3d-implant-angle-sliders">\n            <label>Rotação X <input type="range" min="-180" max="180" step="1" value={activeImplant.rx||0} onChange={e=>updateActiveImplant({rx:Number(e.target.value)})}/><b>{Math.round(activeImplant.rx||0)}°</b></label>\n            <label>Rotação Y <input type="range" min="-180" max="180" step="1" value={activeImplant.ry||0} onChange={e=>updateActiveImplant({ry:Number(e.target.value)})}/><b>{Math.round(activeImplant.ry||0)}°</b></label>\n            <label>Rotação Z <input type="range" min="-180" max="180" step="1" value={activeImplant.rz||0} onChange={e=>updateActiveImplant({rz:Number(e.target.value)})}/><b>{Math.round(activeImplant.rz||0)}°</b></label>\n          </div>\n';
const precisionStartIndex=source.indexOf(precisionStart);
const precisionEndIndex=source.indexOf(precisionEnd,precisionStartIndex);
if(precisionStartIndex<0||precisionEndIndex<0)throw new Error('Missing numeric precision control block');
const precisionBlock=source.slice(precisionStartIndex,precisionEndIndex+precisionEnd.length);
const wrapped=`          <details className="viewer3d-implant-precision">\n            <summary>Ajuste numérico de precisão</summary>\n${precisionBlock}          </details>\n`;
source=source.slice(0,precisionStartIndex)+wrapped+source.slice(precisionEndIndex+precisionEnd.length);

const marker='/* ODONTOVIEW IMPLANT TRANSFORM GIZMO */';
if(!css.includes(marker))css+=`\n\n${marker}
.viewer3d-stage{position:relative!important}
.viewer3d-implant-gizmo{position:absolute;right:14px;top:48px;z-index:24;width:148px;height:148px;border:1px solid rgba(96,178,186,.48);border-radius:50%;background:radial-gradient(circle at 50% 48%,rgba(20,42,51,.86),rgba(5,13,19,.82) 62%,rgba(3,8,12,.92));box-shadow:0 12px 34px rgba(0,0,0,.36),inset 0 0 28px rgba(43,210,203,.06);backdrop-filter:blur(7px);pointer-events:auto;user-select:none;touch-action:none}
.viewer3d-gizmo-head{position:absolute;left:39px;top:34px;width:70px;height:74px;opacity:.62;pointer-events:none}.viewer3d-gizmo-head svg{width:100%;height:100%;overflow:visible}.viewer3d-gizmo-head path,.viewer3d-gizmo-head circle{fill:none;stroke:#a8c0c9;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.viewer3d-gizmo-head circle{fill:#a8c0c9;stroke:none}
.viewer3d-gizmo-ring{position:absolute;inset:19px;border:1px dashed rgba(122,186,193,.34);border-radius:50%;pointer-events:none}.viewer3d-implant-gizmo.mode-rotate .viewer3d-gizmo-ring{border-style:solid;border-color:rgba(57,225,215,.58);box-shadow:inset 0 0 16px rgba(57,225,215,.08)}
.viewer3d-gizmo-mode{position:absolute;left:50%;top:-15px;transform:translateX(-50%);display:flex;gap:3px;padding:3px;border:1px solid #294653;border-radius:8px;background:#07131b;z-index:3}.viewer3d-gizmo-mode button{width:30px;height:26px;border:0;border-radius:5px;background:transparent;color:#8faab4;font-size:15px;line-height:1}.viewer3d-gizmo-mode button.active{background:#15383c;color:#63f5ec;box-shadow:inset 0 0 0 1px #2e7478}
.viewer3d-gizmo-axis{position:absolute!important;width:34px!important;height:34px!important;min-width:34px!important;padding:0!important;border-radius:50%!important;border:1px solid #3b5966!important;background:#0a1821!important;color:#e8f5f8!important;font-weight:800!important;display:grid!important;place-items:center!important;cursor:grab!important;box-shadow:0 5px 13px rgba(0,0,0,.34)!important;touch-action:none}.viewer3d-gizmo-axis:active{cursor:grabbing!important;transform:scale(.94)}.viewer3d-gizmo-axis span{position:relative;z-index:2;font-size:12px}.viewer3d-gizmo-axis i{position:absolute;display:block;background:currentColor;opacity:.72;pointer-events:none}
.viewer3d-gizmo-axis.axis-x{right:-8px;top:57px;color:#ff7777!important;border-color:rgba(255,92,92,.56)!important}.viewer3d-gizmo-axis.axis-x i{width:32px;height:2px;right:28px;top:15px}
.viewer3d-gizmo-axis.axis-y{left:57px;top:-8px;color:#73ef9b!important;border-color:rgba(78,225,124,.54)!important}.viewer3d-gizmo-axis.axis-y i{width:2px;height:32px;left:15px;top:28px}
.viewer3d-gizmo-axis.axis-z{left:-8px;bottom:18px;color:#72baff!important;border-color:rgba(81,167,255,.58)!important}.viewer3d-gizmo-axis.axis-z i{width:28px;height:2px;left:28px;top:15px;transform:rotate(-35deg);transform-origin:left center}
.viewer3d-gizmo-caption{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);white-space:nowrap;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#89a7b2;pointer-events:none}
.viewer3d-implant-precision{margin-top:8px;border:1px solid #29414d;border-radius:7px;background:#091720;overflow:hidden}.viewer3d-implant-precision>summary{cursor:pointer;list-style:none;padding:8px 10px;color:#9eb8c1;font-size:11px;font-weight:700}.viewer3d-implant-precision>summary::-webkit-details-marker{display:none}.viewer3d-implant-precision[open]>summary{color:#d7eeee;border-bottom:1px solid #263d48}.viewer3d-implant-precision>span,.viewer3d-implant-precision>div{margin:7px 9px;display:flex;gap:5px;align-items:center;flex-wrap:wrap}.viewer3d-implant-precision .viewer3d-implant-angle-sliders{display:grid;margin:8px 9px}
@media(max-width:900px){.viewer3d-implant-gizmo{width:124px;height:124px;right:10px;top:42px}.viewer3d-gizmo-head{left:33px;top:30px;width:58px;height:62px}.viewer3d-gizmo-axis.axis-x{top:45px}.viewer3d-gizmo-axis.axis-y{left:45px}.viewer3d-gizmo-axis.axis-z{bottom:12px}.viewer3d-gizmo-ring{inset:17px}}
`;

fs.writeFileSync(panelPath,source);
fs.writeFileSync(cssPath,css);
console.log('Applied implant transform gizmo integration.');
