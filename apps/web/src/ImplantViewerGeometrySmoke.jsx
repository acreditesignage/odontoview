import React,{useEffect,useMemo,useState} from 'react';
import Viewer3DPanel from './Viewer3DPanel.jsx';
import {
  IDENTITY_MATRIX_4X4,
  makeLocalImplantGeometryKey,
  registerLocalImplantGeometry,
  unregisterImplantGeometry,
} from './library/implant/index.js';

const IMPLANT_ID='smoke-implant';
const GEOMETRY_KEY=makeLocalImplantGeometryKey({implantId:IMPLANT_ID});

function normal([a,b,c]){
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2];
  const vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
  const length=Math.hypot(x,y,z)||1;
  return [x/length,y/length,z/length];
}

function asciiMeshBytes(name,points,faces){
  const lines=[`solid ${name}`];
  faces.forEach(([ia,ib,ic])=>{
    const triangle=[points[ia],points[ib],points[ic]];
    lines.push(`facet normal ${normal(triangle).join(' ')}`,'outer loop');
    triangle.forEach(p=>lines.push(`vertex ${p.join(' ')}`));
    lines.push('endloop','endfacet');
  });
  lines.push(`endsolid ${name}`,'');
  return new TextEncoder().encode(lines.join('\n'));
}

const PRIMARY_POINTS=[[-1.4,-1.0,-5.5],[1.8,-.8,-4.8],[-1.1,1.3,-4.4],[.35,.15,6.6],[2.6,.2,-1.2]];
const PRIMARY_FACES=[[0,2,1],[0,1,3],[1,2,3],[2,0,3],[1,4,3],[4,2,3],[1,2,4]];
const REPLACEMENT_POINTS=[[-2.0,-.8,-6.0],[1.1,-1.4,-5.3],[-1.4,1.0,-4.7],[.7,.4,8.0],[3.5,.3,-.5]];
const REPLACEMENT_FACES=PRIMARY_FACES;

function primaryBytes(){return asciiMeshBytes('viewer-smoke-primary',PRIMARY_POINTS,PRIMARY_FACES)}
function replacementBytes(){return asciiMeshBytes('viewer-smoke-replacement',REPLACEMENT_POINTS,REPLACEMENT_FACES)}

function volumeData(){
  const w=48,h=48,d=48;
  const data=new Int16Array(w*h*d);
  const cx=(w-1)/2,cy=(h-1)/2,cz=(d-1)/2;
  for(let z=0;z<d;z++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const dx=x-cx,dy=y-cy,dz=z-cz;
    const r=Math.hypot(dx,dy,dz);
    data[z*w*h+y*w+x]=r<17?900:r<20?350:-900;
  }
  return data;
}

const META={w:48,h:48,d:48,spacingX:1,spacingY:1,spacingZ:1,manufacturer:'OdontoView',model:'Synthetic Smoke'};
const CURSOR={x:24,y:24,z:24};

function implantFromEntry(entry){
  return {
    id:IMPLANT_ID,
    catalogId:'smoke-catalog',
    manufacturer:'OdontoView',
    connection:'Synthetic',
    family:'SMOKE',
    familyLabel:'Smoke geometry',
    model:'SMOKE-001',
    diameter:3.5,
    length:11,
    geometry:'local-stl',
    geometryValidated:false,
    x:24,y:24,z:24,rx:0,ry:0,rz:0,
    geometryKey:GEOMETRY_KEY,
    geometryMode:'mesh',
    geometryLocalTransform:[...IDENTITY_MATRIX_4X4],
    geometrySafety:{validatedGeometry:false,redistributionAllowed:'unknown'},
    geometryProvenance:{sourceKind:'local-file',filename:'synthetic-viewer-primary.stl'},
    geometryDiagnostics:{...entry.diagnostics},
    geometrySmokeRevision:1,
  };
}

