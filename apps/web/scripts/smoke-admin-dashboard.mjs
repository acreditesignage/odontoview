import {spawn} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";

const BASE_URL=process.env.ADMIN_LAYOUT_SMOKE_URL||"http://127.0.0.1:4173/admin-layout-smoke";
const PORT=Number(process.env.ADMIN_LAYOUT_CDP_PORT||9225);
const OUT=new URL("../admin-layout-smoke/",import.meta.url);
const WIDTH=1664,HEIGHT=943;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitFor(fn,label,timeout=40000){const start=Date.now();while(Date.now()-start<timeout){try{const value=await fn();if(value)return value}catch{}await sleep(250)}throw new Error(`Timed out waiting for ${label}`)}
async function json(url){const response=await fetch(url);if(!response.ok)throw new Error(`${response.status} ${response.statusText}: ${url}`);return response.json()}
class Cdp{
  constructor(url){this.ws=new WebSocket(url);this.id=1;this.pending=new Map();this.events=[]}
  async open(){await new Promise((resolve,reject)=>{this.ws.addEventListener("open",resolve,{once:true});this.ws.addEventListener("error",reject,{once:true})});this.ws.addEventListener("message",event=>{const message=JSON.parse(event.data);if(message.id){const req=this.pending.get(message.id);if(!req)return;this.pending.delete(message.id);message.error?req.reject(new Error(message.error.message)):req.resolve(message.result)}else if(message.method)this.events.push(message)})}
  send(method,params={}){const id=this.id++;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}))})}
  close(){this.ws.close()}
}
async function evalJs(cdp,expression){const result=await cdp.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text||"Browser evaluation failed");return result.result?.value}
async function facts(cdp){return evalJs(cdp,`(() => {
  const rect=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
  return {
    viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
    document:{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,scrollHeight:document.documentElement.scrollHeight},
    header:rect(".admin-header"),main:rect(".admin-main"),metrics:rect(".admin-metrics"),trend:rect(".admin-trend"),online:rect(".admin-now"),ranks:rect(".admin-grid-ranks"),
    metricCount:document.querySelectorAll(".admin-metric").length,rankCount:document.querySelectorAll(".admin-grid-ranks .admin-panel").length,
    onlineRows:document.querySelectorAll(".admin-now-row").length,tableRows:document.querySelectorAll(".admin-activity tbody tr").length,
    title:document.querySelector(".admin-title-row h1")?.textContent||null
  };
})()`)}
function assertLayout(state){const failures=[];const need=(ok,msg)=>{if(!ok)failures.push(msg)};const usableWidth=state.document.clientWidth;need(state.viewport.width===WIDTH&&state.viewport.height===HEIGHT,`viewport ${state.viewport.width}x${state.viewport.height}`);need(usableWidth>=WIDTH-24,`usable viewport width ${usableWidth}`);need(state.document.scrollWidth<=usableWidth+2,`horizontal overflow ${state.document.scrollWidth} > ${usableWidth}`);need(state.header?.width>=usableWidth-2&&state.header?.right>=usableWidth-2,`header does not span usable viewport: ${state.header?.width}x right ${state.header?.right}`);need(state.main?.width>=1200,`main width ${state.main?.width}`);need(state.metricCount===4,`metric cards ${state.metricCount}`);need(state.metrics?.height>=120,`metrics height ${state.metrics?.height}`);need(state.trend?.width>=800,`trend width ${state.trend?.width}`);need(state.online?.width>=300,`online width ${state.online?.width}`);need(state.rankCount===4,`rank cards ${state.rankCount}`);need(state.onlineRows>=3,`online rows ${state.onlineRows}`);need(state.tableRows>=5,`activity rows ${state.tableRows}`);need(state.title==="O OdontoView em movimento.",`unexpected title ${state.title}`);if(failures.length)throw new Error("Admin desktop layout regression:\n- "+failures.join("\n- "))}
async function shot(cdp){const result=await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false,clip:{x:0,y:0,width:WIDTH,height:HEIGHT,scale:1}});const bytes=Buffer.from(result.data,"base64");if(bytes.length<25000)throw new Error(`Admin screenshot unexpectedly small: ${bytes.length}`);await writeFile(new URL("desktop-1664x943.png",OUT),bytes);return bytes.length}

async function main(){
  await mkdir(OUT,{recursive:true});
  await waitFor(async()=>{try{const r=await fetch(BASE_URL);return r.ok}catch{return false}},"Vite preview");
  const chrome=spawn(process.env.CHROME_BIN||"google-chrome",["--headless=new","--no-sandbox","--disable-dev-shm-usage",`--window-size=${WIDTH},${HEIGHT}`,`--remote-debugging-port=${PORT}`,"about:blank"],{stdio:"ignore"});
  let cdp;
  try{
    await waitFor(async()=>{try{return await json(`http://127.0.0.1:${PORT}/json/version`)}catch{return false}},"Chrome DevTools");
    const target=(await json(`http://127.0.0.1:${PORT}/json`)).find(item=>item.type==="page");if(!target?.webSocketDebuggerUrl)throw new Error("Chrome page target unavailable");
    cdp=new Cdp(target.webSocketDebuggerUrl);await cdp.open();await cdp.send("Page.enable");await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride",{width:WIDTH,height:HEIGHT,deviceScaleFactor:1,mobile:false,screenWidth:WIDTH,screenHeight:HEIGHT});
    await cdp.send("Page.navigate",{url:BASE_URL});
    await waitFor(()=>evalJs(cdp,`document.readyState==="complete"`),"page load");
    await waitFor(()=>evalJs(cdp,`Boolean(document.querySelector(".admin-shell"))`),"admin dashboard");
    await sleep(800);
    const state=await facts(cdp);const screenshotBytes=await shot(cdp);await writeFile(new URL("layout-facts.json",OUT),JSON.stringify(state,null,2));assertLayout(state);
    const exceptions=cdp.events.filter(event=>event.method==="Runtime.exceptionThrown");if(exceptions.length)throw new Error(`Browser exceptions observed: ${exceptions.length}`);
    console.log("ADMIN_LAYOUT_SMOKE_SUCCESS");console.log(JSON.stringify({screenshotBytes,...state},null,2));
  }finally{cdp?.close();chrome.kill("SIGTERM");await sleep(250);if(!chrome.killed)chrome.kill("SIGKILL")}
}
main().catch(error=>{console.error("ADMIN_LAYOUT_SMOKE_FAILURE");console.error(error);process.exitCode=1});
