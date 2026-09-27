import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const URL = process.env.GEOMETRY_LAB_URL || 'http://127.0.0.1:4173/implant-geometry-lab';
const PORT = Number(process.env.GEOMETRY_LAB_CDP_PORT || 9222);
const OUT = new URL('../implant-geometry-lab-smoke/', import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const value = await fn(); if (value) return value; } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

class Cdp {
  constructor(url) { this.ws = new WebSocket(url); this.id = 1; this.pending = new Map(); this.events = []; }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
      } else if (message.method) this.events.push(message);
    });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); }
}

async function evalJs(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result?.value;
}

async function viewport(cdp) {
  return evalJs(cdp, `(() => { const r=document.querySelector('.implant-geometry-lab__viewport')?.getBoundingClientRect(); return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null; })()`);
}

async function shot(cdp, name, page = false) {
  let params = { format: 'png', fromSurface: true };
  let rect = null;
  if (!page) {
    rect = await viewport(cdp);
    if (!rect || rect.width < 200 || rect.height < 200) throw new Error(`Invalid viewport: ${JSON.stringify(rect)}`);
    params.clip = { ...rect, scale: 1 };
  }
  const result = await cdp.send('Page.captureScreenshot', params);
  const bytes = Buffer.from(result.data, 'base64');
  if (bytes.length < 6000) throw new Error(`${name} screenshot is unexpectedly small: ${bytes.length}`);
  await writeFile(new URL(`${name}.png`, OUT), bytes);
  return { data: result.data, bytes: bytes.length, rect };
}

async function drag(cdp, rect, dx, dy, button = 'left', buttons = 1) {
  const x = rect.x + rect.width * 0.55;
  const y = rect.y + rect.height * 0.52;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 });
  for (let i = 1; i <= 6; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * i / 6, y: y + dy * i / 6, button, buttons });
    await sleep(45);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button, buttons: 0, clickCount: 1 });
  await sleep(450);
}

async function facts(cdp) {
  return evalJs(cdp, `(() => ({
    text:(document.querySelector('.implant-geometry-lab__facts')?.innerText || '').toLowerCase(),
    canvas:(()=>{const c=document.querySelector('.implant-geometry-lab__viewport canvas');return c?{width:c.width,height:c.height}:null})(),
    href:location.href
  }))()`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => { try { const r=await fetch(URL); return r.ok; } catch { return false; } }, 'Vite preview');

  const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--window-size=1440,1000',
    `--remote-debugging-port=${PORT}`,'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    await waitFor(async () => { try { return await json(`http://127.0.0.1:${PORT}/json/version`); } catch { return false; } }, 'Chrome DevTools');
    const target = (await json(`http://127.0.0.1:${PORT}/json`)).find((item) => item.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('Chrome page target unavailable');
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.open();
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Page.navigate', { url: URL });
    await waitFor(() => evalJs(cdp, `document.readyState==='complete'`), 'page load');
    await sleep(1200);

    await shot(cdp, '00-page-loaded', true);
    await waitFor(async () => {
      const state = await facts(cdp);
      return state.canvas?.width > 200 && state.canvas?.height > 200
        && state.text.includes('stl-ascii')
        && state.text.includes('validatedgeometry') && state.text.includes('false')
        && state.text.includes('redistributionallowed') && state.text.includes('unknown');
    }, 'ASCII geometry render');

    const initial = await shot(cdp, '01-ascii-initial');
    await drag(cdp, initial.rect, 140, -75);
    const orbit = await shot(cdp, '02-ascii-orbited');
    if (orbit.data === initial.data) throw new Error('Orbit did not change viewport');

    const x = initial.rect.x + initial.rect.width / 2, y = initial.rect.y + initial.rect.height / 2;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaY: -420, deltaX: 0 });
    await sleep(450);
    const zoom = await shot(cdp, '03-ascii-zoomed');
    if (zoom.data === orbit.data) throw new Error('Zoom did not change viewport');

    await drag(cdp, initial.rect, -90, 70, 'right', 2);
    const pan = await shot(cdp, '04-ascii-panned');
    if (pan.data === zoom.data) throw new Error('Pan did not change viewport');

    await evalJs(cdp, `document.querySelector('.implant-geometry-lab__panel button')?.click()`);
    await sleep(500);
    await shot(cdp, '05-ascii-reset');

    const switched = await evalJs(cdp, `(() => { const s=[...document.querySelectorAll('.implant-geometry-lab__panel select')][3]; if(!s||s.options.length<2)return false; s.value=s.options[1].value; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    if (!switched) throw new Error('Could not switch to Binary variant');
    const binaryFacts = await waitFor(async () => {
      const state = await facts(cdp);
      return state.text.includes('stl-binary') && state.text.includes('synthetic-tetrahedron-binary.stl') ? state : false;
    }, 'Binary geometry render');
    await sleep(450);
    const binary = await shot(cdp, '06-binary-variant');

    const exceptions = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown');
    if (exceptions.length) throw new Error(`Browser exceptions observed: ${exceptions.length}`);

    console.log('GEOMETRY_LAB_SMOKE_SUCCESS');
    console.log(JSON.stringify({
      ascii: { format: 'stl-ascii', canvas: (await facts(cdp)).canvas },
      interactions: { orbit: orbit.data !== initial.data, zoom: zoom.data !== orbit.data, pan: pan.data !== zoom.data, reset: true },
      binary: { format: 'stl-binary', sourceConfirmed: binaryFacts.text.includes('synthetic-tetrahedron-binary.stl') },
      safety: { validatedGeometry: false, redistributionAllowed: 'unknown' },
      screenshotBytes: { initial: initial.bytes, orbit: orbit.bytes, zoom: zoom.bytes, pan: pan.bytes, binary: binary.bytes },
    }, null, 2));
  } finally {
    cdp?.close(); chrome.kill('SIGTERM'); await sleep(250); if (!chrome.killed) chrome.kill('SIGKILL');
  }
}

main().catch((error) => { console.error('GEOMETRY_LAB_SMOKE_FAILURE'); console.error(error); process.exitCode = 1; });
