import fs from 'node:fs';

const viewerPath='apps/web/src/Viewer2.jsx';
const cssPath='apps/web/src/styles.css';
let source=fs.readFileSync(viewerPath,'utf8');
let css=fs.readFileSync(cssPath,'utf8');

function replaceOnce(label,needle,replacement){
  if(!source.includes(needle)) throw new Error(`Missing Viewer2 marker: ${label}`);
  source=source.replace(needle,replacement);
}

replaceOnce('workspace import',
  'import Viewer3DPanel from "./Viewer3DPanel.jsx";\n',
  'import Viewer3DPanel from "./Viewer3DPanel.jsx";\nimport {resetWorkspaceSlots,swapWorkspacePanes} from "./viewerWorkspaceLayout.js";\n');

replaceOnce('workspace state',
  '  const [expandedPanel,setExpandedPanel]=useState(null);\n',
  '  const [expandedPanel,setExpandedPanel]=useState(null);\n  const [workspaceSlots,setWorkspaceSlots]=useState(()=>resetWorkspaceSlots());\n  const [toolDrawerOpen,setToolDrawerOpen]=useState(false);\n  const [orthogonalPlane,setOrthogonalPlane]=useState("sagittal");\n  const workspaceDragRef=useRef(null);\n');

replaceOnce('draw dependencies',
  '  },[loading,error,meta,cursor,curvePoints,curveIndex,windowLevel,measurements,pendingMeasure,nervePoints,foramina,implants,activeImplantId,plannedTeeth,selectedToothFDI,transforms,crosshairVisible,expandedPanel]);\n',
  '  },[loading,error,meta,cursor,curvePoints,curveIndex,windowLevel,measurements,pendingMeasure,nervePoints,foramina,implants,activeImplantId,plannedTeeth,selectedToothFDI,transforms,crosshairVisible,expandedPanel,orthogonalPlane,workspaceSlots]);\n');

replaceOnce('workspace helpers',
`  function expandButton(id,label){
    const active=expandedPanel===id;
    return <button type="button" className="viewer2-expand" aria-label={(active?"Restaurar ":"Maximizar ")+label} title={(active?"Voltar ao mosaico":"Maximizar")+" • Esc para sair"} onClick={()=>setExpandedPanel(active?null:id)}>
      {active?"↙ Mosaico":"⛶"}
    </button>;
  }
`,
`  function expandButton(id,label){
    const active=expandedPanel===id;
    return <button type="button" className="viewer2-expand" aria-label={(active?"Restaurar ":"Maximizar ")+label} title={(active?"Voltar ao mosaico":"Maximizar")+" • Esc para sair"} onClick={()=>setExpandedPanel(active?null:id)}>
      {active?"↙ Mosaico":"⛶"}
    </button>;
  }

  function workspaceSlotClass(paneId){
    const slot=Object.keys(workspaceSlots).find(key=>workspaceSlots[key]===paneId);
    return slot?"workspace-slot-"+slot:"";
  }
  function beginWorkspaceDrag(paneId,e){
    workspaceDragRef.current=paneId;
    if(e?.dataTransfer){e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",paneId)}
  }
  function dropWorkspacePane(targetPane,e){
    e?.preventDefault?.();
    const sourcePane=workspaceDragRef.current||e?.dataTransfer?.getData?.("text/plain");
    workspaceDragRef.current=null;
    if(sourcePane&&sourcePane!==targetPane)setWorkspaceSlots(slots=>swapWorkspacePanes(slots,sourcePane,targetPane));
  }
  function moveWorkspacePaneForward(paneId){
    const order=["topLeft","topCenter","topRight","bottomLeft","bottomRight"];
    const slot=order.find(key=>workspaceSlots[key]===paneId);
    const index=order.indexOf(slot);
    if(index<0)return;
    const target=workspaceSlots[order[(index+1)%order.length]];
    setWorkspaceSlots(slots=>swapWorkspacePanes(slots,paneId,target));
  }
  function restoreWorkspaceLayout(){
    setWorkspaceSlots(resetWorkspaceSlots());
    setExpandedPanel(null);
  }
  function workspaceHeaderProps(paneId){
    return {
      draggable:deviceProfile==="desktop",
      onDragStart:e=>beginWorkspaceDrag(paneId,e),
      onDragOver:e=>e.preventDefault(),
      onDrop:e=>dropWorkspacePane(paneId,e),
      onDragEnd:()=>{workspaceDragRef.current=null}
    };
  }
`);

