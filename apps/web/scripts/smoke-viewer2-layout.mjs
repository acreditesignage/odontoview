import {spawn} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";

const BASE_URL=process.env.VIEWER2_LAYOUT_SMOKE_URL||"http://127.0.0.1:4173/viewer2-layout-smoke";
const PORT=Number(process.env.VIEWER2_LAYOUT_CDP_PORT||9224);
const OUT=new URL("../viewer2-layout-smoke/",import.meta.url);
const WIDTH=1664;
const HEIGHT=943;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitFor(fn,label,timeout=50000){
  const start=Date.now();
  while(Date.now()-start<timeout){
    try{const value=await fn();if(value)return value}catch{}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function json(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}
class Cdp{
  constructor(url){this.ws=new WebSocket(url);this.id=1;this.pending=new Map();this.events=[]}
  async open(){
    await new Promise((resolve,reject)=>{
      this.ws.addEventListener("open",resolve,{once:true});
      this.ws.addEventListener("error",reject,{once:true});
    });
    this.ws.addEventListener("message",event=>{
      const message=JSON.parse(event.data);
      if(message.id){
        const req=this.pending.get(message.id);
        if(!req)return;
        this.pending.delete(message.id);
        message.error?req.reject(new Error(message.error.message)):req.resolve(message.result);
      }else if(message.method)this.events.push(message);
    });
  }
  send(method,params={}){
    const id=this.id++;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      this.ws.send(JSON.stringify({id,method,params}));
    });
  }
  close(){this.ws.close()}
}
async function evalJs(cdp,expression){
  const result=await cdp.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.text||"Browser evaluation failed");
  return result.result?.value;
}
async function clickText(cdp,text){
  const result=await evalJs(cdp,`(() => {
    const target=${JSON.stringify(text)};
    const button=[...document.querySelectorAll("button")].find(item=>(item.innerText||"").trim().startsWith(target));
    if(!button)return false;
    button.click();
    return true;
  })()`);
  if(!result)throw new Error(`Button not found: ${text}`);
}
async function facts(cdp){
  return evalJs(cdp,`(() => {
    const rect=selector=>{
      const element=document.querySelector(selector);
      if(!element)return null;
      const r=element.getBoundingClientRect();
      const style=getComputedStyle(element);
      return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,display:style.display,visibility:style.visibility,overflowY:style.overflowY};
    };
    const pane=id=>rect("#"+id);
    const viewer=rect(".viewer2.is-desktop");
    const grid=rect(".viewer2-workstation-grid");
    const planner=rect("#viewer2-3d .viewer3d-controls");
    const stage=rect("#viewer2-3d .viewer3d-stage");
    const canvas=rect("#viewer2-3d .viewer3d-stage canvas");
    return {
      viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
      document:{
        scrollWidth:document.documentElement.scrollWidth,
        scrollHeight:document.documentElement.scrollHeight,
        bodyScrollWidth:document.body.scrollWidth,
        bodyScrollHeight:document.body.scrollHeight
      },
      viewer,grid,planner,stage,canvas,
      panes:{
        tangential:pane("viewer2-tangential"),
        axial:pane("viewer2-axial"),
        orthogonal:pane("viewer2-orthogonal"),
        three:pane("viewer2-3d"),
        panoramic:pane("viewer2-panorama")
      },
      intro:Boolean(document.querySelector(".viewer-boot")),
      archModal:Boolean(document.querySelector(".viewer2-arch-setup")),
      error:document.querySelector("[data-layout-smoke-error]")?.innerText||null
    };
  })()`);
}
function assertLayout(state){
  const failures=[];
  const need=(ok,message)=>{if(!ok)failures.push(message)};
  need(!state.error,`fixture error: ${state.error||""}`);
  need(state.viewport.width===WIDTH&&state.viewport.height===HEIGHT,`viewport is ${state.viewport.width}x${state.viewport.height}`);
  need(state.viewer?.width>=WIDTH-2,`viewer width ${state.viewer?.width}`);
  need(state.viewer?.height>=HEIGHT-2,`viewer height ${state.viewer?.height}`);
  need(state.document.scrollWidth<=WIDTH+2,`document horizontal overflow ${state.document.scrollWidth}`);
  need(state.document.scrollHeight<=HEIGHT+2,`document vertical overflow ${state.document.scrollHeight}`);
  need(state.grid?.right>=WIDTH-2,`grid leaves a right dead strip: right=${state.grid?.right}`);
  need(state.grid?.bottom>=HEIGHT-2,`grid does not reach viewport bottom: bottom=${state.grid?.bottom}`);
  for(const [name,pane] of Object.entries(state.panes)){
    need(Boolean(pane),`${name} pane missing`);
    if(!pane)continue;
    need(pane.width>=240,`${name} pane too narrow: ${Math.round(pane.width)}px`);
    need(pane.height>=300,`${name} pane too short: ${Math.round(pane.height)}px`);
  }
  need(state.panes.three?.width>=650,`3D pane too narrow: ${Math.round(state.panes.three?.width||0)}px`);
  need(state.panes.three?.height>=400,`3D pane too short: ${Math.round(state.panes.three?.height||0)}px`);
  need(state.panes.panoramic?.width>=300,`panoramic pane too narrow: ${Math.round(state.panes.panoramic?.width||0)}px`);
  need(state.planner?.width>=315&&state.planner?.width<=420,`planning rail width out of range: ${Math.round(state.planner?.width||0)}px`);
  need(state.planner?.right>=WIDTH-8,`planning rail is not docked right: right=${state.planner?.right}`);
  need(state.stage?.width>=600&&state.stage?.height>=320,`3D stage too small: ${Math.round(state.stage?.width||0)}x${Math.round(state.stage?.height||0)}`);
  need(state.canvas?.width>=500&&state.canvas?.height>=280,`3D canvas too small: ${Math.round(state.canvas?.width||0)}x${Math.round(state.canvas?.height||0)}`);
  if(failures.length)throw new Error("Desktop planning layout regression:\n- "+failures.join("\n- "));
}
async function shot(cdp){
  const result=await cdp.send("Page.captureScreenshot",{
    format:"png",
    fromSurface:true,
    captureBeyondViewport:false,
    clip:{x:0,y:0,width:WIDTH,height:HEIGHT,scale:1}
  });
  const bytes=Buffer.from(result.data,"base64");
  if(bytes.length<20000)throw new Error(`Layout screenshot unexpectedly small: ${bytes.length}`);
  await writeFile(new URL("desktop-1664x943.png",OUT),bytes);
  return bytes.length;
}

