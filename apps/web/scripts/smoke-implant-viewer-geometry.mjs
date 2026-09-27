import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL=process.env.IMPLANT_VIEWER_SMOKE_URL||'http://127.0.0.1:4173/implant-viewer-geometry-smoke';
const PORT=Number(process.env.IMPLANT_VIEWER_CDP_PORT||9223);
const OUT=new URL('../implant-viewer-geometry-smoke/',import.meta.url);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitFor(fn,label,timeout=35000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    try{const value=await fn();if(value)return value}catch{}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function json(url){const response=await fetch(url);if(!response.ok)throw new Error(`${response.status} ${response.statusText}: ${url}`);return response.json()}

class Cdp{
  constructor(url){this.ws=new WebSocket(url);this.id=1;this.pending=new Map();this.events=[]}
  async open(){
    await new Promise((resolve,reject)=>{this.ws.addEventListener('open',resolve,{once:true});this.ws.addEventListener('error',reject,{once:true})});
    this.ws.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.id){const req=this.pending.get(message.id);if(!req)return;this.pending.delete(message.id);message.error?req.reject(new Error(message.error.message)):req.resolve(message.result)}
      else if(message.method)this.events.push(message);
    });
  }
  send(method,params={}){const id=this.id++;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}))})}
  close(){this.ws.close()}
}

async function evalJs(cdp,expression){
  const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.text||'Browser evaluation failed');
  return result.result?.value;
}

async function facts(cdp){
  return evalJs(cdp,`(() => {
    const stage=document.querySelector('.viewer3d-stage');
    const canvas=stage?.querySelector('canvas');
    const phase=document.querySelector('[data-smoke-phase]');
    const count=document.querySelector('[data-smoke-count]');
    const pos=document.querySelector('[data-smoke-x]');
    return {
      href:location.href,
      ready:Boolean(document.querySelector('.viewer3d-engine-badge')),
      mode:stage?.dataset?.implantGeometryMode||null,
      canvas:canvas?{width:canvas.width,height:canvas.height}:null,
      phase:phase?.dataset?.smokePhase||null,
      count:Number(count?.dataset?.smokeCount??-1),
      x:pos?.dataset?.smokeX||null,
      ry:pos?.dataset?.smokeRy||null,
      text:(document.body.innerText||'').toLowerCase()
    };
  })()`);
}

async function stageRect(cdp){
  return evalJs(cdp,`(() => {const r=document.querySelector('.viewer3d-stage')?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()`);
}

async function shot(cdp,name){
  const rect=await stageRect(cdp);
  if(!rect||rect.width<250||rect.height<250)throw new Error(`Invalid Viewer3D stage: ${JSON.stringify(rect)}`);
  const result=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,clip:{...rect,scale:1}});
  const bytes=Buffer.from(result.data,'base64');
  if(bytes.length<6000)throw new Error(`${name} screenshot is unexpectedly small: ${bytes.length}`);
  await writeFile(new URL(`${name}.png`,OUT),bytes);
  return {data:result.data,bytes:bytes.length,rect};
}

async function click(cdp,action){
  const ok=await evalJs(cdp,`(() => {const b=document.querySelector('[data-smoke-action="${action}"]');if(!b)return false;b.click();return true})()`);
  if(!ok)throw new Error(`Smoke action not found: ${action}`);
  await sleep(700);
}

