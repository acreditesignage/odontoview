(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OdontoArchiveCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const defaults = { maxInputBytes: 128*1024*1024, maxOutputBytes: 256*1024*1024, maxEntryBytes: 32*1024*1024, maxEntries: 5000 };
  // Validate the block envelope before libarchive's streaming reader can accept
  // an incomplete volume. Payload decoding and CRC checks remain in libarchive.
  function checkRar(bytes) {
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const bad=()=>{throw new Error('RAR corrompido ou incompleto. Baixe novamente o arquivo.');};
    const split=()=>{throw new Error('RAR dividido em partes não é suportado.');};
    const password=()=>{throw new Error('RAR protegido por senha não é suportado.');};
    if(bytes[6]===0) {
      let offset=7;
      while(offset+7<=bytes.length) {
        const type=bytes[offset+2], flags=view.getUint16(offset+3,true), size=view.getUint16(offset+5,true);
        if(size<7||offset+size>bytes.length) bad();
        if(type===0x73) {if(flags&1) split();if(flags&0x80) password();}
        if(type===0x74 && flags&3) split();
        let data=0;
        if(flags&0x8000) {if(size<11) bad();data=view.getUint32(offset+7,true);}
        if(type===0x74 && flags&0x100) {if(size<40) bad();data+=view.getUint32(offset+32,true)*4294967296;}
        if(type===0x7b) {if(flags&1) split();return;}
        offset+=size+data;
        if(offset>bytes.length) bad();
      }
      bad();
    } else if(bytes[6]===1 && bytes[7]===0) {
      let offset=8;
      while(offset+5<=bytes.length) {
        let cursor=offset+4, bound=bytes.length;
        const vint=()=>{
          let value=0,multiplier=1;
          for(let i=0;i<10;i++) {
            if(cursor>=bound) bad();
            const byte=bytes[cursor++];value+=(byte&127)*multiplier;
            if(!Number.isSafeInteger(value)) bad();
            if(!(byte&128)) return value;
            multiplier*=128;
          }
          bad();
        };
        const size=vint();bound=cursor+size;
        if(bound>bytes.length) bad();
        const type=vint(),flags=vint();
        if(flags&1) vint();
        const data=flags&2?vint():0;
        if(flags&0x18) split();
        if(type===4) password();
        if(type===1 && vint()&1) split();
        if(type===5) {if(vint()&1) split();return;}
        offset=bound+data;
        if(offset>bytes.length) bad();
      }
      bad();
    } else bad();
  }
  function extract(Module, input, options = {}) {
    const limits = { ...defaults, ...options.limits };
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > limits.maxInputBytes) throw new Error('O arquivo excede o limite de 128 MB compactados.');
    const zip = bytes[0]===80 && bytes[1]===75 && ((bytes[2]===3 && bytes[3]===4)||(bytes[2]===5 && bytes[3]===6));
    const rar = bytes[0]===82 && bytes[1]===97 && bytes[2]===114 && bytes[3]===33 && bytes[4]===26 && bytes[5]===7;
    if (!zip && !rar) throw new Error('Arquivo compactado inválido. Selecione um ZIP ou RAR completo.');
    if(rar) checkRar(bytes);
    let expectedEntries = null;
    if (zip) {
      // libarchive also supports streaming incomplete ZIPs. A medical series
      // must only be opened after the complete central-directory footer exists.
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      let end=-1;
      for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) {
        if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
      }
      if(end<0) throw new Error('ZIP corrompido ou incompleto. Baixe novamente o arquivo.');
      if(view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0 || view.getUint16(end+8,true)!==view.getUint16(end+10,true)) throw new Error('ZIP dividido em partes não é suportado.');
      expectedEntries=view.getUint16(end+10,true);
      if(expectedEntries>limits.maxEntries) throw new Error('O ZIP excede o limite de entradas.');
      if(view.getUint32(end+12,true)+view.getUint32(end+16,true)>end) throw new Error('ZIP corrompido ou incompleto.');
    }
    const bind=(name,result,args)=>Module.cwrap(name,result,args);
    const next=bind('archive_read_next_entry','number',['number']);
    const pathname=bind('archive_entry_pathname_utf8','string',['number']);
    const size=bind('archive_entry_size','number',['number']);
    const type=bind('archive_entry_filetype','number',['number']);
    const encrypted=bind('archive_entry_is_encrypted','number',['number']);
    const read=bind('archive_read_data','number',['number','number','number']);
    const error=bind('archive_error_string','string',['number']);
    const free=bind('archive_read_free','number',['number']);
    let ptr=0, chunk=0, archive=0, count=0, total=0;
    const files=[];
    const fail=()=>{ throw new Error('Não foi possível extrair: arquivo corrompido, incompleto ou protegido por senha.'); };
    try {
      ptr=Module._malloc(bytes.length); if (!ptr) throw new Error('Memória insuficiente para abrir o arquivo.');
      Module.HEAPU8.set(bytes,ptr);
      archive=bind('archive_read_new','number',[])(); if (!archive) fail();
      if (bind('archive_read_support_filter_all','number',['number'])(archive)!==0 ||
          bind('archive_read_support_format_all','number',['number'])(archive)!==0 ||
          bind('archive_read_open_memory','number',['number','number','number'])(archive,ptr,bytes.length)!==0) fail();
      chunk=Module._malloc(65536); if (!chunk) throw new Error('Memória insuficiente para extrair.');
      while (true) {
        const entry=next(archive);
        if (!entry) { if (error(archive)) fail(); break; }
        if (++count>limits.maxEntries) throw new Error('O arquivo excede o limite de 5000 entradas.');
        if (encrypted(entry)>0) throw new Error('Arquivos protegidos por senha não são suportados.');
        const name=(pathname(entry)||'').replace(/\\/g,'/');
        if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new Error('Caminho inválido dentro do arquivo compactado.');
        const length=size(entry);
        if (!Number.isSafeInteger(length)||length<0||length>limits.maxEntryBytes) throw new Error('Uma entrada excede o limite de 32 MB.');
        total+=length;
        if (total>limits.maxOutputBytes) throw new Error('O exame excede o limite de 256 MB descompactados.');
        if (type(entry)!==32768) continue;
        const data=new Uint8Array(length); let offset=0;
        while (true) {
          const n=read(archive,chunk,65536);
          if (n<0) fail();
          if (!n) break;
          if (offset+n>length) fail();
          data.set(Module.HEAPU8.subarray(chunk,chunk+n),offset); offset+=n;
        }
        if (offset!==length) fail();
        const base=name.split('/').pop();
        if (base.toUpperCase()!=='DICOMDIR' && (/\.(dcm|dicom|ima)$/i.test(base) || (data[128]===68&&data[129]===73&&data[130]===67&&data[131]===77))) files.push({name,buffer:data.buffer});
        if (options.onProgress) options.onProgress({entries:count,bytes:total});
      }
      if(expectedEntries!==null && count!==expectedEntries) fail();
      return {files,entries:count,bytes:total};
    } finally {
      if (archive) free(archive);
      if (chunk) Module._free(chunk);
      if (ptr) Module._free(ptr);
    }
  }
  return {extract,defaults};
});