const gridStart='    <section className={"viewer2-grid viewer2-concept03"+(expandedPanel?" has-expanded expanded-"+expandedPanel:"")}>\n';
const asideMarker='      <aside className="viewer2-side">\n';
const start=source.indexOf(gridStart);
const aside=source.indexOf(asideMarker,start);
if(start<0||aside<0)throw new Error('Could not find legacy viewer grid boundaries');

const newGrid=`    <section className={"viewer2-grid viewer2-concept03 viewer2-workstation-grid"+(expandedPanel?" has-expanded expanded-"+expandedPanel:"")} data-workspace-layout="3d-first">
      <article id="viewer2-tangential" data-workspace-pane="tangential" className={"viewer2-pane tangential viewer2-workspace-pane viewer2-workspace-pane-tangential "+workspaceSlotClass("tangential")+(expandedPanel==="tangential"?" is-expanded":"")}>
        <div className="viewer2-pane-head viewer2-drag-handle" {...workspaceHeaderProps("tangential")}><strong>Tangencial • 3 cortes</strong><div className="viewer2-pane-actions"><button type="button" title="Mover painel" onClick={()=>moveWorkspacePaneForward("tangential")}>↔</button><button onClick={()=>resetPlane("tangential")}>1:1</button>{expandButton("tangential","Tangencial")}</div></div>
        {renderSliceControl("tangential","Tangencial")}
        <div className={"viewer2-canvas-wrap "+(deviceProfile!=="desktop"&&tool==="navigate"?"touch-scroll-friendly":"touch-tool-active")}><canvas className={tool==="navigate"?"crosshair-cursor":""} ref={canvases.tangential} onWheel={e=>onWheel("tangential",e)} onPointerDown={e=>onPointerDown("tangential",e)} onPointerMove={e=>onPointerMove("tangential",e)} onPointerUp={e=>onPointerUp("tangential",e)} onPointerCancel={e=>onPointerUp("tangential",e)}/></div>
      </article>

      <article id="viewer2-axial" data-workspace-pane="axial" className={"viewer2-pane axial viewer2-workspace-pane viewer2-workspace-pane-axial "+workspaceSlotClass("axial")+(expandedPanel==="axial"?" is-expanded":"")}>
        <div className="viewer2-pane-head viewer2-drag-handle" {...workspaceHeaderProps("axial")}><strong>Axial • Curva da arcada</strong><div className="viewer2-pane-actions"><button type="button" title="Mover painel" onClick={()=>moveWorkspacePaneForward("axial")}>↔</button><button onClick={()=>resetPlane("axial")}>1:1</button>{expandButton("axial","Axial")}</div></div>
        {renderSliceControl("axial","Axial")}
        {tool==="curve"&&<div className="viewer2-curve-capture-bar"><div><strong>Curva manual</strong><span>{curvePoints.length} ponto(s) • toque na imagem para adicionar</span></div><div><button type="button" disabled={!curvePoints.length} onClick={undoManualCurvePoint}>↶ Desfazer último</button><button type="button" disabled={!curvePoints.length} onClick={clearManualCurve}>Limpar</button><button type="button" className="primary" disabled={curvePoints.length<3} onClick={finishManualCurve}>Concluir curva</button></div></div>}
        <div className={"viewer2-canvas-wrap "+(deviceProfile!=="desktop"&&tool==="navigate"?"touch-scroll-friendly":"touch-tool-active")}><canvas className={tool==="navigate"?"crosshair-cursor":""} ref={canvases.axial} onWheel={e=>onWheel("axial",e)} onPointerDown={e=>onPointerDown("axial",e)} onPointerMove={e=>onPointerMove("axial",e)} onPointerUp={e=>onPointerUp("axial",e)} onPointerCancel={e=>onPointerUp("axial",e)}/></div>
      </article>

      <article id="viewer2-orthogonal" data-workspace-pane="orthogonal" className={"viewer2-pane orthogonal viewer2-workspace-pane viewer2-workspace-pane-orthogonal "+workspaceSlotClass("orthogonal")+(expandedPanel==="orthogonal"?" is-expanded":"")}>
        <div className="viewer2-pane-head viewer2-drag-handle" {...workspaceHeaderProps("orthogonal")}><strong>{orthogonalPlane==="sagittal"?"Sagital":"Coronal"}</strong><div className="viewer2-orthogonal-switch" role="group" aria-label="Plano ortogonal"><button type="button" className={orthogonalPlane==="sagittal"?"active":""} onClick={()=>setOrthogonalPlane("sagittal")}>Sagital</button><button type="button" className={orthogonalPlane==="coronal"?"active":""} onClick={()=>setOrthogonalPlane("coronal")}>Coronal</button></div><div className="viewer2-pane-actions"><button type="button" title="Mover painel" onClick={()=>moveWorkspacePaneForward("orthogonal")}>↔</button><button onClick={()=>resetPlane(orthogonalPlane)}>1:1</button>{expandButton("orthogonal","Ortogonal")}</div></div>
        {renderSliceControl(orthogonalPlane,orthogonalPlane==="sagittal"?"Sagital":"Coronal")}
        <div className={"viewer2-orthogonal-view "+(orthogonalPlane==="sagittal"?"is-active":"is-hidden")}><div className={"viewer2-canvas-wrap "+(deviceProfile!=="desktop"&&tool==="navigate"?"touch-scroll-friendly":"touch-tool-active")}><canvas className={tool==="navigate"?"crosshair-cursor":""} ref={canvases.sagittal} onWheel={e=>onWheel("sagittal",e)} onPointerDown={e=>onPointerDown("sagittal",e)} onPointerMove={e=>onPointerMove("sagittal",e)} onPointerUp={e=>onPointerUp("sagittal",e)} onPointerCancel={e=>onPointerUp("sagittal",e)}/></div></div>
        <div className={"viewer2-orthogonal-view "+(orthogonalPlane==="coronal"?"is-active":"is-hidden")}><div className={"viewer2-canvas-wrap "+(deviceProfile!=="desktop"&&tool==="navigate"?"touch-scroll-friendly":"touch-tool-active")}><canvas className={tool==="navigate"?"crosshair-cursor":""} ref={canvases.coronal} onWheel={e=>onWheel("coronal",e)} onPointerDown={e=>onPointerDown("coronal",e)} onPointerMove={e=>onPointerMove("coronal",e)} onPointerUp={e=>onPointerUp("coronal",e)} onPointerCancel={e=>onPointerUp("coronal",e)}/></div></div>
      </article>

      <article id="viewer2-3d" data-workspace-pane="3d" className={"viewer2-pane viewer2-workspace-pane viewer2-workspace-pane-3d "+workspaceSlotClass("3d")+(expandedPanel==="3d"?" is-expanded":"")}>
        <div className="viewer2-pane-head viewer2-drag-handle viewer2-3d-head" {...workspaceHeaderProps("3d")}><strong>3D • Planejamento</strong><div className="viewer2-pane-actions"><span className="viewer3d-badge">3D PROFISSIONAL</span><button type="button" title="Mover painel" onClick={()=>moveWorkspacePaneForward("3d")}>↔</button>{expandButton("3d","3D")}</div></div>
        <div className="viewer3d-primary">
          {threeDEnabled?<Viewer3DPanel
            key={expandedPanel==="3d"?"viewer3d-expanded":"viewer3d-standard"}
            volume={volumeRef.current}
            meta={meta}
            nervePoints={nerveDisplayPoints}
            curve={curve}
            cursor={cursor}
            crosshairVisible={crosshairVisible}
            onCrosshairVisibleChange={setCrosshairVisible}
            onCursorChange={updateCursorFrom3D}
            globalTool={tool}
            implants={implants}
            activeImplantId={activeImplantId}
            onImplantsChange={setImplants}
            onActiveImplantChange={setActiveImplantId}
            layoutMode={expandedPanel||"mosaic"}
            performanceProfile={deviceProfile}
          />:<div className="viewer3d-tablet-gate"><span className="viewer3d-tablet-icon">3D</span><strong>3D sob demanda no {deviceProfile==="tablet"?"tablet":"celular"}</strong><p>Os cortes MPR já estão disponíveis em resolução original. O 3D é carregado separadamente para não travar o dispositivo.</p><button type="button" onClick={()=>setThreeDEnabled(true)}>Ativar reconstrução 3D</button></div>}
        </div>
      </article>

      <article id="viewer2-panorama" data-workspace-pane="panoramic" className={"viewer2-pane panoramic viewer2-workspace-pane viewer2-workspace-pane-panoramic "+workspaceSlotClass("panoramic")+(expandedPanel==="panoramic"?" is-expanded":"")}>
        <div className="viewer2-pane-head viewer2-drag-handle" {...workspaceHeaderProps("panoramic")}><strong>Panorâmica reconstruída</strong><div className="viewer2-pane-actions"><button type="button" title="Mover painel" onClick={()=>moveWorkspacePaneForward("panoramic")}>↔</button><button onClick={()=>resetPlane("panoramic")}>1:1</button>{expandButton("panoramic","Panorâmica")}</div></div>
        {renderSliceControl("panoramic","Panorâmica reconstruída")}
        <div className={"viewer2-canvas-wrap viewer3d-pano-canvas "+(deviceProfile!=="desktop"&&tool==="navigate"?"touch-scroll-friendly":"touch-tool-active")}><canvas className={tool==="navigate"?"crosshair-cursor":""} ref={canvases.panoramic} onWheel={e=>onWheel("panoramic",e)} onPointerDown={e=>onPointerDown("panoramic",e)} onPointerMove={e=>onPointerMove("panoramic",e)} onPointerUp={e=>onPointerUp("panoramic",e)} onPointerCancel={e=>onPointerUp("panoramic",e)}/></div>
      </article>

      <button type="button" className="viewer2-tools-tab" aria-expanded={toolDrawerOpen} onClick={()=>setToolDrawerOpen(true)}>Ferramentas ‹</button>
      {toolDrawerOpen&&<button type="button" className="viewer2-tools-backdrop" aria-label="Fechar ferramentas" onClick={()=>setToolDrawerOpen(false)}/>} 
`;
source=source.slice(0,start)+newGrid+source.slice(aside);

