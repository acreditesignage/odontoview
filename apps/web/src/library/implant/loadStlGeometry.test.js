import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAsciiStl } from './stlTestFixtures.js';

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
