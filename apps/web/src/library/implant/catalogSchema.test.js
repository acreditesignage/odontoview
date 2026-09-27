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

function supportAsset(catalog) {
  return catalog.libraries[0].components[0].variants[0].geometry.support;
}

test('implant catalog schema version is 1', () => {
  assert.equal(IMPLANT_CATALOG_SCHEMA_VERSION, 1);
});

test('validator accepts a minimal valid catalog with resolved geometry', () => {
  const result = validateImplantCatalog(minimalCatalog());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validator rejects duplicate library ids', () => {
  const catalog = minimalCatalog();
  const duplicate = structuredClone(catalog.libraries[0]);
  duplicate.sourcePath = 'implant/SIN_CM_SW_DUP/config.xml';
  catalog.libraries.push(duplicate);
  catalog.summary.totalEntries = 2;
  catalog.summary.importedEntries = 2;
  catalog.summary.geometryReferences = 2;
  catalog.summary.resolvedGeometryFiles = 2;

  const result = validateImplantCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate library id')));
});

test('validator rejects duplicate component and variant ids within a library', () => {
  const catalog = minimalCatalog();
  const duplicateComponent = structuredClone(catalog.libraries[0].components[0]);
  catalog.libraries[0].components.push(duplicateComponent);
  catalog.summary.geometryReferences = 2;
  catalog.summary.resolvedGeometryFiles = 2;

  const result = validateImplantCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate component id')));
  assert.ok(result.errors.some((error) => error.includes('duplicate variant id')));
});

test('validator rejects geometry assets without filename or reference', () => {
  const catalog = minimalCatalog();
  const asset = supportAsset(catalog);
  asset.filename = '';
  asset.reference = '';

  const result = validateImplantCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('.filename')));
  assert.ok(result.errors.some((error) => error.includes('.reference')));
});

test('validator rejects resolved geometry without matchedPath', () => {
  const catalog = minimalCatalog();
  delete supportAsset(catalog).matchedPath;

  const result = validateImplantCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('.matchedPath')));
});

test('validator rejects ambiguous geometry with fewer than two candidates', () => {
  const catalog = minimalCatalog();
  const asset = supportAsset(catalog);
  asset.resolution = 'ambiguous';
  delete asset.matchedPath;
  asset.candidates = ['implant/A/G_ICMT_0502.STL'];
  catalog.summary.resolvedGeometryFiles = 0;
  catalog.summary.ambiguousGeometryFiles = 1;

  const result = validateImplantCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('.candidates')));
});

test('validator rejects unknown geometry resolution values', () => {
  const catalog = minimalCatalog();
  supportAsset(catalog).resolution = 'guessed';

  const result = validateImplantCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('.resolution')));
});

test('validator rejects summary counts inconsistent with catalog contents', () => {
  const catalog = minimalCatalog();
  catalog.summary.importedEntries = 0;
  catalog.summary.totalEntries = 0;

  const result = validateImplantCatalog(catalog);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('summary.importedEntries')));
});
