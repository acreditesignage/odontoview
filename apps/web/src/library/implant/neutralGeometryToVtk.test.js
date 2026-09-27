import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule() {
  return import('./neutralGeometryToVtk.js').catch(() => null);
}

function mesh() {
  return {
    geometrySchemaVersion: 1,
    source: { assetId: 'asset-1', sourcePath: 'local/implant.stl', filename: 'implant.stl', format: 'stl-ascii' },
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
    bounds: { min: [0, 0, 0], max: [2, 3, 0] },
    safety: { validatedGeometry: false, redistributionAllowed: 'unknown' },
  };
}

test('adapter copies neutral positions and triangles into vtk polydata without mutating input', async () => {
  const module = await loadModule();
  assert.ok(module, 'neutralGeometryToVtk.js must exist');
  const input = mesh();
  const originalPositions = Array.from(input.positions);
  const originalIndices = Array.from(input.indices);
  const result = module.createVtkPolyDataFromNeutralGeometry(input);
  assert.deepEqual(Array.from(result.points.getData()), originalPositions);
  assert.deepEqual(Array.from(result.polys.getData()), [3, 0, 1, 2]);
  assert.equal(result.poly.getNumberOfPoints(), 3);
  assert.equal(result.poly.getNumberOfPolys(), 1);
  assert.deepEqual(Array.from(input.positions), originalPositions);
  assert.deepEqual(Array.from(input.indices), originalIndices);
});

test('adapter rejects invalid neutral geometry with stable code', async () => {
  const module = await loadModule();
  assert.ok(module);
  assert.throws(() => module.createVtkPolyDataFromNeutralGeometry({ nope: true }), (error) => error?.code === 'INVALID_GEOMETRY_VALUE');
});

test('mesh bundle applies local calibration before vtk conversion and leaves clinical actor transform at origin', async () => {
  const module = await loadModule();
  assert.ok(module);
  const transform = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    10, 20, 30, 1,
  ];
  const bundle = module.createVtkImplantGeometryBundle({ mesh: mesh(), localTransform: transform, active: true });
  assert.equal(bundle.mode, 'mesh');
  assert.deepEqual(Array.from(bundle.points.getData()).slice(0, 3), [10, 20, 30]);
  assert.deepEqual(bundle.actor.getPosition(), [0, 0, 0]);
  assert.deepEqual(bundle.actor.getOrientation(), [0, 0, 0]);
  module.disposeVtkImplantGeometryBundle(bundle);
});

test('singular local calibration is rejected through the existing transform pipeline', async () => {
  const module = await loadModule();
  assert.ok(module);
  const singular = [
    0, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  assert.throws(
    () => module.createVtkImplantGeometryBundle({ mesh: mesh(), localTransform: singular }),
    (error) => error?.code === 'INVALID_TRANSFORM',
  );
});

test('vtk bundle disposal is idempotent', async () => {
  const module = await loadModule();
  assert.ok(module);
  const bundle = module.createVtkImplantGeometryBundle({ mesh: mesh() });
  assert.doesNotThrow(() => module.disposeVtkImplantGeometryBundle(bundle));
  assert.doesNotThrow(() => module.disposeVtkImplantGeometryBundle(bundle));
});
