'use strict';
// Run with NODE_PATH pointing at dependencies, or install the development dependencies.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {dicomFixture}=require('./helpers/dicom-fixture.cjs');
const root=path.resolve(__dirname,'..');
const libraries={
  'cornerstone-core@2.6.1/dist/cornerstone.min.js':require.resolve('cornerstone-core/dist/cornerstone.min.js'),
  'dicom-parser@1.8.21/dist/dicomParser.min.js':require.resolve('dicom-parser/dist/dicomParser.min.js'),
  'cornerstone-wado-image-loader@4.13.2/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js':require.resolve('cornerstone-wado-image-loader/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js')
};
const mime={'.html':'text/html','.js':'application/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(error,content)=>{
    if(error){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.end(content);
  });
});
function file(z,overrides={}){return {name:`slice-${z}.dcm`,mimeType:'application/dicom',buffer:dicomFixture(z,overrides)};}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try {
    const context=await browser.newContext({viewport:{width:1360,height:900},serviceWorkers:'block'});
    await context.route('https://unpkg.com/**',async route=>{
      const key=new URL(route.request().url()).pathname.slice(1);
      if(libraries[key]) await route.fulfill({path:libraries[key],contentType:'application/javascript'});
      else await route.abort();
    });
    await context.route('https://fonts.googleapis.com/**',route=>route.abort());
    const page=await context.newPage();
    const failures=[];
    page.on('pageerror',error=>failures.push(error.message));
    let dialogs=[];
    page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>!!window.cornerstoneWADOImageLoader);
    async function upload(files){
      dialogs=[];
      await page.locator('#fileInput').setInputFiles(files);
      await page.waitForFunction(()=>!document.querySelector('#loading').classList.contains('show'));
    }
    // The old loader assembles a mixed volume: this must fail before integration.
    await upload([file(0),file(1,{series:'9.8.7'})]);
    assert.equal(dialogs.length,1,'mixed series must produce an actionable validation dialog');
    assert.match(dialogs[0],/série/i);
    assert.equal(await page.locator('#mprGrid').evaluate(el=>el.classList.contains('show')),false);
    console.log('PASS mixed series blocked before first volume');

    await upload([file(2),file(1),file(0)]);
    assert.deepEqual(dialogs,[]);
    await page.waitForFunction(()=>document.querySelector('#canvasAxial')._map);
    assert.match(await page.locator('#status').textContent(),/16×16×3/);
    assert.equal(await page.locator('#sliceRange').getAttribute('max'),'2');
    const canvasPixels=()=>page.locator('#canvasAxial').evaluate(el=>el.toDataURL());
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const reversedPixels=await canvasPixels();
    await upload([file(0),file(1),file(2)]);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await canvasPixels(),reversedPixels,'normal and reversed input must render identically');
    const validName=await page.locator('#fileName').textContent();
    const validStatus=await page.locator('#status').textContent();
    console.log('PASS reversed synthetic DICOM decoded and rendered');

    for(const [name,files,expected] of [
      ['duplicate',[file(0),file(0)],/repetidos|mesma posição/i],
      ['rows mismatch',[file(0),file(1,{rows:8})],/Rows\/Columns/i],
      ['spacing mismatch',[file(0),file(1,{spacing:'0.8\\0.5'})],/Pixel Spacing/i],
      ['mixed frame',[file(0),file(1,{frame:'9.8.7'})],/série|referência/i],
      ['gap',[file(0),file(1),file(3)],/lacuna|irregular/i],
      ['multi-frame',[file(0,{frames:'3'})],/multi-frame/i],
      ['corrupt',[{name:'broken.dcm',mimeType:'application/dicom',buffer:Buffer.from('not dicom')}],/DICOM/i]
    ]){
      await upload(files);
      assert.equal(dialogs.length,1,name+' must report an error');
      assert.match(dialogs[0],expected);
      assert.equal(await page.locator('#fileName').textContent(),validName);
      assert.equal(await page.locator('#status').textContent(),validStatus);
      assert.equal(await page.locator('#mprGrid').evaluate(el=>el.classList.contains('show')),true);
      console.log('PASS '+name+' rejected, previous exam retained');
    }
    await page.locator('#adjustImage').click();
    await page.locator('#brightnessRange').fill('20');
    assert.equal(await page.locator('#brightnessValue').textContent(),'20');
    await page.locator('#artifactBtn').click();
    await page.waitForFunction(()=>document.querySelector('#artifactBtn').classList.contains('artifact-on') && !document.querySelector('#loading').classList.contains('show'));
    await page.locator('#noiseBtn').click();
    await page.waitForFunction(()=>document.querySelector('#noiseBtn').classList.contains('noise-on') && !document.querySelector('#loading').classList.contains('show'));
    await page.locator('#rulerBtn').click();
    assert.equal(await page.locator('#rulerBtn').evaluate(el=>el.classList.contains('ruler-on')),true);
    const rulerPoints=await page.locator('#canvasAxial').evaluate(el=>{
      const rect=el.getBoundingClientRect(), map=el._map, ratio=rect.width/el.width;
      return [2,6].map(x=>({x:(map.ox+(x+0.5)*map.scale)*ratio,y:(map.oy+2.5*map.scale)*ratio}));
    });
    for(const point of rulerPoints) await page.locator('#canvasAxial').click({position:point});
    assert.match(await page.locator('#measureValue').textContent(),/2[.,]0+\s*mm/);
    await page.locator('#viewerArcade').selectOption('superior');
    assert.equal(await page.locator('#reportArcade').inputValue(),'superior');
    console.log('PASS brightness, filters, ruler activation and existing arcada selector');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1kAAAAASUVORK5CYII=','base64');
    await upload([{name:'test.png',mimeType:'image/png',buffer:png}]);
    await page.waitForFunction(()=>document.querySelector('#imageViewport').naturalWidth>0);
    assert.equal(await page.locator('#mprGrid').evaluate(el=>el.classList.contains('show')),false);
    assert.match(await page.locator('#status').textContent(),/Imagem local/);
    await upload([file(0),file(1,{series:'9.8.7'})]);
    assert.equal(await page.locator('#imageViewport').evaluate(el=>getComputedStyle(el).display),'block');
    assert.match(await page.locator('#status').textContent(),/Imagem local/);
    assert.deepEqual(failures,[],'no browser execution errors');
    console.log('PASS PNG and invalid DICOM preserves the 2D image');
    await context.close();

    // Keep the existing SW/cache unchanged; verify its normal runtime caching path.
    const pwa=await browser.newContext({viewport:{width:1360,height:900}});
    const pwaPage=await pwa.newPage();
    await pwaPage.goto(`http://127.0.0.1:${server.address().port}/`);
    await pwaPage.evaluate(()=>navigator.serviceWorker.ready);
    await pwaPage.reload();
    await pwaPage.waitForFunction(async()=>!!(await caches.match('./js/dicom-metadata.js')));
    await pwa.setOffline(true);
    await pwaPage.reload();
    assert.equal(await pwaPage.evaluate(()=>typeof window.OdontoDicomMetadata?.validateImport),'function');
    assert.equal(await pwaPage.locator('#openButton').count(),1);
    await pwaPage.locator('#fileInput').setInputFiles([file(0),file(1),file(2)]);
    await pwaPage.waitForFunction(()=>document.querySelector('#status').textContent.includes('16×16×3'));
    console.log('PASS PWA shell, metadata and synthetic DICOM load offline after online cache warm-up');
    await pwa.close();
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
