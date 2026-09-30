import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  IDENTITY_MATRIX_4X4,
  getVariantGeometryAssets,
  listCatalogComponents,
  listCatalogManufacturers,
  listCatalogSystems,
  listCatalogVariants,
  loadStlGeometry,
  transformGeometry,
} from './library/implant/index.js';
import { createThreeBufferGeometry } from './library/implant/threeGeometryAdapter.js';
import { implantGeometryLabBytes, implantGeometryLabCatalog } from './implantGeometryLabFixtures.js';
import './implantGeometryLab.css';

function labelFor(value, fallback = '—') {
  return value?.displayName || value?.name || value?.keyword || value?.id || fallback;
}

function formatVector(values) {
  return Array.isArray(values) ? values.map((value) => Number(value).toFixed(2)).join(', ') : '—';
}

function firstId(values) {
  return Array.isArray(values) && values[0]?.id ? values[0].id : '';
}

export default function ImplantGeometryLab() {
  const catalog = implantGeometryLabCatalog;
  const mountRef = useRef(null);
  const fitCameraRef = useRef(() => {});
  const manufacturers = useMemo(() => listCatalogManufacturers(catalog), [catalog]);
  const [manufacturerId, setManufacturerId] = useState(() => firstId(manufacturers));
  const systems = useMemo(() => listCatalogSystems(catalog, manufacturerId), [catalog, manufacturerId]);
  const [systemId, setSystemId] = useState(() => firstId(systems));
  const components = useMemo(() => listCatalogComponents(catalog, systemId), [catalog, systemId]);
  const [componentId, setComponentId] = useState(() => firstId(components));
  const variants = useMemo(() => listCatalogVariants(catalog, componentId), [catalog, componentId]);
  const [variantId, setVariantId] = useState(() => firstId(variants));

  useEffect(() => {
    if (!systems.some((item) => item.id === systemId)) setSystemId(firstId(systems));
  }, [systems, systemId]);

  useEffect(() => {
    if (!components.some((item) => item.id === componentId)) setComponentId(firstId(components));
  }, [components, componentId]);

  useEffect(() => {
    if (!variants.some((item) => item.id === variantId)) setVariantId(firstId(variants));
  }, [variants, variantId]);

  const selectedAsset = useMemo(() => {
    return getVariantGeometryAssets(catalog, variantId, { resolvedOnly: true })[0] || null;
  }, [catalog, variantId]);

  const pipeline = useMemo(() => {
    if (!selectedAsset) return { mesh: null, error: 'Nenhuma geometria STL resolvida para esta variante.' };
    const bytes = implantGeometryLabBytes.get(selectedAsset.matchedPath);
    if (!bytes) return { mesh: null, error: `Bytes sintéticos ausentes para ${selectedAsset.matchedPath}` };
    try {
      const loaded = loadStlGeometry(selectedAsset, bytes);
      const transformed = transformGeometry(loaded, IDENTITY_MATRIX_4X4);
      return { mesh: transformed, error: '' };
    } catch (error) {
      return { mesh: null, error: `${error?.code || 'GEOMETRY_ERROR'}: ${error?.message || error}` };
    }
  }, [selectedAsset]);

  useEffect(() => {
    const mount = mountRef.current;
    const meshData = pipeline.mesh;
    if (!mount || !meshData) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071421);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;

    const geometry = createThreeBufferGeometry(meshData);
    const material = new THREE.MeshStandardMaterial({
      color: 0x53d7ff,
      roughness: 0.42,
      metalness: 0.18,
      side: THREE.DoubleSide,
    });
    const object = new THREE.Mesh(geometry, material);
    scene.add(object);

    const grid = new THREE.GridHelper(60, 12, 0x3e6578, 0x1a3341);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const axes = new THREE.AxesHelper(24);
    scene.add(axes);

    const ambient = new THREE.HemisphereLight(0xdaf7ff, 0x17202a, 2.1);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(30, 24, 36);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6bdcff, 1.4);
    rim.position.set(-24, -12, 18);
    scene.add(rim);

    function fitCamera() {
      geometry.computeBoundingSphere();
      const sphere = geometry.boundingSphere;
      if (!sphere) return;
      const radius = Math.max(sphere.radius, 0.5);
      const center = sphere.center;
      camera.near = Math.max(radius / 500, 0.01);
      camera.far = Math.max(radius * 100, 1000);
      camera.position.set(center.x + radius * 2.7, center.y + radius * 2.2, center.z + radius * 2.9);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    }

    fitCameraRef.current = fitCamera;
    fitCamera();

    function resize() {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let animationFrame = 0;
    function animate() {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    }
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      fitCameraRef.current = () => {};
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [pipeline.mesh]);

  const selectedManufacturer = manufacturers.find((item) => item.id === manufacturerId);
  const selectedSystem = systems.find((item) => item.id === systemId);
  const selectedComponent = components.find((item) => item.id === componentId);
  const selectedVariant = variants.find((item) => item.id === variantId);
  const mesh = pipeline.mesh;

  return (
    <main className="implant-geometry-lab">
      <header className="implant-geometry-lab__header">
        <div>
          <p className="implant-geometry-lab__eyebrow">ODONTOVIEW · DEVELOPMENT LAB</p>
          <h1>Implant Geometry Lab</h1>
          <p>Pipeline isolado: catálogo → STL → geometria neutra → transformação explícita → Three.js.</p>
        </div>
        <div className="implant-geometry-lab__warning">
          <strong>Não clínico</strong>
          <span>Esta tela valida geometria e renderização. Não representa posicionamento em CBCT nem planejamento cirúrgico.</span>
        </div>
      </header>

      <section className="implant-geometry-lab__layout">
        <aside className="implant-geometry-lab__sidebar">
          <div className="implant-geometry-lab__panel">
            <h2>Catálogo sintético</h2>
            <label>
              Fabricante
              <select value={manufacturerId} onChange={(event) => setManufacturerId(event.target.value)}>
                {manufacturers.map((item) => <option key={item.id} value={item.id}>{labelFor(item)}</option>)}
              </select>
            </label>
            <label>
              Sistema
              <select value={systemId} onChange={(event) => setSystemId(event.target.value)}>
                {systems.map((item) => <option key={item.id} value={item.id}>{labelFor(item)}</option>)}
              </select>
            </label>
            <label>
              Componente
              <select value={componentId} onChange={(event) => setComponentId(event.target.value)}>
                {components.map((item) => <option key={item.id} value={item.id}>{labelFor(item)}</option>)}
              </select>
            </label>
            <label>
              Variante
              <select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                {variants.map((item) => <option key={item.id} value={item.id}>{labelFor(item)}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => fitCameraRef.current()}>Resetar / enquadrar câmera</button>
          </div>

          <div className="implant-geometry-lab__panel implant-geometry-lab__facts">
            <h2>Pipeline</h2>
            <dl>
              <div><dt>Fabricante</dt><dd>{labelFor(selectedManufacturer)}</dd></div>
              <div><dt>Sistema</dt><dd>{labelFor(selectedSystem)}</dd></div>
              <div><dt>Componente</dt><dd>{labelFor(selectedComponent)}</dd></div>
              <div><dt>Variante</dt><dd>{labelFor(selectedVariant)}</dd></div>
              <div><dt>Transformação</dt><dd>Identity 4×4</dd></div>
              <div><dt>Arquivo</dt><dd>{selectedAsset?.filename || '—'}</dd></div>
              <div><dt>matchedPath</dt><dd className="implant-geometry-lab__path">{selectedAsset?.matchedPath || '—'}</dd></div>
              <div><dt>Formato</dt><dd>{mesh?.source?.format || '—'}</dd></div>
              <div><dt>Vértices</dt><dd>{mesh?.vertexCount ?? '—'}</dd></div>
              <div><dt>Triângulos</dt><dd>{mesh?.triangleCount ?? '—'}</dd></div>
              <div><dt>Bounds min</dt><dd>{formatVector(mesh?.bounds?.min)}</dd></div>
              <div><dt>Bounds max</dt><dd>{formatVector(mesh?.bounds?.max)}</dd></div>
              <div><dt>validatedGeometry</dt><dd>{String(mesh?.safety?.validatedGeometry ?? selectedAsset?.validatedGeometry ?? '—')}</dd></div>
              <div><dt>redistributionAllowed</dt><dd>{String(mesh?.safety?.redistributionAllowed ?? selectedAsset?.redistributionAllowed ?? '—')}</dd></div>
            </dl>
          </div>
        </aside>

        <section className="implant-geometry-lab__viewport-shell">
          {pipeline.error ? <div className="implant-geometry-lab__error">{pipeline.error}</div> : null}
          <div ref={mountRef} className="implant-geometry-lab__viewport" aria-label="Visualização 3D sintética do Implant Geometry Lab" />
          <div className="implant-geometry-lab__hint">Arraste para orbitar · scroll/pinch para zoom · botão direito/gesto de dois dedos para pan</div>
        </section>
      </section>
    </main>
  );
}