async function main(){
  await mkdir(OUT,{recursive:true});
  await waitFor(async()=>{try{const response=await fetch(BASE_URL);return response.ok}catch{return false}},"Vite preview");
  const chrome=spawn(process.env.CHROME_BIN||"google-chrome",[
    "--headless=new","--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader",
    `--window-size=${WIDTH},${HEIGHT}`,`--remote-debugging-port=${PORT}`,"about:blank"
  ],{stdio:"ignore"});
  let cdp;
  try{
    await waitFor(async()=>{try{return await json(`http://127.0.0.1:${PORT}/json/version`)}catch{return false}},"Chrome DevTools");
    const target=(await json(`http://127.0.0.1:${PORT}/json`)).find(item=>item.type==="page");
    if(!target?.webSocketDebuggerUrl)throw new Error("Chrome page target unavailable");
    cdp=new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride",{
      width:WIDTH,height:HEIGHT,deviceScaleFactor:1,mobile:false,
      screenWidth:WIDTH,screenHeight:HEIGHT
    });
    await cdp.send("Page.navigate",{url:BASE_URL});
    await waitFor(()=>evalJs(cdp,`document.readyState==="complete"`),"page load");
    await waitFor(()=>evalJs(cdp,`Boolean(document.querySelector(".viewer2.is-desktop")) || document.querySelector("[data-layout-smoke-error]")?.innerText`),"real Viewer2 mount");

    const fixtureError=await evalJs(cdp,`document.querySelector("[data-layout-smoke-error]")?.innerText||""`);
    if(fixtureError)throw new Error(fixtureError);

    await waitFor(()=>evalJs(cdp,`Boolean(document.querySelector(".viewer2-arch-setup"))`),"arch setup modal");
    await clickText(cdp,"Não sei");
    await waitFor(()=>evalJs(cdp,`[...document.querySelectorAll(".viewer2-arch-setup button")].some(button=>(button.innerText||"").trim().startsWith("Arcada inteira"))`),"arch extent step");
    await clickText(cdp,"Arcada inteira");
    await waitFor(()=>evalJs(cdp,`!document.querySelector(".viewer2-arch-setup")`),"arch setup close");
    await waitFor(()=>evalJs(cdp,`document.querySelector("#viewer2-3d .viewer3d-stage canvas")?.width>250`),"3D canvas");
    await sleep(2800);

    const state=await facts(cdp);
    const screenshotBytes=await shot(cdp);
    await writeFile(new URL("layout-facts.json",OUT),JSON.stringify(state,null,2));
    assertLayout(state);

    const exceptions=cdp.events.filter(event=>event.method==="Runtime.exceptionThrown");
    if(exceptions.length)throw new Error(`Browser exceptions observed: ${exceptions.length}`);

    console.log("VIEWER2_LAYOUT_SMOKE_SUCCESS");
    console.log(JSON.stringify({screenshotBytes,...state},null,2));
  }finally{
    cdp?.close();
    chrome.kill("SIGTERM");
    await sleep(250);
    if(!chrome.killed)chrome.kill("SIGKILL");
  }
}
main().catch(error=>{
  console.error("VIEWER2_LAYOUT_SMOKE_FAILURE");
  console.error(error);
  process.exitCode=1;
});
