import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAsciiStl, makeBinaryStl } from './stlTestFixtures.js';

async function loadModule() {
  return import('./localImplantGeometry.js').catch(() => null);
}

async function loadRegistry() {
  return import('./implantGeometryRegistry.js');
}

test('ASCII local STL imports through the existing loader with exact diagnostics', async () => {
  const module = await loadModule();
  assert.ok(module, 'localImplantGeometry.js must exist');
  const result = module.loadLocalImplantGeometry({
    geometryKey: 'local:implant:one',
    filename: 'implant.stl',
    bytes: makeAsciiStl(),
  });
  assert.equal(result.mesh.source.format, 'stl-ascii');
  assert.equal(result.diagnostics.vertexCount, 3);
  assert.equal(result.diagnostics.triangleCount, 1);
  assert.deepEqual(result.diagnostics.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
  assert.deepEqual(result.diagnostics.extents, [1, 1, 0]);
  assert.deepEqual(result.diagnostics.center, [0.5, 0.5, 0]);
  assert.equal(result.diagnostics.unitStatus, 'unknown');
});

test('Binary .STL local file imports through the existing loader', async () => {
  const module = await loadModule();
  assert.ok(module);
  const result = module.loadLocalImplantGeometry({
    geometryKey: 'local:implant:two',
    filename: 'IMPLANT.STL',
    bytes: makeBinaryStl(),
  });
  assert.equal(result.mesh.source.format, 'stl-binary');
  assert.equal(result.diagnostics.triangleCount, 1);
});

test('unsupported local extension rejects and does not register geometry', async () => {
  const module = await loadModule();
  assert.ok(module);
  const registry = await loadRegistry();
  registry.clearImplantGeometryRegistry();
  assert.throws(
    () => module.registerLocalImplantGeometry({ geometryKey: 'local:implant:bad', filename: 'implant.obj', bytes: makeAsciiStl() }),
    (error) => error?.code === 'UNSUPPORTED_GEOMETRY_FORMAT',
  );
  assert.equal(registry.getImplantGeometry('local:implant:bad'), null);
});

test('malformed local STL cannot overwrite an already registered good mesh', async () => {
  const module = await loadModule();
  assert.ok(module);
  const registry = await loadRegistry();
  registry.clearImplantGeometryRegistry();
  const good = module.registerLocalImplantGeometry({ geometryKey: 'local:implant:safe', filename: 'good.stl', bytes: makeAsciiStl() });
  assert.throws(
    () => module.registerLocalImplantGeometry({ geometryKey: 'local:implant:safe', filename: 'bad.stl', bytes: new Uint8Array([1, 2, 3]) }),
    (error) => error?.code === 'INVALID_STL',
  );
  assert.equal(registry.getImplantGeometry('local:implant:safe').revision, good.revision);
  assert.equal(registry.getImplantGeometry('local:implant:safe').mesh, good.mesh);
});

test('local import keeps units unknown and safety conservative', async () => {
  const module = await loadModule();
  assert.ok(module);
  const result = module.loadLocalImplantGeometry({ geometryKey: 'local:implant:safe', filename: 'implant.stl', bytes: makeAsciiStl() });
  assert.equal(result.diagnostics.unitStatus, 'unknown');
  assert.equal('scale' in result.diagnostics, false);
  assert.equal('mm' in result.diagnostics, false);
  assert.equal(result.mesh.safety.validatedGeometry, false);
  assert.equal(result.mesh.safety.redistributionAllowed, 'unknown');
  assert.deepEqual(result.metadata.safety, { validatedGeometry: false, redistributionAllowed: 'unknown' });
});

test('local geometry key is stable per implant so replacing the file bumps registry revision', async () => {
  const module = await loadModule();
  assert.ok(module);
  assert.equal(module.makeLocalImplantGeometryKey({ implantId: 'abc' }), 'local:implant:abc');
  assert.equal(module.makeLocalImplantGeometryKey({ implantId: 'abc', filename: 'other.stl', size: 999 }), 'local:implant:abc');
  assert.throws(() => module.makeLocalImplantGeometryKey({ implantId: '   ' }), (error) => error?.code === 'INVALID_GEOMETRY_VALUE');
});
