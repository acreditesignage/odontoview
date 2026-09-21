'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {zipSync}=require('fflate');
const {dicomFixture}=require('./helpers/dicom-fixture.cjs');
const {rar4Fixture,rar5Fixture}=require('./helpers/rar-fixture.cjs');
const root=path.resolve(__dirname,'..');
const libraries={
  'cornerstone-core@2.6.1/dist/cornerstone.min.js':require.resolve('cornerstone-core/dist/cornerstone.min.js'),
  'dicom-parser@1.8.21/dist/dicomParser.min.js':require.resolve('dicom-parser/dist/dicomParser.min.js'),
  'cornerstone-wado-image-loader@4.13.2/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js':require.resolve('cornerstone-wado-image-loader/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js')
};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(error,content)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.js':'application/javascript','.wasm':'application/wasm','.html':'text/html','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(content);});
});
const entries=()=>Object.fromEntries([0,1,2].map(z=>[`exam/folder/${z}.dcm`,dicomFixture(z)]));
const uploadFile=(name,buffer)=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(buffer)});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try {
    for(const mobile of [false,true]) {
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1360,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
      await context.route('https://unpkg.com/**',route=>{const library=libraries[new URL(route.request().url()).pathname.slice(1)];return library?route.fulfill({path:library,contentType:'application/javascript'}):route.abort();});
      const page=await context.newPage();let dialogs=[];const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
      await page.goto(url);
      async function upload(name,buffer){dialogs=[];await page.locator('#fileInput').setInputFiles(uploadFile(name,buffer));await page.waitForFunction(()=>!document.querySelector('#loading').classList.contains('show'));}
      for(const [name,pack] of [['exam.zip',zipSync],['rar4.rar',rar4Fixture],['rar5.rar',rar5Fixture]]) {
        await upload(name,pack(entries()));assert.deepEqual(dialogs,[]);
        assert.match(await page.locator('#status').textContent(),/16×16×3/);
        await page.waitForFunction(()=>document.querySelector('#canvasAxial')._map);
      }
      console.log('PASS '+(mobile?'mobile':'desktop')+' ZIP, RAR4 and RAR5 extraction and MPR');
      const oldStatus=await page.locator('#status').textContent();
      const oldPixels=await page.locator('#canvasAxial').evaluate(el=>el.toDataURL());
      const oversized=dicomFixture(0);
      for(const tag of [0x10,0x11]) {
        const at=oversized.indexOf(Buffer.from([0x28,0,tag,0,0x55,0x53,2,0]));
        assert.ok(at>0);oversized.writeUInt16LE(16384,at+8);
      }
      for(const [name,buffer,message] of [
        ['empty.zip',zipSync({'manual.txt':Buffer.from('hello')}),/Nenhum.*DICOM/i],
        ['bad.zip',Buffer.from('broken'),/inválido/i],
        ['exam.part1.rar',rar4Fixture(entries()),/partes/i],
        ['bad-dicom.zip',zipSync({'bad.dcm':Buffer.from('broken')}),/DICOM/i],
        ['oversized.zip',zipSync({'large.dcm':oversized}),/256 MB/i],
        ['no-pixels.zip',zipSync({'no-pixels.dcm':dicomFixture(0).subarray(0,dicomFixture(0).indexOf(Buffer.from([0xe0,0x7f,0x10,0,0x4f,0x57])))}),/abrir|pixel|DICOM/i],
        ['password.zip',fs.readFileSync(path.join(__dirname,'fixtures/deflate-encrypted.zip')),/senha/i]
      ]) {await upload(name,buffer);assert.equal(dialogs.length,1);assert.match(dialogs[0],message);assert.equal(await page.locator('#status').textContent(),oldStatus);assert.equal(await page.locator('#canvasAxial').evaluate(el=>el.toDataURL()),oldPixels);}
      console.log('PASS errors preserve current exam');
      const multiple=zipSync({...entries(),'second/0.dcm':dicomFixture(0,{series:'9.8.7'}),'second/1.dcm':dicomFixture(1,{series:'9.8.7'})});
      await page.locator('#fileInput').setInputFiles(uploadFile('multiple.zip',multiple));
      await page.locator('.archive-series').waitFor();
      const rect=await page.locator('.archive-series').boundingBox();assert.ok(rect.width<=(mobile?390:1360));
      await page.locator('.archive-series button').filter({hasText:'2 fatia(s)'}).click();
      await page.waitForFunction(()=>!document.querySelector('#loading').classList.contains('show'));
      assert.match(await page.locator('#status').textContent(),/16×16×2/);
      await page.locator('#fileInput').setInputFiles(uploadFile('multiple.zip',multiple));
      await page.locator('.archive-series').waitFor();await page.getByRole('button',{name:'Cancelar',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('#loading').classList.contains('show'));
      assert.match(await page.locator('#status').textContent(),/16×16×2/);
      // Delay the actual worker script to make cancellation deterministic.
      await page.route('**/js/archive-worker.js',async route=>{await new Promise(resolve=>setTimeout(resolve,300));await route.continue().catch(()=>{});});
      await page.locator('#fileInput').setInputFiles(uploadFile('cancel.zip',zipSync(entries())));
      await page.getByRole('button',{name:'Cancelar importação'}).click();
      await page.waitForFunction(()=>!document.querySelector('#loading').classList.contains('show'));
      assert.match(await page.locator('#status').textContent(),/16×16×2/);
      assert.deepEqual(errors,[]);console.log('PASS series selection, dialog cancel and extraction cancel');
      await context.close();
    }
    const context=await browser.newContext();const page=await context.newPage();
    await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
    await page.waitForFunction(async()=>!!(await caches.match('./vendor/libarchive/libarchive.wasm')));
    await context.setOffline(true);await page.reload();
    await page.locator('#fileInput').setInputFiles(uploadFile('offline.rar',rar5Fixture(entries())));
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('16×16×3'));
    console.log('PASS offline PWA RAR extraction and DICOM rendering after warm-up');await context.close();
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
