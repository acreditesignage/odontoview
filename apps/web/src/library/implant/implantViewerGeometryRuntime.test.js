import test from 'node:test';
import assert from 'node:assert/strict';
import { clearImplantGeometryRegistry, registerImplantGeometry } from './implantGeometryRegistry.js';

async function loadModule() {
  return import('./implantViewerGeometryRuntime.js').catch(() => null);
}

function mesh(assetId = 'mesh-1') {
  return {
    geometrySchemaVersion: 1,
    source: { assetId, sourcePath: `local/${assetId}.stl`, filename: `${assetId}.stl`, format: 'stl-ascii' },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    safety: { validatedGeometry: false, redistributionAllowed: 'unknown' },
  };
}

function implant(overrides = {}) {
  return {
    id: 'implant-1',
    diameter: 3.5,
    length: 10,
    x: 10,
    y: 20,
    z: 30,
    rx: 1,
    ry: 2,
    rz: 3,
    geometryKey: 'local:implant:implant-1',
    ...overrides,
  };
}

test('registered geometry key resolves to mesh mode with registry entry', async () => {
  const module = await loadModule();
  assert.ok(module, 'implantViewerGeometryRuntime.js must exist');
  clearImplantGeometryRegistry();
  const entry = registerImplantGeometry({ geometryKey: 'local:implant:implant-1', mesh: mesh() });
  const resolved = module.resolveImplantGeometryRuntime(implant());
  assert.equal(resolved.mode, 'mesh');
  assert.equal(resolved.entry, entry);
  assert.equal(resolved.diagnostic, null);
  assert.ok(resolved.signature.includes('local:implant:implant-1'));
});

test('missing registry entry falls back to parametric mode with diagnostic', async () => {
  const module = await loadModule();
  assert.ok(module);
  clearImplantGeometryRegistry();
  const resolved = module.resolveImplantGeometryRuntime(implant());
  assert.equal(resolved.mode, 'parametric');
  assert.equal(resolved.entry, null);
  assert.equal(resolved.diagnostic?.code, 'GEOMETRY_NOT_REGISTERED');
});

test('re-registering the same geometry key changes the geometry signature via revision', async () => {
  const module = await loadModule();
  assert.ok(module);
  clearImplantGeometryRegistry();
  let entry = registerImplantGeometry({ geometryKey: 'local:implant:implant-1', mesh: mesh('one') });
  const first = module.implantGeometrySignature(implant(), entry);
  entry = registerImplantGeometry({ geometryKey: 'local:implant:implant-1', mesh: mesh('two') });
  const second = module.implantGeometrySignature(implant(), entry);
  assert.notEqual(first, second);
  assert.equal(entry.revision, 2);
});

test('clinical XYZ and RX RY RZ edits do not change mesh rebuild signature', async () => {
  const module = await loadModule();
  assert.ok(module);
  clearImplantGeometryRegistry();
  const entry = registerImplantGeometry({ geometryKey: 'local:implant:implant-1', mesh: mesh() });
  const first = module.implantGeometrySignature(implant(), entry);
  const moved = implant({ x: 999, y: 888, z: 777, rx: 90, ry: -45, rz: 180 });
  assert.equal(module.implantGeometrySignature(moved, entry), first);
});

test('geometry-local transform edit changes mesh rebuild signature', async () => {
  const module = await loadModule();
  assert.ok(module);
  clearImplantGeometryRegistry();
  const entry = registerImplantGeometry({ geometryKey: 'local:implant:implant-1', mesh: mesh() });
  const identity = module.implantGeometrySignature(implant(), entry);
  const translated = module.implantGeometrySignature(implant({
    geometryLocalTransform: [1,0,0,0, 0,1,0,0, 0,0,1,0, 2,0,0,1],
  }), entry);
  assert.notEqual(identity, translated);
});

test('invalid singular local transform falls back without mutating clinical coordinates', async () => {
  const module = await loadModule();
  assert.ok(module);
  clearImplantGeometryRegistry();
  registerImplantGeometry({ geometryKey: 'local:implant:implant-1', mesh: mesh() });
  const original = implant({ geometryLocalTransform: [0,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] });
  const before = { x: original.x, y: original.y, z: original.z, rx: original.rx, ry: original.ry, rz: original.rz };
  const resolved = module.resolveImplantGeometryRuntime(original);
  assert.equal(resolved.mode, 'parametric');
  assert.equal(resolved.diagnostic?.code, 'INVALID_TRANSFORM');
  assert.deepEqual({ x: original.x, y: original.y, z: original.z, rx: original.rx, ry: original.ry, rz: original.rz }, before);
});

test('implants without a geometry key remain parametric without a stale-geometry diagnostic', async () => {
  const module = await loadModule();
  assert.ok(module);
  clearImplantGeometryRegistry();
  const resolved = module.resolveImplantGeometryRuntime(implant({ geometryKey: undefined }));
  assert.equal(resolved.mode, 'parametric');
  assert.equal(resolved.diagnostic, null);
  assert.ok(resolved.signature.startsWith('parametric:'));
});
