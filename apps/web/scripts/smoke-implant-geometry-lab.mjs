import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const BASE_URL = process.env.GEOMETRY_LAB_URL || 'http://127.0.0.1:4173/implant-geometry-lab';
const CDP_PORT = Number(process.env.GEOMETRY_LAB_CDP_PORT || 9222);
const OUT_DIR = new URL('../implant-geometry-lab-smoke/', import.meta.url);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFor(predicate, { timeout = 30000, interval = 250, label = 'condition' } = {}) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForHttp(url) {
  await waitFor(async () => {
    const response = await fetch(url, { redirect: 'manual' });
    return response.status >= 200 && response.status < 500;
  }, { label: `HTTP ${url}` });
}

function chromeBinary() {
  return process.env.CHROME_BIN || 'google-chrome';
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
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

function parsePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('Screenshot is not PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset); offset += 4;
    const type = buffer.toString('ascii', offset, offset + 4); offset += 4;
    const data = buffer.subarray(offset, offset + length); offset += length + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || ![2, 6].includes(colorType)) throw new Error(`Unsupported PNG format depth=${bitDepth} colorType=${colorType}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows = [];
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const scan = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    const recon = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? recon[x - bpp] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= bpp ? previous[x - bpp] : 0;
      let value;
      if (filter === 0) value = scan[x];
      else if (filter === 1) value = (scan[x] + left) & 255;
      else if (filter === 2) value = (scan[x] + up) & 255;
      else if (filter === 3) value = (scan[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = (scan[x] + predictor) & 255;
      } else throw new Error(`Unsupported PNG filter ${filter}`);
      recon[x] = value;
    }
    rows.push(recon);
    previous = recon;
  }
  return { width, height, bpp, rows };
}

function assertViewportHasRenderedContent(pngBytes, label) {
  const { width, height, bpp, rows } = parsePng(pngBytes);
  if (width < 200 || height < 200) throw new Error(`${label}: viewport screenshot too small (${width}x${height})`);
  const sample = [];
  const stepX = Math.max(1, Math.floor(width / 80));
  const stepY = Math.max(1, Math.floor(height / 60));
  for (let y = 0; y < height; y += stepY) {
    const row = rows[y];
    for (let x = 0; x < width; x += stepX) {
      const i = x * bpp;
      sample.push([row[i], row[i + 1], row[i + 2]]);
    }
  }
  const background = sample[0];
  const contrasting = sample.filter(([r, g, b]) => Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) > 45).length;
  if (contrasting < 120) throw new Error(`${label}: too few contrasting viewport pixels (${contrasting}); mesh/grid/axes may not be visible`);
  return { width, height, contrasting };
}

async function screenshotViewport(client, name) {
  const rect = await evaluate(client, `(() => {
    const el = document.querySelector('.implant-geometry-lab__viewport');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  })()`);
  if (!rect || rect.width < 1 || rect.height < 1) throw new Error('Viewport rectangle unavailable');
  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  });
  const bytes = Buffer.from(shot.data, 'base64');
  await writeFile(new URL(`${name}.png`, OUT_DIR), bytes);
  const stats = assertViewportHasRenderedContent(bytes, name);
  return { data: shot.data, rect, stats };
}

async function drag(client, rect, { dx, dy, button = 'left', buttons = 1 }) {
  const x = rect.x + rect.width * 0.55;
  const y = rect.y + rect.height * 0.52;
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x + dx * step / 6, y: y + dy * step / 6, button, buttons,
    });
    await sleep(40);
  }
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button, buttons: 0, clickCount: 1 });
  await sleep(350);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await waitForHttp(BASE_URL);

  const chrome = spawn(chromeBinary(), [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader', '--window-size=1440,1000', `--remote-debugging-port=${CDP_PORT}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeErr = '';
  chrome.stderr.on('data', (chunk) => { chromeErr += chunk.toString(); });

  try {
    await waitFor(async () => {
      try { return await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`); } catch { return null; }
    }, { label: 'Chrome DevTools endpoint' });

    const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(BASE_URL)}`, { method: 'PUT' });
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.bringToFront');

    await waitFor(async () => evaluate(client, `(() => {
      const canvas=document.querySelector('.implant-geometry-lab__viewport canvas');
      const text=document.body.innerText;
      return Boolean(canvas && canvas.width>200 && canvas.height>200 && text.includes('stl-ascii') && text.includes('validatedGeometry') && text.includes('redistributionAllowed'));
    })()`), { label: 'ASCII lab render' });

    const safety = await evaluate(client, `(() => {
      const text=document.querySelector('.implant-geometry-lab__facts')?.innerText || '';
      return { text, hasFalse:/validatedGeometry\\s*false/i.test(text), hasUnknown:/redistributionAllowed\\s*unknown/i.test(text) };
    })()`);
    if (!safety?.hasFalse || !safety?.hasUnknown) throw new Error(`Safety metadata missing: ${JSON.stringify(safety)}`);

    const initial = await screenshotViewport(client, '01-ascii-initial');

    await drag(client, initial.rect, { dx: 140, dy: -75, button: 'left', buttons: 1 });
    const orbited = await screenshotViewport(client, '02-ascii-orbited');
    if (orbited.data === initial.data) throw new Error('Orbit interaction did not change rendered viewport');

    const cx = initial.rect.x + initial.rect.width * 0.5;
    const cy = initial.rect.y + initial.rect.height * 0.5;
    await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaY: -420, deltaX: 0 });
    await sleep(400);
    const zoomed = await screenshotViewport(client, '03-ascii-zoomed');
    if (zoomed.data === orbited.data) throw new Error('Zoom interaction did not change rendered viewport');

    await drag(client, initial.rect, { dx: -90, dy: 70, button: 'right', buttons: 2 });
    const panned = await screenshotViewport(client, '04-ascii-panned');
    if (panned.data === zoomed.data) throw new Error('Pan interaction did not change rendered viewport');

    await evaluate(client, `document.querySelector('.implant-geometry-lab__panel button')?.click()`);
    await sleep(450);
    await screenshotViewport(client, '05-ascii-reset');

    const switched = await evaluate(client, `(() => {
      const selects=[...document.querySelectorAll('.implant-geometry-lab__panel select')];
      const variant=selects[3];
      if(!variant || variant.options.length<2) return false;
      variant.value=variant.options[1].value;
      variant.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    })()`);
    if (!switched) throw new Error('Could not switch synthetic variant');

    await waitFor(async () => evaluate(client, `document.querySelector('.implant-geometry-lab__facts')?.innerText.includes('stl-binary')`), { label: 'Binary variant render' });
    const binary = await screenshotViewport(client, '06-binary-variant');
    if (binary.data === initial.data) throw new Error('Binary variant screenshot unexpectedly identical to ASCII initial');

    const summary = await evaluate(client, `(() => ({
      title: document.querySelector('.implant-geometry-lab h1')?.textContent,
      facts: document.querySelector('.implant-geometry-lab__facts')?.innerText,
      hint: document.querySelector('.implant-geometry-lab__hint')?.textContent,
      canvas: (()=>{const c=document.querySelector('canvas');return c?{width:c.width,height:c.height}:null})(),
    }))()`);

    const pageErrors = client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
    if (pageErrors.length) throw new Error(`Browser exceptions observed: ${pageErrors.length}`);

    console.log('GEOMETRY_LAB_SMOKE_SUCCESS');
    console.log(JSON.stringify({ summary, initial: initial.stats, binary: binary.stats }, null, 2));
    client.close();
  } finally {
    chrome.kill('SIGTERM');
    await sleep(300);
    if (!chrome.killed) chrome.kill('SIGKILL');
    if (chrome.exitCode && chrome.exitCode !== 0) console.error(chromeErr);
  }
}

main().catch((error) => {
  console.error('GEOMETRY_LAB_SMOKE_FAILURE');
  console.error(error);
  process.exitCode = 1;
});