export default function ImplantViewerGeometrySmoke(){
  const volume=useMemo(()=>volumeData(),[]);
  const [implants,setImplants]=useState([]);
  const [activeImplantId,setActiveImplantId]=useState(IMPLANT_ID);
  const [cursor,setCursor]=useState(CURSOR);
  const [phase,setPhase]=useState('boot');
  const [crosshairVisible,setCrosshairVisible]=useState(true);

  useEffect(()=>{
    const entry=registerLocalImplantGeometry({geometryKey:GEOMETRY_KEY,filename:'synthetic-viewer-primary.stl',bytes:primaryBytes()});
    setImplants([implantFromEntry(entry)]);
    setPhase('mesh-primary');
    return()=>unregisterImplantGeometry(GEOMETRY_KEY);
  },[]);

  function patchActive(patch){
    setImplants(items=>items.map(item=>item.id===activeImplantId?{...item,...(typeof patch==='function'?patch(item):patch)}:item));
  }

  function move(){patchActive(item=>({x:item.x+7}));setPhase('mesh-moved')}
  function rotate(){patchActive(item=>({ry:(item.ry||0)+52,rz:(item.rz||0)+17}));setPhase('mesh-rotated')}
  function replace(){
    const entry=registerLocalImplantGeometry({geometryKey:GEOMETRY_KEY,filename:'synthetic-viewer-replacement.stl',bytes:replacementBytes()});
    patchActive(item=>({
      geometrySmokeRevision:(item.geometrySmokeRevision||0)+1,
      geometryProvenance:{sourceKind:'local-file',filename:'synthetic-viewer-replacement.stl'},
      geometryDiagnostics:{...entry.diagnostics},
    }));
    setPhase('mesh-replaced');
  }
  function fallback(){
    unregisterImplantGeometry(GEOMETRY_KEY);
    patchActive({geometryKey:undefined,geometryMode:'parametric'});
    setPhase('parametric-fallback');
  }
  function restore(){
    const entry=registerLocalImplantGeometry({geometryKey:GEOMETRY_KEY,filename:'synthetic-viewer-primary.stl',bytes:primaryBytes()});
    patchActive(item=>({
      geometryKey:GEOMETRY_KEY,
      geometryMode:'mesh',
      geometrySmokeRevision:(item.geometrySmokeRevision||0)+1,
      geometryProvenance:{sourceKind:'local-file',filename:'synthetic-viewer-primary.stl'},
      geometryDiagnostics:{...entry.diagnostics},
    }));
    setPhase('mesh-restored');
  }
  function remove(){
    unregisterImplantGeometry(GEOMETRY_KEY);
    setImplants([]);
    setActiveImplantId(null);
    setPhase('removed');
  }

  const active=implants.find(item=>item.id===activeImplantId)||null;

  return <main data-smoke-page="implant-viewer-geometry" style={{minHeight:'100vh',background:'#071421',color:'#eaf8ff',padding:'12px'}}>
    <section style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',marginBottom:'10px'}}>
      <strong>OdontoView Viewer Geometry Smoke</strong>
      <button data-smoke-action="move" onClick={move}>Move X</button>
      <button data-smoke-action="rotate" onClick={rotate}>Rotate</button>
      <button data-smoke-action="replace" onClick={replace}>Replace mesh</button>
      <button data-smoke-action="fallback" onClick={fallback}>Parametric fallback</button>
      <button data-smoke-action="restore" onClick={restore}>Restore mesh</button>
      <button data-smoke-action="remove" onClick={remove}>Remove implant</button>
      <span data-smoke-phase={phase}>{phase}</span>
      <span data-smoke-count={implants.length}>count:{implants.length}</span>
      <span data-smoke-x={active?.x??'none'} data-smoke-ry={active?.ry??'none'}>x:{active?.x??'—'} ry:{active?.ry??'—'}</span>
    </section>
    <section data-smoke-viewer-shell style={{height:'calc(100vh - 70px)',minHeight:'700px'}}>
      <Viewer3DPanel
        volume={volume}
        meta={META}
        nervePoints={[]}
        curve={[]}
        cursor={cursor}
        crosshairVisible={crosshairVisible}
        onCrosshairVisibleChange={setCrosshairVisible}
        onCursorChange={setCursor}
        globalTool="measure"
        implants={implants}
        activeImplantId={activeImplantId}
        onImplantsChange={setImplants}
        onActiveImplantChange={setActiveImplantId}
        layoutMode="expanded"
        performanceProfile="desktop"
      />
    </section>
  </main>;
}
