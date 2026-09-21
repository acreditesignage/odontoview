'use strict';
importScripts('../vendor/libarchive/libarchive.js', './archive-core.js');
self.onmessage = async ({data}) => {
  try {
    const Module = await libarchive({locateFile: name => new URL('../vendor/libarchive/'+name, self.location.href).href});
    const result = OdontoArchiveCore.extract(Module, await data.file.arrayBuffer(), {
      onProgress: progress => self.postMessage({type:'progress', ...progress})
    });
    self.postMessage({type:'done', files:result.files}, result.files.map(file=>file.buffer));
  } catch (error) {
    self.postMessage({type:'error', message:error.message || 'Não foi possível extrair o arquivo.'});
  }
};
