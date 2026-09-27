import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeAsciiStl,
  makeDegenerateAsciiStl,
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
