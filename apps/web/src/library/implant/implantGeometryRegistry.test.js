import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  return import('./implantGeometryRegistry.js').catch(() => null);
}

function makeMesh(assetId = 'mesh-1') {
  return {
    geometrySchemaVersion: 1,
    source: {
      assetId,
      sourcePath: `local/${assetId}.stl`,
      filename: `${assetId}.stl`,
      format: 'stl-ascii',
    },
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    safety: { validatedGeometry: false, redistributionAllowed: 'unknown' },
  };
}

test('registers and retrieves a valid neutral mesh without mutating it', async () => {
  const module = await loadModule();
  assert.ok(module, 'implantGeometryRegistry.js must exist');
  module.clearImplantGeometryRegistry();
  const mesh = makeMesh();
  const entry = module.registerImplantGeometry({ geometryKey: 'local:implant:a', mesh, metadata: { filename: 'a.stl' } });
  assert.equal(entry.geometryKey, 'local:implant:a');
  assert.equal(entry.mesh, mesh);
  assert.equal(entry.revision, 1);
  assert.deepEqual(module.getImplantGeometry('local:implant:a').metadata, { filename: 'a.stl' });
  assert.equal(mesh.safety.validatedGeometry, false);
  assert.equal(mesh.safety.redistributionAllowed, 'unknown');
});

test('replacement under the same geometry key increments revision and exposes the new mesh', async () => {
  const module = await loadModule();
  assert.ok(module);
  module.clearImplantGeometryRegistry();
  const first = module.registerImplantGeometry({ geometryKey: 'local:implant:a', mesh: makeMesh('one') });
  const replacement = makeMesh('two');
  const second = module.registerImplantGeometry({ geometryKey: 'local:implant:a', mesh: replacement });
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(module.getImplantGeometry('local:implant:a').mesh, replacement);
});

test('rejects blank geometry keys and invalid neutral meshes', async () => {
  const module = await loadModule();
  assert.ok(module);
  module.clearImplantGeometryRegistry();
  assert.throws(() => module.registerImplantGeometry({ geometryKey: '   ', mesh: makeMesh() }), (error) => error?.code === 'INVALID_GEOMETRY_VALUE');
  assert.throws(() => module.registerImplantGeometry({ geometryKey: 'local:implant:a', mesh: { nope: true } }), (error) => error?.code === 'INVALID_GEOMETRY_VALUE');
  assert.equal(module.getImplantGeometry('local:implant:a'), null);
});

test('unregister and clear remove entries deterministically', async () => {
  const module = await loadModule();
  assert.ok(module);
  module.clearImplantGeometryRegistry();
  module.registerImplantGeometry({ geometryKey: 'local:implant:a', mesh: makeMesh('a') });
  module.registerImplantGeometry({ geometryKey: 'local:implant:b', mesh: makeMesh('b') });
  assert.equal(module.unregisterImplantGeometry('local:implant:a'), true);
  assert.equal(module.unregisterImplantGeometry('local:implant:a'), false);
  assert.equal(module.getImplantGeometry('local:implant:a'), null);
  module.clearImplantGeometryRegistry();
  assert.equal(module.getImplantGeometry('local:implant:b'), null);
});

test('preserves safety and provenance metadata without promoting validation', async () => {
  const module = await loadModule();
  assert.ok(module);
  module.clearImplantGeometryRegistry();
  const entry = module.registerImplantGeometry({
    geometryKey: 'local:implant:a',
    mesh: makeMesh(),
    metadata: {
      safety: { validatedGeometry: false, redistributionAllowed: 'unknown' },
      provenance: { sourceKind: 'local-file', filename: 'implant.stl' },
    },
  });
  assert.deepEqual(entry.metadata.safety, { validatedGeometry: false, redistributionAllowed: 'unknown' });
  assert.deepEqual(entry.metadata.provenance, { sourceKind: 'local-file', filename: 'implant.stl' });
});
