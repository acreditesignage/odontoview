'use strict';
// Synthetic, tiny Explicit VR Little Endian CT files. No patient data.
function element(group, tag, vr, value) {
  let bytes;
  if (vr === 'US') { bytes=Buffer.alloc(2); bytes.writeUInt16LE(value); }
  else if (Buffer.isBuffer(value)) bytes=value;
  else bytes=Buffer.from(String(value),'ascii');
  if (bytes.length % 2) bytes=Buffer.concat([bytes,Buffer.from([vr === 'UI' ? 0 : 32])]);
  const long = ['OW','OB','SQ','UN','UT'].includes(vr);
  const header=Buffer.alloc(long ? 12 : 8);
  header.writeUInt16LE(group,0); header.writeUInt16LE(tag,2); header.write(vr,4);
  if (long) header.writeUInt32LE(bytes.length,8); else header.writeUInt16LE(bytes.length,6);
  return Buffer.concat([header,bytes]);
}
function dicomFixture(z=0, overrides={}) {
  const data={ study:'1.2.3.1',series:'1.2.3.2',frame:'1.2.3.3',sop:`1.2.3.4.${z+100}`,
    rows:16,columns:16,position:`0\\0\\${z}`,orientation:'1\\0\\0\\0\\1\\0',
    spacing:'0.3\\0.5',frames:'1', ...overrides };
  const pixels=Buffer.alloc(data.rows*data.columns*2);
  for(let i=0;i<data.rows*data.columns;i++) pixels.writeUInt16LE((i*13+z*100)%2000,i*2);
  const entries=[
    [0x0002,0x0001,'OB',Buffer.from([0,1])],
    [0x0002,0x0002,'UI','1.2.840.10008.5.1.4.1.1.2'],
    [0x0002,0x0003,'UI',data.sop],
    [0x0002,0x0010,'UI','1.2.840.10008.1.2.1'],
    [0x0008,0x0016,'UI','1.2.840.10008.5.1.4.1.1.2'],
    [0x0008,0x0018,'UI',data.sop], [0x0008,0x0060,'CS','CT'],
    [0x0008,0x1030,'LO','Synthetic study'],[0x0008,0x103e,'LO','Synthetic series'],
    [0x0018,0x0050,'DS','1'],[0x0018,0x0088,'DS','1'],
    [0x0020,0x000d,'UI',data.study],[0x0020,0x000e,'UI',data.series],
    [0x0020,0x0013,'IS',String(50-z)],
    [0x0020,0x0032,'DS',data.position],[0x0020,0x0037,'DS',data.orientation],
    [0x0020,0x0052,'UI',data.frame],
    [0x0028,0x0002,'US',1],[0x0028,0x0004,'CS','MONOCHROME2'],
    [0x0028,0x0008,'IS',data.frames],
    [0x0028,0x0010,'US',data.rows],[0x0028,0x0011,'US',data.columns],
    [0x0028,0x0030,'DS',data.spacing],
    [0x0028,0x0100,'US',16],[0x0028,0x0101,'US',16],[0x0028,0x0102,'US',15],[0x0028,0x0103,'US',0],
    [0x0028,0x1050,'DS','1000'],[0x0028,0x1051,'DS','2000'],
    [0x0028,0x1052,'DS','0'],[0x0028,0x1053,'DS','1'],
    [0x7fe0,0x0010,'OW',pixels]
  ];
  return Buffer.concat([Buffer.alloc(128),Buffer.from('DICM'),...entries.filter(e=>e[3]!==null).map(e=>element(...e))]);
}
module.exports={dicomFixture};
