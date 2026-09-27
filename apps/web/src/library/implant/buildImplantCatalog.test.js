import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImplantCatalog } from './buildImplantCatalog.js';

function importedLibrary() {
  return {
    schemaVersion: 1,
    manufacturer: { id: 'sin', name: 'SIN' },
    system: { id: 'sin-cm', manufacturerId: 'sin', name: 'CM' },
    components: [],
    source: { format: 'exocad-implant-library' },
    validatedGeometry: false,
    redistributionAllowed: 'unknown',
  };
}

function mixedAuditReport() {
  return {
    summary: {
      totalEntries: 3,
      importedEntries: 1,
      unsupportedEntries: 1,
      invalidEntries: 1,
      components: 0,
      variants: 0,
      warnings: 0,
      geometryReferences: 0,
      resolvedGeometryFiles: 0,
      missingGeometryFiles: 0,
      ambiguousGeometryFiles: 0,
    },
    entries: [
      {
        path: 'implant/SIN_CM/config.xml',
        status: 'imported',
        library: importedLibrary(),
        warnings: [],
        geometry: { references: [], resolved: [], missing: [], ambiguous: [] },
      },
      {
        path: 'modelcreator/SIN/config.xml',
        status: 'unsupported',
        error: { code: 'UNSUPPORTED_ROOT', message: 'Unsupported XML root' },
      },
      {
        path: 'implant/BROKEN/config.xml',
        status: 'invalid',
        error: { code: 'INVALID_XML', message: 'Invalid XML' },
      },
    ],
  };
}

test('builds catalog from imported audit entries while preserving unsupported and invalid diagnostics', () => {
  const audit = mixedAuditReport();
  const catalog = buildImplantCatalog(audit, { sourceName: 'synthetic-bundle' });

  assert.equal(catalog.catalogSchemaVersion, 1);
  assert.deepEqual(catalog.summary, audit.summary);
  assert.equal(catalog.source.kind, 'implant-library-bundle');
  assert.equal(catalog.source.name, 'synthetic-bundle');
  assert.equal(catalog.libraries.length, 1);
  assert.equal(catalog.libraries[0].sourcePath, 'implant/SIN_CM/config.xml');
  assert.equal(catalog.libraries[0].manufacturer.name, 'SIN');
  assert.equal(catalog.libraries[0].system.name, 'CM');
  assert.match(catalog.libraries[0].id, /^implant-library-/);
  assert.equal(catalog.diagnostics.unsupportedEntries.length, 1);
  assert.equal(catalog.diagnostics.unsupportedEntries[0].path, 'modelcreator/SIN/config.xml');
  assert.equal(catalog.diagnostics.invalidEntries.length, 1);
  assert.equal(catalog.diagnostics.invalidEntries[0].path, 'implant/BROKEN/config.xml');
  assert.deepEqual(catalog.diagnostics.warnings, []);
});
