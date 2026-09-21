(function () {
  'use strict';
  const workerUrl = new URL('./archive-worker.js', document.currentScript.src);
  const abortError = () => new DOMException('Importação cancelada.', 'AbortError');
  function isArchive(file) {
    return /\.(zip|rar|r\d\d|z\d\d|zip\.\d+)$/i.test(file.name) || /(?:zip|rar)/i.test(file.type);
  }
  function extract(file, {signal, onProgress} = {}) {
    return new Promise((resolve,reject) => {
      if (signal?.aborted) return reject(abortError());
      if (/\.part\d+\.rar$|\.[rz]\d\d$|\.zip\.\d+$/i.test(file.name)) return reject(new Error('Arquivos divididos em partes não são suportados. Use um ZIP ou RAR único.'));
      if (file.size > 128*1024*1024) return reject(new Error('O arquivo excede o limite de 128 MB compactados.'));
      const worker = new Worker(workerUrl);
      const cleanup = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort',cancel); };
      const finish = (error,result) => {cleanup(); error ? reject(error) : resolve(result);};
      const cancel = () => finish(abortError());
      const timer = setTimeout(()=>finish(new Error('A extração excedeu o tempo disponível. Tente um exame menor.')),120000);
      signal?.addEventListener('abort',cancel,{once:true});
      worker.onerror = () => finish(new Error('Não foi possível iniciar o extrator. Conecte-se à internet e reabra o aplicativo.'));
      worker.onmessage = ({data}) => {
        if (data.type==='progress') onProgress?.(data);
        if (data.type==='error') finish(new Error(data.message));
        if (data.type==='done') {
          if (!data.files.length) return finish(new Error('Nenhum arquivo DICOM encontrado no ZIP ou RAR.'));
          finish(null,data.files.map(item=>new File([item.buffer],item.name,{type:'application/dicom'})));
        }
      };
      worker.postMessage({file});
    });
  }
  function chooseSeries(report, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (report.series.length===1) return Promise.resolve(report.series[0].items);
    return new Promise((resolve,reject) => {
      const dialog=document.createElement('dialog');
      dialog.className='archive-series';
      dialog.setAttribute('aria-labelledby','archiveSeriesTitle');
      const title=document.createElement('h2'); title.id='archiveSeriesTitle'; title.textContent='Escolha a série para abrir'; dialog.append(title);
      const hint=document.createElement('p'); hint.textContent='O arquivo contém mais de uma série DICOM. Abra uma de cada vez.'; dialog.append(hint);
      const close=(value,error)=>{signal?.removeEventListener('abort',cancel);dialog.close();dialog.remove();error?reject(error):resolve(value);};
      const cancel=()=>close(null,abortError());
      for (const [index,series] of report.series.entries()) {
        const item=series.items[0]||{};
        const button=document.createElement('button'); button.type='button'; button.disabled=!series.valid;
        button.textContent=`${item.seriesDescription || 'Série '+(index+1)} • ${series.items.length} fatia(s) • ${item.rows||'?'} × ${item.columns||'?'}${series.valid?'':' • incompatível'}`;
        button.addEventListener('click',()=>close(series.items)); dialog.append(button);
        if (!series.valid) {const reason=document.createElement('p');reason.textContent=series.errors.map(error=>error.message).join(' ');dialog.append(reason);}
      }
      const cancelButton=document.createElement('button');cancelButton.type='button';cancelButton.textContent='Cancelar';cancelButton.addEventListener('click',cancel);dialog.append(cancelButton);
      dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
      signal?.addEventListener('abort',cancel,{once:true});
      document.body.append(dialog);dialog.showModal();
    });
  }
  window.OdontoArchiveImport={isArchive,extract,chooseSeries};
})();
