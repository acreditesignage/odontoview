import test from 'node:test';
import assert from 'node:assert/strict';

async function loadGeometrySchema() {
  return import('./geometrySchema.js').catch(() => null);
}

function minimalMesh() {
  return {
    geometrySchemaVersion: 1,
    source: {
      assetId: 'asset-1',
      sourcePath: 'implant/TEST/triangle.stl',
      filename: 'triangle.stl',
      format: 'stl-ascii',
    },
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
    bounds: {
      min: [0, 0, 0],
      max: [1, 1, 0],
    },
    safety: {
      validatedGeometry: false,
      redistributionAllowed: 'unknown',
    },
  };
}

function assertInvalid(schema, mesh, fragment) {
  const validation = schema.validateNeutralGeometry(mesh);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes(fragment)),
    `expected an error containing ${fragment}; got ${validation.errors.join(' | ')}`,
  );
}

test('neutral geometry schema accepts a minimal valid one-triangle mesh', async () => {
  const schema = await loadGeometrySchema();
  assert.ok(schema, 'geometrySchema.js must exist');
  assert.equal(schema.IMPLANT_GEOMETRY_SCHEMA_VERSION, 1);

  const mesh = minimalMesh();
  const validation = schema.validateNeutralGeometry(mesh);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(mesh.positions.length, mesh.vertexCount * 3);
  assert.equal(mesh.normals.length, mesh.vertexCount * 3);
  assert.equal(mesh.indices.length, mesh.triangleCount * 3);
});

test('geometry schema exposes a frozen column-major identity matrix', async () => {
  const schema = await loadGeometrySchema();
  assert.ok(schema);
  assert.deepEqual(schema.IDENTITY_MATRIX_4X4, [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  assert.equal(Object.isFrozen(schema.IDENTITY_MATRIX_4X4), true);
});

test('ImplantGeometryError preserves stable code and details', async () => {
  const schema = await loadGeometrySchema();
  assert.ok(schema);
  const error = new schema.ImplantGeometryError('INVALID_STL', 'Invalid STL', ['facet 1']);
  assert.equal(error.name, 'ImplantGeometryError');
  assert.equal(error.code, 'INVALID_STL');
  assert.equal(error.message, 'Invalid STL');
  assert.deepEqual(error.details, ['facet 1']);
});

test('validator rejects non-finite coordinates and normals', async () => {
  const schema = await loadGeometrySchema();
  const mesh = minimalMesh();
  mesh.positions[0] = Number.NaN;
  mesh.normals[0] = Number.POSITIVE_INFINITY;
  assertInvalid(schema, mesh, 'finite');
});

test('validator rejects indices outside the vertex range', async () => {
  const schema = await loadGeometrySchema();
  const mesh = minimalMesh();
  mesh.indices[2] = 3;
  assertInvalid(schema, mesh, 'index');
});

test('validator rejects typed-array lengths inconsistent with declared counts', async () => {
  const schema = await loadGeometrySchema();
  const mesh = minimalMesh();
  mesh.positions = new Float32Array([0, 0, 0]);
  assertInvalid(schema, mesh, 'positions.length');
});

test('validator rejects a mesh with zero triangles', async () => {
  const schema = await loadGeometrySchema();
  const mesh = minimalMesh();
  mesh.triangleCount = 0;
  assertInvalid(schema, mesh, 'triangleCount');
});

test('validator rejects invalid or non-enclosing bounds', async () => {
  const schema = await loadGeometrySchema();
  const mesh = minimalMesh();
  mesh.bounds = { min: [0, 0, 0], max: [0.5, 0.5, 0] };
  assertInvalid(schema, mesh, 'bounds');
});

test('validator rejects malformed safety metadata', async () => {
  const schema = await loadGeometrySchema();
  const mesh = minimalMesh();
  mesh.safety = { validatedGeometry: 'yes', redistributionAllowed: 'maybe' };
  assertInvalid(schema, mesh, 'safety');
});
