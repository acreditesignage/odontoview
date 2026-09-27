import test from 'node:test';
import assert from 'node:assert/strict';

async function loadTransform() {
  return import('./transformGeometry.js').catch(() => null);
}

function mesh() {
  return {
    geometrySchemaVersion: 1,
    source: {
      assetId: 'asset-1',
      sourcePath: 'implant/TEST/TRIANGLE.STL',
      filename: 'triangle.stl',
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

test('identity transform preserves positions and topology without mutating input', async () => {
  const module = await loadTransform();
  assert.ok(module, 'transformGeometry.js must exist');
  const input = mesh();
  const before = Array.from(input.positions);
  const output = module.transformGeometry(input);

  assert.deepEqual(Array.from(output.positions), before);
  assert.deepEqual(Array.from(output.indices), [0, 1, 2]);
  assert.deepEqual(output.bounds, input.bounds);
  assert.deepEqual(output.source, input.source);
  assert.deepEqual(output.safety, input.safety);
  assert.deepEqual(Array.from(input.positions), before);
  assert.notStrictEqual(output.positions, input.positions);
  assert.notStrictEqual(output.indices, input.indices);
});

test('translation moves positions and bounds but not normals', async () => {
  const module = await loadTransform();
  assert.ok(module);
  const input = mesh();
  const matrix = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    2, 3, 4, 1,
  ];
  const output = module.transformGeometry(input, matrix);

  assert.deepEqual(Array.from(output.positions), [2, 3, 4, 3, 3, 4, 2, 4, 4]);
  assert.deepEqual(Array.from(output.normals), Array.from(input.normals));
  assert.deepEqual(output.bounds, { min: [2, 3, 4], max: [3, 4, 4] });
  assert.deepEqual(output.transform.matrix, matrix);
  assert.deepEqual(Array.from(input.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});
