// Minimal stored RAR4 and RAR5 writers for synthetic test fixtures only.
// Header layouts follow RARLAB's archive format documentation.
const crc32=data=>{
  let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
};
function rar4Header(type,flags,body){
  const h=Buffer.alloc(7+body.length);h[2]=type;h.writeUInt16LE(flags,3);h.writeUInt16LE(h.length,5);body.copy(h,7);
  h.writeUInt16LE(crc32(h.subarray(2))&0xffff,0);return h;
}
function rar4Fixture(files){
  const parts=[Buffer.from([0x52,0x61,0x72,0x21,0x1a,7,0]),rar4Header(0x73,0,Buffer.alloc(6))];
  for(const [name,raw] of Object.entries(files)){
    const data=Buffer.from(raw),n=Buffer.from(name),body=Buffer.alloc(25+n.length);
    body.writeUInt32LE(data.length,0);body.writeUInt32LE(data.length,4);body[8]=2;
    body.writeUInt32LE(crc32(data),9);body[17]=20;body[18]=0x30;body.writeUInt16LE(n.length,19);body.writeUInt32LE(0x20,21);n.copy(body,25);
    parts.push(rar4Header(0x74,0x8000,body),data);
  }
  parts.push(rar4Header(0x7b,0,Buffer.alloc(0)));return Buffer.concat(parts);
}
function vint(value){const bytes=[];do{const byte=value&127;value=Math.floor(value/128);bytes.push(byte|(value?128:0));}while(value);return Buffer.from(bytes);}
function rar5Header(type,flags,body,dataSize){
  const header=Buffer.concat([vint(type),vint(flags),...(dataSize===undefined?[]:[vint(dataSize)]),body]);
  const sized=Buffer.concat([vint(header.length),header]),crc=Buffer.alloc(4);crc.writeUInt32LE(crc32(sized));return Buffer.concat([crc,sized]);
}
function rar5Fixture(files){
  const parts=[Buffer.from([0x52,0x61,0x72,0x21,0x1a,7,1,0]),rar5Header(1,0,vint(0))];
  for(const [name,raw] of Object.entries(files)){
    const data=Buffer.from(raw),n=Buffer.from(name),crc=Buffer.alloc(4);crc.writeUInt32LE(crc32(data));
    const body=Buffer.concat([vint(4),vint(data.length),vint(0x20),crc,vint(0),vint(0),vint(n.length),n]);
    parts.push(rar5Header(2,2,body,data.length),data);
  }
  parts.push(rar5Header(5,0,vint(0)));return Buffer.concat(parts);
}
module.exports={rar4Fixture,rar5Fixture};