replaceOnce('drawer opening',
  '      <aside className="viewer2-side">\n',
  '      <aside className={"viewer2-side viewer2-tools-drawer"+(toolDrawerOpen?" is-open":"")} aria-hidden={!toolDrawerOpen}>\n        <div className="viewer2-tools-drawer-head"><div><span>ODONTOVIEW</span><strong>Ferramentas</strong></div><div><button type="button" onClick={restoreWorkspaceLayout}>Restaurar layout</button><button type="button" className="viewer2-tools-close" aria-label="Fechar ferramentas" onClick={()=>setToolDrawerOpen(false)}>×</button></div></div>\n');

const cssMarker='/* ODONTOVIEW 3D-FIRST WORKSTATION */';
if(!css.includes(cssMarker)) css+=`\n\n${cssMarker}
.viewer2{background:#050b10;color:#e8f2f6}
.viewer2-top{background:linear-gradient(180deg,#0a1720,#071119);border-bottom:1px solid #243846}
.viewer2-toolbar{background:#08131c;border-bottom:1px solid #1b2e3a;gap:5px;padding:6px 10px}
.viewer2-toolbar>button,.viewer2-toolbar .wl-reset{min-height:34px}
.viewer2-wl-sliders,.viewer2-tool-state{display:none!important}
.viewer2-grid.viewer2-concept03.viewer2-workstation-grid{display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;grid-template-rows:minmax(250px,38vh) minmax(430px,57vh)!important;gap:4px!important;padding:4px!important;background:#02070b!important;position:relative;min-height:calc(100vh - 118px)}
.viewer2-workspace-pane{position:relative!important;min-width:0!important;min-height:0!important;margin:0!important;border:1px solid #263b49!important;border-radius:4px!important;background:#03090d!important;overflow:hidden!important;display:flex!important;flex-direction:column!important}
.viewer2-workspace-pane.workspace-slot-topLeft{grid-column:1/3!important;grid-row:1!important}
.viewer2-workspace-pane.workspace-slot-topCenter{grid-column:3/5!important;grid-row:1!important}
.viewer2-workspace-pane.workspace-slot-topRight{grid-column:5/7!important;grid-row:1!important}
.viewer2-workspace-pane.workspace-slot-bottomLeft{grid-column:1/5!important;grid-row:2!important}
.viewer2-workspace-pane.workspace-slot-bottomRight{grid-column:5/7!important;grid-row:2!important}
.viewer2-pane-head{min-height:34px!important;background:linear-gradient(180deg,#0e1b24,#09131a)!important;border-bottom:1px solid #233845!important;color:#dcebf0!important;padding:5px 8px!important}
.viewer2-drag-handle{cursor:grab}.viewer2-drag-handle:active{cursor:grabbing}
.viewer2-pane-actions button,.viewer2-orthogonal-switch button{background:#101f29!important;border:1px solid #304856!important;color:#cce0e7!important;border-radius:5px!important;min-width:30px!important;height:25px!important;padding:2px 7px!important}
.viewer2-orthogonal-switch{display:flex;gap:3px;margin-left:auto;margin-right:8px}.viewer2-orthogonal-switch button.active{border-color:#34d8d0!important;color:#72fff7!important;background:#0d3235!important}
.viewer2-orthogonal-view{flex:1;min-height:0}.viewer2-orthogonal-view.is-hidden{position:absolute!important;visibility:hidden!important;pointer-events:none!important;width:1px!important;height:1px!important;overflow:hidden!important}.viewer2-orthogonal-view.is-active{display:flex;flex-direction:column}
.viewer2-workspace-pane .viewer2-canvas-wrap{flex:1!important;min-height:0!important;background:#010305!important}
.viewer2-workspace-pane canvas{width:100%!important;height:100%!important}
.viewer2-workspace-pane-3d{border-color:#315764!important;box-shadow:inset 0 0 0 1px rgba(53,218,209,.08)}
.viewer2-workspace-pane-3d .viewer3d-primary,.viewer2-workspace-pane-3d .viewer3d-panel{height:100%!important;min-height:0!important;flex:1!important}
.viewer2-workspace-pane-3d .viewer3d-panel{display:grid!important;grid-template-rows:minmax(330px,1fr) auto!important;position:relative}
.viewer2-workspace-pane-3d .viewer3d-stage{min-height:330px!important;height:auto!important;border-radius:0!important}
.viewer2-workspace-pane-3d .viewer3d-controls{max-height:168px!important;overflow:auto!important;background:rgba(5,14,20,.97)!important;border-top:1px solid #263e4a!important;padding:6px 8px!important}
.viewer2-workspace-pane-3d .viewer3d-presentation-action,.viewer2-workspace-pane-3d .viewer3d-presets,.viewer2-workspace-pane-3d .viewer3d-switches,.viewer2-workspace-pane-3d .viewer3d-opacity,.viewer2-workspace-pane-3d .viewer3d-views,.viewer2-workspace-pane-3d .viewer3d-fusion{display:none!important}
.viewer2-workspace-pane-panoramic .viewer2-canvas-wrap{min-height:260px!important}
.viewer2-tools-tab{position:fixed;right:0;top:46%;z-index:1250;writing-mode:vertical-rl;transform:rotate(180deg);background:#0d303a!important;color:#bdfaf6!important;border:1px solid #2c6470!important;border-right:0!important;border-radius:7px 0 0 7px!important;padding:13px 7px!important;letter-spacing:.04em;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.28)}
.viewer2-tools-backdrop{position:fixed!important;inset:0!important;z-index:1280!important;background:rgba(0,7,11,.48)!important;border:0!important;border-radius:0!important}
.viewer2-side.viewer2-tools-drawer{display:block!important;position:fixed!important;z-index:1290!important;top:0!important;right:0!important;bottom:0!important;width:min(410px,92vw)!important;max-width:92vw!important;overflow:auto!important;background:#07131b!important;border-left:1px solid #2a4654!important;box-shadow:-18px 0 48px rgba(0,0,0,.42)!important;transform:translateX(104%)!important;transition:transform .2s ease!important;padding:0 10px 28px!important;margin:0!important}
.viewer2-side.viewer2-tools-drawer.is-open{transform:translateX(0)!important}
.viewer2-tools-drawer-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#081722;border-bottom:1px solid #294452;padding:12px 4px;margin:0 -2px 10px}.viewer2-tools-drawer-head>div:first-child{display:flex;flex-direction:column}.viewer2-tools-drawer-head span{font-size:9px;letter-spacing:.15em;color:#42d8d1}.viewer2-tools-drawer-head strong{font-size:17px;color:#eef8fb}.viewer2-tools-drawer-head>div:last-child{display:flex;gap:6px}.viewer2-tools-drawer-head button{background:#10232e;color:#d9ebf0;border:1px solid #34505d;border-radius:6px;padding:7px 9px}.viewer2-tools-close{font-size:18px!important;line-height:1!important}
.viewer2-side.viewer2-tools-drawer>section{background:#0b1922!important;border:1px solid #203745!important;border-radius:8px!important;margin:8px 0!important;padding:12px!important}
.viewer2-workstation-grid.has-expanded{grid-template-columns:1fr!important;grid-template-rows:minmax(650px,calc(100vh - 130px))!important}
.viewer2-workstation-grid.has-expanded .viewer2-workspace-pane:not(.is-expanded){display:none!important}.viewer2-workstation-grid.has-expanded .viewer2-workspace-pane.is-expanded{grid-column:1/-1!important;grid-row:1/-1!important}
.viewer2-workstation-grid.has-expanded .viewer2-workspace-pane-3d .viewer3d-controls{max-height:220px!important}
@media(max-width:1400px){.viewer2-grid.viewer2-concept03.viewer2-workstation-grid{grid-template-rows:minmax(230px,35vh) minmax(390px,55vh)!important}.viewer2-workspace-pane-3d .viewer3d-stage{min-height:290px!important}}
@media(max-width:900px){.viewer2-grid.viewer2-concept03.viewer2-workstation-grid{display:flex!important;flex-direction:column!important;min-height:0!important}.viewer2-workspace-pane{min-height:390px!important}.viewer2-workspace-pane-3d{order:-1;min-height:520px!important}.viewer2-workspace-pane-panoramic{min-height:340px!important}.viewer2-tools-tab{top:auto;bottom:82px}.viewer2-drag-handle{cursor:default}.viewer2-workspace-pane-3d .viewer3d-controls{max-height:none!important}}
`;

fs.writeFileSync(viewerPath,source);
fs.writeFileSync(cssPath,css);
console.log('Applied OdontoView 3D-first workspace layout.');
