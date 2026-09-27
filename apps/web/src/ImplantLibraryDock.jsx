import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  importImplantArchiveFiles,
  listRenderableImplantGeometry,
  readArchiveGeometryBytes,
} from './library/implant/importImplantArchiveFiles.js';
import './implantLibraryDock.css';

let archiveImporterPromise = null;

function ensureArchiveImporter() {
  if (window.OdontoArchiveImport?.extractImplantLibrary) return Promise.resolve(window.OdontoArchiveImport);
  if (archiveImporterPromise) return archiveImporterPromise;
  archiveImporterPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-odontoview-archive-import]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.OdontoArchiveImport), { once: true });
      existing.addEventListener('error', () => reject(new Error('Não foi possível carregar o extrator de biblioteca.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = '/legacy-ingest/js/archive-import.js';
    script.async = true;
    script.dataset.odontoviewArchiveImport = '1';
    script.onload = () => window.OdontoArchiveImport?.extractImplantLibrary
      ? resolve(window.OdontoArchiveImport)
      : reject(new Error('Extrator de biblioteca indisponível.'));
    script.onerror = () => reject(new Error('Não foi possível carregar o extrator de biblioteca.'));
    document.head.appendChild(script);
  }).catch((error) => {
    archiveImporterPromise = null;
    throw error;
  });
  return archiveImporterPromise;
}

function optionLabel(item) {
  const context = [item.componentLabel, item.variantLabel].filter(Boolean).join(' • ');
  const role = item.role ? ` · ${item.role}` : '';
  return `${context || item.systemName || item.filename}${role}`;
}

function waitForMeshStatus(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const el = document.querySelector('.viewer3d-implant-geometry[data-implant-geometry-status="mesh"]');
      if (el) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      setTimeout(check, 120);
    };
    check();
  });
}

