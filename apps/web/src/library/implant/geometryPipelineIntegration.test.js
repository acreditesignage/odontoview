import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAsciiStl } from './stlTestFixtures.js';
import {
  getVariantGeometryAssets,
  IDENTITY_MATRIX_4X4,
  loadStlGeometry,
  transformGeometry,
  validateNeutralGeometry,
} from './index.js';

function pipelineCatalog() {
  return {
    catalogSchemaVersion: 1,
    libraries: [
      {
        id: 'library-test',
        manufacturer: { id: 'manufacturer-test', name: 'Synthetic' },
        system: { id: 'system-test', manufacturerId: 'manufacturer-test', name: 'Synthetic System' },
        components: [
          {
            id: 'component-test',
            systemId: 'system-test',
            name: 'Synthetic component',
            variants: [
              {
                id: 'variant-test',
                familyId: 'component-test',
                name: 'Synthetic variant',
                geometry: {
                  support: {
                    id: 'asset-resolved',
                    role: 'support',
                    filename: 'triangle.stl',
                    reference: 'triangle.stl',
                    resolution: 'resolved',
                    matchedPath: 'implant/TEST/TRIANGLE.STL',
                    validatedGeometry: false,
                    redistributionAllowed: 'unknown',
                  },
                  interface: {
                    id: 'asset-missing',
                    role: 'interface',
                    filename: 'missing.stl',
                    reference: 'missing.stl',
                    resolution: 'missing',
                    validatedGeometry: false,
                    redistributionAllowed: 'unknown',
                  },
                  screw: {
                    id: 'asset-ambiguous',
                    role: 'screw',
                    filename: 'ambiguous.stl',
                    reference: 'ambiguous.stl',
                    resolution: 'ambiguous',
                    candidates: ['one/ambiguous.stl', 'two/ambiguous.stl'],
                    validatedGeometry: false,
                    redistributionAllowed: 'unknown',
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

test('public catalog API flows resolved geometry through STL loading and identity transform', () => {
  const catalog = pipelineCatalog();
  const resolved = getVariantGeometryAssets(catalog, 'variant-test', { resolvedOnly: true });

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, 'asset-resolved');

  const loaded = loadStlGeometry(resolved[0], makeAsciiStl());
  assert.equal(loaded.source.sourcePath, 'implant/TEST/TRIANGLE.STL');
  assert.equal(loaded.safety.validatedGeometry, false);
  assert.equal(loaded.safety.redistributionAllowed, 'unknown');

  const transformed = transformGeometry(loaded, IDENTITY_MATRIX_4X4);
  const validation = validateNeutralGeometry(transformed);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(Array.from(transformed.positions), Array.from(loaded.positions));
});

test('missing and ambiguous catalog assets cannot bypass the loader gate', () => {
  const catalog = pipelineCatalog();
  const allAssets = getVariantGeometryAssets(catalog, 'variant-test');
  const missing = allAssets.find((asset) => asset.resolution === 'missing');
  const ambiguous = allAssets.find((asset) => asset.resolution === 'ambiguous');
  const bytes = makeAsciiStl();

  assert.throws(() => loadStlGeometry(missing, bytes), (error) => error?.code === 'UNRESOLVED_GEOMETRY');
  assert.throws(() => loadStlGeometry(ambiguous, bytes), (error) => error?.code === 'UNRESOLVED_GEOMETRY');
});