async function main(){
  await mkdir(OUT,{recursive:true});
  await waitFor(async()=>{try{const r=await fetch(BASE_URL);return r.ok}catch{return false}},'Vite preview');

  const chrome=spawn(process.env.CHROME_BIN||'google-chrome',[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--window-size=1600,1100',
    `--remote-debugging-port=${PORT}`,'about:blank',
  ],{stdio:'ignore'});
  let cdp;
  try{
    await waitFor(async()=>{try{return await json(`http://127.0.0.1:${PORT}/json/version`)}catch{return false}},'Chrome DevTools');
    const target=(await json(`http://127.0.0.1:${PORT}/json`)).find(item=>item.type==='page');
    if(!target?.webSocketDebuggerUrl)throw new Error('Chrome page target unavailable');
    cdp=new Cdp(target.webSocketDebuggerUrl);await cdp.open();
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Page.navigate',{url:BASE_URL});
    await waitFor(()=>evalJs(cdp,`document.readyState==='complete'`),'page load');

    const initialFacts=await waitFor(async()=>{
      const state=await facts(cdp);
      return state.ready&&state.mode==='mesh'&&state.canvas?.width>250&&state.canvas?.height>250
        &&state.text.includes('geometria real local')&&state.text.includes('validatedgeometry: false')?state:false;
    },'geometry-backed implant in Viewer3D');
    await sleep(800);
    const initial=await shot(cdp,'01-mesh-initial');

    await click(cdp,'move');
    const movedFacts=await waitFor(async()=>{const state=await facts(cdp);return state.phase==='mesh-moved'&&Number(state.x)>24?state:false},'implant XYZ translation');
    const moved=await shot(cdp,'02-mesh-moved');
    if(moved.data===initial.data)throw new Error('XYZ movement did not change Viewer3D pixels');

    await click(cdp,'rotate');
    const rotatedFacts=await waitFor(async()=>{const state=await facts(cdp);return state.phase==='mesh-rotated'&&Number(state.ry)>=52?state:false},'implant rotation');
    const rotated=await shot(cdp,'03-mesh-rotated');
    if(rotated.data===moved.data)throw new Error('Rotation did not change Viewer3D pixels');

    await click(cdp,'replace');
    const replacedFacts=await waitFor(async()=>{const state=await facts(cdp);return state.phase==='mesh-replaced'&&state.mode==='mesh'&&state.text.includes('synthetic-viewer-replacement.stl')?state:false},'mesh replacement');
    const replaced=await shot(cdp,'04-mesh-replaced');
    if(replaced.data===rotated.data)throw new Error('Replacing geometry did not change Viewer3D pixels');

    await click(cdp,'fallback');
    const fallbackFacts=await waitFor(async()=>{const state=await facts(cdp);return state.phase==='parametric-fallback'&&state.mode==='parametric'&&state.text.includes('geometria paramétrica beta')?state:false},'parametric fallback');
    const fallback=await shot(cdp,'05-parametric-fallback');
    if(fallback.data===replaced.data)throw new Error('Parametric fallback did not change Viewer3D pixels');

    await click(cdp,'restore');
    await waitFor(async()=>{const state=await facts(cdp);return state.phase==='mesh-restored'&&state.mode==='mesh'?state:false},'mesh restoration');
    await shot(cdp,'06-mesh-restored');

    await click(cdp,'remove');
    const removedFacts=await waitFor(async()=>{const state=await facts(cdp);return state.phase==='removed'&&state.count===0?state:false},'implant removal');
    const removed=await shot(cdp,'07-implant-removed');

    const exceptions=cdp.events.filter(event=>event.method==='Runtime.exceptionThrown');
    if(exceptions.length)throw new Error(`Browser exceptions observed: ${exceptions.length}`);

    console.log('IMPLANT_VIEWER_GEOMETRY_SMOKE_SUCCESS');
    console.log(JSON.stringify({
      initial:{mode:initialFacts.mode,canvas:initialFacts.canvas},
      translation:{x:movedFacts.x,pixelsChanged:moved.data!==initial.data},
      rotation:{ry:rotatedFacts.ry,pixelsChanged:rotated.data!==moved.data},
      replacement:{mode:replacedFacts.mode,pixelsChanged:replaced.data!==rotated.data},
      fallback:{mode:fallbackFacts.mode,pixelsChanged:fallback.data!==replaced.data},
      removal:{count:removedFacts.count,screenshotBytes:removed.bytes},
      browserExceptions:0,
    },null,2));
  }finally{
    cdp?.close();chrome.kill('SIGTERM');await sleep(250);if(!chrome.killed)chrome.kill('SIGKILL');
  }
}

main().catch(error=>{console.error('IMPLANT_VIEWER_GEOMETRY_SMOKE_FAILURE');console.error(error);process.exitCode=1});
