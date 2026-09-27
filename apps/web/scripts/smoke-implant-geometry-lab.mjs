import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE_URL = process.env.GEOMETRY_LAB_URL || 'http://127.0.0.1:4173/implant-geometry-lab';
const CDP_PORT = Number(process.env.GEOMETRY_LAB_CDP_PORT || 9222);
const OUT_DIR = new URL('../implant-geometry-lab-smoke/', import.meta.url);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForHttp(url) {
  await waitFor(async () => {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      return response.status >= 200 && response.status < 500;
    } catch {
      return false;
    }
  }, `HTTP ${url}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        else pending.resolve(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.ws.close(); }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result?.value;
}

async function diagnostic(client) {
  return evaluate(client, `(() => {
    const canvas=document.querySelector('.implant-geometry-lab__viewport canvas');
    let webgl=false;
    try { webgl=Boolean(canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'))); } catch {}
    return {
      href: location.href,
      body: (document.body?.innerText || '').slice(0, 1800),
      lab: Boolean(document.querySelector('.implant-geometry-lab')),
      canvas: canvas ? {width:canvas.width,height:canvas.height,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight} : null,
      webgl,
    };
  })()`);
}

async function viewportRect(client) {
  return evaluate(client, `(() => {
    const el=document.querySelector('.implant-geometry-lab__viewport');
    if(!el) return null;
    const r=el.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  })()`);
}

async function screenshot(client, name, viewportOnly = true) {
  let params = { format: 'png', fromSurface: true };
  let rect = null;
  if (viewportOnly) {
    rect = await viewportRect(client);
    if (!rect || rect.width < 200 || rect.height < 200) throw new Error(`Viewport unavailable: ${JSON.stringify(rect)}`);
    params = { ...params, clip: { ...rect, scale: 1 } };
  }
  const result = await client.send('Page.captureScreenshot', params);
  const bytes = Buffer.from(result.data, 'base64');
  if (bytes.length < 6000) throw new Error(`${name}: screenshot too small (${bytes.length} bytes)`);
  await writeFile(new URL(`${name}.png`, OUT_DIR), bytes);
  return { data: result.data, bytes: bytes.length, rect };
}

async function drag(client, rect, { dx, dy, button = 'left', buttons = 1 }) {
  const x = rect.x + rect.width * 0.55;
  const y = rect.y + rect.height * 0.52;
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x + (dx * step) / 6,
      y: y + (dy * step) / 6,
      button,
      buttons,
    });
    await sleep(45);
  }
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x + dx, y: y + dy, button, buttons: 0, clickCount: 1,
  });
  await sleep(450);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await waitForHttp(BASE_URL);

  const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--window-size=1440,1000',
    `--remote-debugging-port=${CDP_PORT}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let client;
  try {
    await waitFor(async () => {
      try { return await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`); } catch { return false; }
    }, 'Chrome DevTools endpoint');

    const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
    const target = targets.find((item) => item.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome page target available');

    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: BASE_URL });
    await waitFor(() => evaluate(client, `document.readyState === 'complete'`), 'page load');
    await sleep(1200);

    const initialDiagnostic = await diagnostic(client);
    console.log('GEOMETRY_LAB_DIAGNOSTIC_INITIAL');
    console.log(JSON.stringify(initialDiagnostic, null, 2));
    await screenshot(client, '00-page-loaded', false);

    await waitFor(() => evaluate(client, `(() => {
      const canvas=document.querySelector('.implant-geometry-lab__viewport canvas');
      const text=(document.body.innerText || '').toLowerCase();
      return Boolean(canvas && canvas.width>200 && canvas.height>200
        && text.includes('stl-ascii')
        && text.includes('validatedgeometry')
        && text.includes('redistributionallowed'));
    })()`), 'ASCII lab render');

    const safety = await evaluate(client, `(() => {
      const text=(document.querySelector('.implant-geometry-lab__facts')?.innerText || '').toLowerCase();
      return {
        falseOk: text.includes('validatedgeometry') && text.includes('false'),
        unknownOk: text.includes('redistributionallowed') && text.includes('unknown'),
      };
    })()`);
    if (!safety?.falseOk || !safety?.unknownOk) throw new Error(`Safety metadata missing: ${JSON.stringify(safety)}`);

    const initial = await screenshot(client, '01-ascii-initial');

    await drag(client, initial.rect, { dx: 140, dy: -75 });
    const orbited = await screenshot(client, '02-ascii-orbited');
    if (orbited.data === initial.data) throw new Error('Orbit did not change viewport');

    const cx = initial.rect.x + initial.rect.width * 0.5;
    const cy = initial.rect.y + initial.rect.height * 0.5;
    await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaY: -420, deltaX: 0 });
    await sleep(450);
    const zoomed = await screenshot(client, '03-ascii-zoomed');
    if (zoomed.data === orbited.data) throw new Error('Zoom did not change viewport');

    await drag(client, initial.rect, { dx: -90, dy: 70, button: 'right', buttons: 2 });
    const panned = await screenshot(client, '04-ascii-panned');
    if (panned.data === zoomed.data) throw new Error('Pan did not change viewport');

    await evaluate(client, `document.querySelector('.implant-geometry-lab__panel button')?.click()`);
    await sleep(500);
    await screenshot(client, '05-ascii-reset');

    const switched = await evaluate(client, `(() => {
      const variant=[...document.querySelectorAll('.implant-geometry-lab__panel select')][3];
      if(!variant || variant.options.length<2) return false;
      variant.value=variant.options[1].value;
      variant.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    })()`);
    if (!switched) throw new Error('Could not switch synthetic variant');

    await waitFor(() => evaluate(client, `((document.querySelector('.implant-geometry-lab__facts')?.innerText || '').toLowerCase().includes('stl-binary'))`), 'Binary variant render');
    await sleep(450);
    const binary = await screenshot(client, '06-binary-variant');
    if (binary.data === initial.data) throw new Error('Binary variant identical to ASCII initial');

    const pageErrors = client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
    if (pageErrors.length) throw new Error(`Browser exceptions observed: ${pageErrors.length}`);

    console.log('GEOMETRY_LAB_SMOKE_SUCCESS');
    console.log(JSON.stringify({
      final: await diagnostic(client),
      screenshots: {
        initial: initial.bytes,
        orbited: orbited.bytes,
        zoomed: zoomed.bytes,
        panned: panned.bytes,
        binary: binary.bytes,
      },
    }, null, 2));
  } finally {
    client?.close();
    chrome.kill('SIGTERM');
    await sleep(300);
    if (!chrome.killed) chrome.kill('SIGKILL');
  }
}

main().catch((error) => {
  console.error('GEOMETRY_LAB_SMOKE_FAILURE');
  console.error(error);
  process.exitCode = 1;
});
