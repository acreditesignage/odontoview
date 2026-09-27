import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPLANT_CATALOG_SCHEMA_VERSION,
  validateImplantCatalog,
} from './catalogSchema.js';

function minimalCatalog() {
  return {
    catalogSchemaVersion: 1,
    source: {
      kind: 'implant-library-bundle',
      name: 'synthetic-bundle',
    },
    summary: {
      totalEntries: 1,
      importedEntries: 1,
      unsupportedEntries: 0,
      invalidEntries: 0,
      geometryReferences: 1,
      resolvedGeometryFiles: 1,
      missingGeometryFiles: 0,
      ambiguousGeometryFiles: 0,
    },
    libraries: [
      {
        id: 'library-sin-cm',
        sourcePath: 'implant/SIN_CM_SW/config.xml',
        manufacturer: { id: 'sin', name: 'SIN' },
        system: { id: 'sin-cm', manufacturerId: 'sin', name: 'CM' },
        components: [
          {
            id: 'component-interface',
            systemId: 'sin-cm',
            name: 'Interface',
            role: 'interface',
            variants: [
              {
                id: 'variant-icmt-0502',
                familyId: 'component-interface',
                name: 'ICMT 0502',
                geometry: {
                  support: {
                    id: 'asset-support-1',
                    role: 'support',
                    filename: 'G_ICMT_0502.stl',
                    format: 'STL',
                    sourceSignature: null,
                    validatedGeometry: false,
                    redistributionAllowed: 'unknown',
                    reference: 'G_ICMT_0502.stl',
                    resolution: 'resolved',
                    matchedPath: 'implant/SIN_CM_SW/G_ICMT_0502.STL',
                  },
                },
              },
            ],
          },
        ],
      },
    ],
    diagnostics: {
      unsupportedEntries: [],
      invalidEntries: [],
      warnings: [],
    },
  };
}

test('implant catalog schema version is 1', () => {
  assert.equal(IMPLANT_CATALOG_SCHEMA_VERSION, 1);
});

test('validator accepts a minimal valid catalog with resolved geometry', () => {
  const result = validateImplantCatalog(minimalCatalog());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});
