import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeAsciiStl,
  makeBinaryStl,
  makeDegenerateAsciiStl,
  makeSolidHeaderBinaryStl,
  makeTruncatedBinaryStl,
  makeZeroNormalAsciiStl,
} from './stlTestFixtures.js';

async function loadModule() {
  return import('./loadStlGeometry.js').catch(() => null);
}

function asset(overrides = {}) {
  return {
    id: 'asset-1',
    role: 'support',
    filename: 'triangle.stl',
    reference: 'triangle.stl',
    resolution: 'resolved',
    matchedPath: 'implant/TEST/TRIANGLE.STL',
    validatedGeometry: false,
    redistributionAllowed: 'unknown',
    ...overrides,
  };
}

async function expectCode(assetValue, bytes, code) {
  const module = await loadModule();
  assert.ok(module, 'loadStlGeometry.js must exist');
  assert.throws(
    () => module.loadStlGeometry(assetValue, bytes),
    (error) => error?.code === code,
  );
}

test('loader rejects missing catalog geometry', async () => {
  await expectCode(asset({ resolution: 'missing', matchedPath: undefined }), makeAsciiStl(), 'UNRESOLVED_GEOMETRY');
});

test('loader rejects ambiguous catalog geometry instead of selecting a candidate', async () => {
  await expectCode(
    asset({ resolution: 'ambiguous', matchedPath: undefined, candidates: ['a.stl', 'b.stl'] }),
    makeAsciiStl(),
    'UNRESOLVED_GEOMETRY',
  );
});

test('loader rejects resolved geometry with a blank matched path', async () => {
  await expectCode(asset({ matchedPath: '   ' }), makeAsciiStl(), 'UNRESOLVED_GEOMETRY');
});

test('loader rejects SDFA as unsupported in milestone 3', async () => {
  await expectCode(
    asset({ filename: 'part.sdfa', reference: 'part.sdfa', matchedPath: 'implant/TEST/PART.SDFA' }),
    new Uint8Array([1, 2, 3]),
    'UNSUPPORTED_GEOMETRY_FORMAT',
  );
});

test('loader rejects bytes that are not a structurally valid STL', async () => {
  await expectCode(asset(), new TextEncoder().encode('not an stl'), 'INVALID_STL');
});

test('loader parses a valid ASCII STL into deterministic neutral geometry', async () => {
  const module = await loadModule();
  const mesh = module.loadStlGeometry(asset(), makeAsciiStl());

  assert.equal(mesh.geometrySchemaVersion, 1);
  assert.equal(mesh.source.assetId, 'asset-1');
  assert.equal(mesh.source.sourcePath, 'implant/TEST/TRIANGLE.STL');
  assert.equal(mesh.source.filename, 'triangle.stl');
  assert.equal(mesh.source.format, 'stl-ascii');
  assert.equal(mesh.vertexCount, 3);
  assert.equal(mesh.triangleCount, 1);
  assert.deepEqual(Array.from(mesh.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(mesh.normals), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  assert.deepEqual(Array.from(mesh.indices), [0, 1, 2]);
  assert.deepEqual(mesh.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
  assert.deepEqual(mesh.safety, { validatedGeometry: false, redistributionAllowed: 'unknown' });
});

test('loader recomputes a zero ASCII facet normal from triangle vertices', async () => {
  const module = await loadModule();
  const mesh = module.loadStlGeometry(asset(), makeZeroNormalAsciiStl());
  assert.deepEqual(Array.from(mesh.normals), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
});

test('loader rejects malformed ASCII facet structure without returning partial geometry', async () => {
  const malformed = new TextEncoder().encode([
    'solid malformed',
    'facet normal 0 0 1',
    'outer loop',
    'vertex 0 0 0',
    'vertex 1 0 0',
    'endloop',
    'endfacet',
    'endsolid malformed',
  ].join('\n'));
  await expectCode(asset(), malformed, 'INVALID_STL');
});

test('loader rejects non-finite ASCII vertex values', async () => {
  await expectCode(
    asset(),
    makeAsciiStl({ vertices: [[Number.NaN, 0, 0], [1, 0, 0], [0, 1, 0]] }),
    'INVALID_GEOMETRY_VALUE',
  );
  await expectCode(
    asset(),
    makeAsciiStl({ vertices: [[Number.POSITIVE_INFINITY, 0, 0], [1, 0, 0], [0, 1, 0]] }),
    'INVALID_GEOMETRY_VALUE',
  );
});

test('loader rejects degenerate ASCII triangles', async () => {
  await expectCode(asset(), makeDegenerateAsciiStl(), 'DEGENERATE_GEOMETRY');
});

test('loader parses a standard Binary STL into the same neutral mesh contract', async () => {
  const module = await loadModule();
  const mesh = module.loadStlGeometry(asset(), makeBinaryStl());
  assert.equal(mesh.source.format, 'stl-binary');
  assert.equal(mesh.vertexCount, 3);
  assert.equal(mesh.triangleCount, 1);
  assert.deepEqual(Array.from(mesh.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(mesh.indices), [0, 1, 2]);
  assert.deepEqual(mesh.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
});

test('loader detects Binary STL structurally even when the header begins with solid', async () => {
  const module = await loadModule();
  const mesh = module.loadStlGeometry(asset(), makeSolidHeaderBinaryStl());
  assert.equal(mesh.source.format, 'stl-binary');
  assert.equal(mesh.triangleCount, 1);
});

test('loader rejects truncated Binary STL before parsing triangle arrays', async () => {
  await expectCode(asset(), makeTruncatedBinaryStl(), 'TRUNCATED_BINARY_STL');
});

test('loader rejects non-finite Binary coordinates', async () => {
  await expectCode(
    asset(),
    makeBinaryStl({ vertices: [[Number.NaN, 0, 0], [1, 0, 0], [0, 1, 0]] }),
    'INVALID_GEOMETRY_VALUE',
  );
});

test('loader rejects degenerate Binary triangles', async () => {
  await expectCode(
    asset(),
    makeBinaryStl({ vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] }),
    'DEGENERATE_GEOMETRY',
  );
});

test('loader output is deterministic for identical STL input', async () => {
  const module = await loadModule();
  const bytes = makeAsciiStl();
  const first = module.loadStlGeometry(asset(), bytes);
  const second = module.loadStlGeometry(asset(), bytes);

  assert.deepEqual(first.source, second.source);
  assert.deepEqual(first.bounds, second.bounds);
  assert.deepEqual(first.safety, second.safety);
  assert.equal(first.vertexCount, second.vertexCount);
  assert.equal(first.triangleCount, second.triangleCount);
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  assert.deepEqual(Array.from(first.normals), Array.from(second.normals));
  assert.deepEqual(Array.from(first.indices), Array.from(second.indices));
});
