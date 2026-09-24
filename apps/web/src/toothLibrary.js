const POSITION_LABELS={
  1:"Incisivo central",
  2:"Incisivo lateral",
  3:"Canino",
  4:"1º pré-molar",
  5:"2º pré-molar",
  6:"1º molar",
  7:"2º molar",
  8:"3º molar"
};

const CLASS_BY_POSITION={
  1:"incisor",2:"incisor",3:"canine",4:"premolar",5:"premolar",6:"molar",7:"molar",8:"molar"
};

const CLASS_LABELS={
  incisor:"Incisivo",
  canine:"Canino",
  premolar:"Pré-molar",
  molar:"Molar"
};

function makeTooth(fdi){
  const value=Number(fdi);
  const quadrant=Math.floor(value/10);
  const position=value%10;
  const arch=quadrant<=2?"maxilla":"mandible";
  const side=quadrant===1||quadrant===4?"right":"left";
  return {
    id:`tooth-${value}`,
    fdi:String(value),
    quadrant,
    position,
    arch,
    archLabel:arch==="maxilla"?"Maxila":"Mandíbula",
    side,
    sideLabel:side==="right"?"Direito":"Esquerdo",
    toothClass:CLASS_BY_POSITION[position],
    classLabel:CLASS_LABELS[CLASS_BY_POSITION[position]],
    label:POSITION_LABELS[position],
    fullLabel:`${value} · ${POSITION_LABELS[position]}`,
    dentition:"permanent",
    geometry:"catalog-marker",
    geometryValidated:false,
    meshKey:null,
    meshStatus:"pending"
  };
}

export const PERMANENT_FDI_LIBRARY=[
  ...[1,2,3,4,5,6,7,8].map(n=>makeTooth(10+n)),
  ...[1,2,3,4,5,6,7,8].map(n=>makeTooth(20+n)),
  ...[1,2,3,4,5,6,7,8].map(n=>makeTooth(30+n)),
  ...[1,2,3,4,5,6,7,8].map(n=>makeTooth(40+n))
];

export const TOOTH_ARCH_ROWS=[
  {key:"maxilla",label:"Maxila",fdi:["18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28"]},
  {key:"mandible",label:"Mandíbula",fdi:["48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38"]}
];

const BY_FDI=new Map(PERMANENT_FDI_LIBRARY.map(item=>[item.fdi,item]));

export function toothByFDI(fdi){
  return BY_FDI.get(String(fdi))||null;
}