export default function ImplantLibraryDock() {
  const inputRef = useRef(null);
  const [host, setHost] = useState(null);
  const [archiveName, setArchiveName] = useState('');
  const [status, setStatus] = useState('Carregue uma biblioteca RAR ou ZIP para usar os nomes e geometrias definidos no config.xml.');
  const [progress, setProgress] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [options, setOptions] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [sdfaCount, setSdfaCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let created = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return true;
      const planner = document.querySelector('.viewer3d-implant-planner');
      if (!planner) return false;
      let target = planner.querySelector('[data-implant-library-dock-host]');
      if (!target) {
        target = document.createElement('div');
        target.dataset.implantLibraryDockHost = '1';
        const warning = planner.querySelector('.viewer3d-implant-warning');
        if (warning) planner.insertBefore(target, warning);
        else planner.appendChild(target);
        created = target;
      }
      setHost(target);
      return true;
    };
    if (attach()) return () => { cancelled = true; if (created?.isConnected) created.remove(); };
    const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      observer.disconnect();
      if (created?.isConnected) created.remove();
    };
  }, []);

  const selected = useMemo(() => options.find((item) => item.id === selectedId) || options[0] || null, [options, selectedId]);
  const library = bundle?.catalog?.libraries?.[0] || null;

  async function loadArchive(file) {
    setBusy(true);
    setArchiveName(file.name);
    setBundle(null);
    setOptions([]);
    setSelectedId('');
    setProgress(null);
    setStatus('Abrindo biblioteca local…');
    try {
      const importer = await ensureArchiveImporter();
      const extracted = await importer.extractImplantLibrary(file, {
        onProgress: (value) => setProgress(value),
      });
      const imported = await importImplantArchiveFiles(extracted, { sourceName: file.name });
      const renderable = listRenderableImplantGeometry(imported.catalog);
      const sdfa = extracted.filter((entry) => /\.sdfa$/i.test(entry.archivePath || entry.name || '')).length;
      setBundle(imported);
      setOptions(renderable);
      setSelectedId(renderable[0]?.id || '');
      setSdfaCount(sdfa);
      setStatus(renderable.length
        ? `${renderable.length} geometria(s) STL resolvida(s) e pronta(s) para visualização local.`
        : 'Biblioteca lida, mas nenhuma geometria STL resolvida foi encontrada.');
    } catch (error) {
      setStatus(error?.message || 'Não foi possível abrir a biblioteca.');
    } finally {
      setBusy(false);
    }
  }

  async function applySelectedGeometry() {
    if (!bundle || !selected) return;
    const target = document.querySelector('.viewer3d-implant-tools input[type="file"][accept=".stl"]');
    if (!target) {
      setStatus('Insira ou selecione um implante no planejamento antes de aplicar a geometria da biblioteca.');
      return;
    }
    setBusy(true);
    setStatus(`Aplicando ${selected.filename} ao implante ativo…`);
    try {
      const bytes = await readArchiveGeometryBytes(bundle.filesByPath, selected.matchedPath);
      const stl = new File([bytes], selected.filename, { type: 'model/stl' });
      const transfer = new DataTransfer();
      transfer.items.add(stl);
      target.files = transfer.files;
      target.dispatchEvent(new Event('change', { bubbles: true }));
      const rendered = await waitForMeshStatus();
      setStatus(rendered
        ? `Geometria aplicada ao implante ativo: ${selected.filename}`
        : 'A geometria foi enviada ao Viewer, mas a confirmação visual não chegou dentro do tempo esperado.');
    } catch (error) {
      setStatus(error?.message || 'Não foi possível aplicar a geometria selecionada.');
    } finally {
      setBusy(false);
    }
  }

  if (!host) return null;

  return createPortal(
    <section className="implant-library-dock" data-implant-library-dock>
      <input
        ref={inputRef}
        type="file"
        accept=".rar,.zip,application/zip,application/vnd.rar"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) loadArchive(file);
          event.target.value = '';
        }}
      />
      <div className="implant-library-dock__head">
        <div>
          <strong>Biblioteca local de componentes</strong>
          <small>RAR/ZIP • config.xml + geometrias • processamento somente neste navegador</small>
        </div>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          {archiveName ? 'Trocar biblioteca' : 'Carregar biblioteca RAR/ZIP'}
        </button>
      </div>

      {archiveName && <div className="implant-library-dock__source">
        <span className="implant-library-dock__dot" />
        <b>{archiveName}</b>
        {library && <span>{library.manufacturer?.name || 'Fabricante não informado'} • {library.system?.name || 'Sistema não informado'}</span>}
      </div>}

      {options.length > 0 && <div className="implant-library-dock__picker">
        <label>
          <span>Geometria definida pela biblioteca</span>
          <select value={selected?.id || ''} onChange={(event) => setSelectedId(event.target.value)}>
            {options.map((item) => <option key={item.id} value={item.id}>{optionLabel(item)}</option>)}
          </select>
        </label>
        {selected && <div className="implant-library-dock__detail">
          <b>{selected.componentLabel || selected.systemName || 'Geometria da biblioteca'}</b>
          {selected.variantLabel && <span>{selected.variantLabel}</span>}
          <code>{selected.matchedPath}</code>
          <small>validatedGeometry: false • redistributionAllowed: {selected.redistributionAllowed || 'unknown'}</small>
        </div>}
        <button className="implant-library-dock__apply" type="button" disabled={busy || !selected} onClick={applySelectedGeometry}>
          Aplicar ao implante ativo
        </button>
      </div>}

      <div className="implant-library-dock__status">
        <span>{busy ? 'Processando…' : status}</span>
        {progress?.entries ? <small>{progress.entries} entrada(s) lida(s)</small> : null}
        {bundle && <small>{bundle.audit.summary.resolvedGeometryFiles} referência(s) resolvida(s) • {bundle.audit.summary.missingGeometryFiles} ausente(s) • {sdfaCount} SDFA catalogada(s), ainda não renderizada(s)</small>}
      </div>
      <small className="implant-library-dock__safety">Os rótulos vêm do config.xml da biblioteca. A exibição 3D é local e não equivale a validação dimensional ou clínica.</small>
    </section>,
    host,
  );
}
