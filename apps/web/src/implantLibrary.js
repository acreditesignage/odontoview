const FAMILY_LABELS={
  "GM HELIX IMPLANT":"GM Helix",
  "GM TITAMAX IMPLANT":"GM Titamax"
};

function series(family,start,diameter,lengths){
  return lengths.map((length,index)=>{
    const numeric=Number(start)+index;
    const model="109."+String(numeric).padStart(3,"0");
    return {
      id:`neodent-${model.replace(".","-")}`,
      manufacturer:"Neodent",
      connection:"Grand Morse",
      family,
      familyLabel:FAMILY_LABELS[family]||family,
      model,
      diameter,
      length,
      geometry:"parametric-beta",
      geometryValidated:false
    };
  });
}

/**
 * Pilot catalog from the Neodent GM metadata used during the OdontoView
 * planning prototype. Geometry is intentionally NOT bundled here: until a
 * manufacturer-authorized mesh is available, the viewer renders a parametric
 * envelope using the catalog diameter and length.
 */
export const NEODENT_GM_LIBRARY=[
  ...series("GM HELIX IMPLANT",943,3.5,[8,10,11.5,13,16]),
  ...series("GM HELIX IMPLANT",948,4.3,[8,10,11.5,13,16]),
  ...series("GM HELIX IMPLANT",953,5.0,[8,10,11.5,13,16]),
  ...series("GM HELIX IMPLANT",976,3.75,[8,10,11.5,13,16,18]),
  ...series("GM TITAMAX IMPLANT",899,3.75,[7,8,9,11,13,15,17]),
  ...series("GM TITAMAX IMPLANT",906,3.5,[7,8,9,11,13,15,17]),
  ...series("GM TITAMAX IMPLANT",913,4.0,[7,8,9,11,13,15,17]),
  ...series("GM TITAMAX IMPLANT",920,5.0,[7,8,9,11,13])
];

export function implantAxisVector(implant){
  const d=Math.PI/180;
  const rx=(implant?.rx||0)*d,ry=(implant?.ry||0)*d,rz=(implant?.rz||0)*d;
  let x=0,y=0,z=1;
  // Rx
  let ny=y*Math.cos(rx)-z*Math.sin(rx),nz=y*Math.sin(rx)+z*Math.cos(rx);
  y=ny;z=nz;
  // Ry
  let nx=x*Math.cos(ry)+z*Math.sin(ry);nz=-x*Math.sin(ry)+z*Math.cos(ry);
  x=nx;z=nz;
  // Rz
  nx=x*Math.cos(rz)-y*Math.sin(rz);ny=x*Math.sin(rz)+y*Math.cos(rz);
  x=nx;y=ny;
  const len=Math.hypot(x,y,z)||1;
  return {x:x/len,y:y/len,z:z/len};
}
