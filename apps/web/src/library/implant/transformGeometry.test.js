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

function assertArrayClose(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance, `index ${index}: expected ${expected[index]}, got ${value}`);
  });
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

test('rotation transforms both positions and normals predictably', async () => {
  const module = await loadTransform();
  assert.ok(module);
  const input = mesh();
  input.normals = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]);
  const matrix = [
    0, 1, 0, 0,
    -1, 0, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];

  const output = module.transformGeometry(input, matrix);

  assertArrayClose(Array.from(output.positions), [0, 0, 0, 0, 1, 0, -1, 0, 0]);
  assertArrayClose(Array.from(output.normals), [0, 1, 0, 0, 1, 0, 0, 1, 0]);
  assert.deepEqual(output.bounds, { min: [-1, 0, 0], max: [0, 1, 0] });
});

test('non-uniform scale transforms normals with inverse-transpose semantics', async () => {
  const module = await loadTransform();
  assert.ok(module);
  const input = mesh();
  const n = Math.SQRT1_2;
  input.normals = new Float32Array([n, 0, n, n, 0, n, n, 0, n]);
  const matrix = [
    2, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0,
    0, 0, 0, 1,
  ];

  const output = module.transformGeometry(input, matrix);
  const expected = [0.242535625, 0, 0.9701425];
  assertArrayClose(Array.from(output.normals), [...expected, ...expected, ...expected], 1e-5);
});

test('singular linear transform is rejected instead of producing invalid normals', async () => {
  const module = await loadTransform();
  assert.ok(module);
  const matrix = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 1,
  ];
  assert.throws(() => module.transformGeometry(mesh(), matrix), (error) => error?.code === 'INVALID_TRANSFORM');
});

test('invalid transform matrix length and non-finite values are rejected', async () => {
  const module = await loadTransform();
  assert.ok(module);
  assert.throws(() => module.transformGeometry(mesh(), [1, 0, 0]), (error) => error?.code === 'INVALID_TRANSFORM');
  assert.throws(
    () => module.transformGeometry(mesh(), [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, Number.NaN, 1,
    ]),
    (error) => error?.code === 'INVALID_TRANSFORM',
  );
});
