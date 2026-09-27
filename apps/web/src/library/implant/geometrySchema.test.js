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
