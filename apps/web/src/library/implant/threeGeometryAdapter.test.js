import test from 'node:test';
import assert from 'node:assert/strict';

async function loadAdapter() {
  return import('./threeGeometryAdapter.js').catch(() => null);
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

test('adapter creates Three BufferGeometry without mutating neutral mesh', async () => {
  const module = await loadAdapter();
  assert.ok(module, 'threeGeometryAdapter.js must exist');

  const input = mesh();
  const original = {
    positions: Array.from(input.positions),
    normals: Array.from(input.normals),
    indices: Array.from(input.indices),
    source: structuredClone(input.source),
    safety: structuredClone(input.safety),
  };

  const geometry = module.createThreeBufferGeometry(input);

  assert.equal(geometry.isBufferGeometry, true);
  assert.equal(geometry.getAttribute('position').itemSize, 3);
  assert.equal(geometry.getAttribute('normal').itemSize, 3);
  assert.deepEqual(Array.from(geometry.getAttribute('position').array), original.positions);
  assert.deepEqual(Array.from(geometry.getAttribute('normal').array), original.normals);
  assert.deepEqual(Array.from(geometry.getIndex().array), original.indices);
  assert.ok(geometry.boundingBox);
  assert.ok(geometry.boundingSphere);

  geometry.getAttribute('position').array[0] = 99;
  assert.deepEqual(Array.from(input.positions), original.positions);
  assert.deepEqual(Array.from(input.normals), original.normals);
  assert.deepEqual(Array.from(input.indices), original.indices);
  assert.deepEqual(input.source, original.source);
  assert.deepEqual(input.safety, original.safety);

  geometry.dispose();
});
