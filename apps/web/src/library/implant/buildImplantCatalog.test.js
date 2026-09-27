import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ImplantCatalogValidationError,
} from './catalogSchema.js';
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

function geometryAsset(role, filename, id) {
  return {
    id,
    role,
    filename,
    format: filename.toLowerCase().endsWith('.sdfa') ? 'SDFA' : 'STL',
    sourceSignature: `signature-${id}`,
    validatedGeometry: false,
    redistributionAllowed: 'unknown',
  };
}

function geometryAuditReport() {
  const library = importedLibrary();
  library.components = [
    {
      id: 'component-interface',
      systemId: 'sin-cm',
      name: 'Interface',
      role: 'interface',
      variants: [
        {
          id: 'variant-resolved',
          familyId: 'component-interface',
          name: 'Resolved variant',
          geometry: {
            support: geometryAsset('support', 'ResolvedPart.stl', 'asset-resolved'),
          },
        },
        {
          id: 'variant-missing',
          familyId: 'component-interface',
          name: 'Missing variant',
          geometry: {
            interface: geometryAsset('interface', 'MissingPart.stl', 'asset-missing'),
          },
        },
        {
          id: 'variant-ambiguous',
          familyId: 'component-interface',
          name: 'Ambiguous variant',
          geometry: {
            screw: geometryAsset('screw', 'DuplicatePart.sdfa', 'asset-ambiguous'),
          },
        },
      ],
    },
  ];

  return {
    summary: {
      totalEntries: 1,
      importedEntries: 1,
      unsupportedEntries: 0,
      invalidEntries: 0,
      components: 1,
      variants: 3,
      warnings: 0,
      geometryReferences: 3,
      resolvedGeometryFiles: 1,
      missingGeometryFiles: 1,
      ambiguousGeometryFiles: 1,
    },
    entries: [
      {
        path: 'implant/SIN_CM/config.xml',
        status: 'imported',
        library,
        warnings: [],
        geometry: {
          references: [
            { reference: 'ResolvedPart.stl', role: 'support' },
            { reference: 'MissingPart.stl', role: 'interface' },
            { reference: 'DuplicatePart.sdfa', role: 'screw' },
          ],
          resolved: [
            {
              reference: 'ResolvedPart.stl',
              role: 'support',
              matchedPath: 'implant/SIN_CM/RESOLVEDPART.STL',
              resolution: 'resolved',
            },
          ],
          missing: [
            {
              reference: 'MissingPart.stl',
              role: 'interface',
              resolution: 'missing',
            },
          ],
          ambiguous: [
            {
              reference: 'DuplicatePart.sdfa',
              role: 'screw',
              candidates: [
                'implant/SIN_CM/DuplicatePart.SDFA',
                'implant/SIN_CM/duplicatepart.sdfa',
              ],
              resolution: 'ambiguous',
            },
          ],
        },
      },
    ],
  };
}

function geometryByVariant(catalog, variantId, role) {
  const component = catalog.libraries[0].components[0];
  return component.variants.find((variant) => variant.id === variantId).geometry[role];
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

test('enriches resolved, missing and ambiguous geometry without changing safety metadata', () => {
  const catalog = buildImplantCatalog(geometryAuditReport(), { sourceName: 'geometry-bundle' });

  const resolved = geometryByVariant(catalog, 'variant-resolved', 'support');
  assert.equal(resolved.reference, 'ResolvedPart.stl');
  assert.equal(resolved.resolution, 'resolved');
  assert.equal(resolved.matchedPath, 'implant/SIN_CM/RESOLVEDPART.STL');
  assert.equal(resolved.sourceSignature, 'signature-asset-resolved');
  assert.equal(resolved.validatedGeometry, false);
  assert.equal(resolved.redistributionAllowed, 'unknown');

  const missing = geometryByVariant(catalog, 'variant-missing', 'interface');
  assert.equal(missing.reference, 'MissingPart.stl');
  assert.equal(missing.resolution, 'missing');
  assert.equal('matchedPath' in missing, false);

  const ambiguous = geometryByVariant(catalog, 'variant-ambiguous', 'screw');
  assert.equal(ambiguous.reference, 'DuplicatePart.sdfa');
  assert.equal(ambiguous.resolution, 'ambiguous');
  assert.deepEqual(ambiguous.candidates, [
    'implant/SIN_CM/DuplicatePart.SDFA',
    'implant/SIN_CM/duplicatepart.sdfa',
  ]);
});

test('preserves case-only ambiguous geometry candidates instead of collapsing them', () => {
  const catalog = buildImplantCatalog(geometryAuditReport());
  const ambiguous = geometryByVariant(catalog, 'variant-ambiguous', 'screw');

  assert.equal(ambiguous.candidates.length, 2);
  assert.notEqual(ambiguous.candidates[0], ambiguous.candidates[1]);
  assert.equal(ambiguous.candidates[0].toLowerCase(), ambiguous.candidates[1].toLowerCase());
});

test('rejects an audit/library mismatch instead of silently treating untracked geometry as resolved', () => {
  const audit = geometryAuditReport();
  audit.entries[0].geometry = { references: [], resolved: [], missing: [], ambiguous: [] };
  audit.summary.geometryReferences = 0;
  audit.summary.resolvedGeometryFiles = 0;
  audit.summary.missingGeometryFiles = 0;
  audit.summary.ambiguousGeometryFiles = 0;

  assert.throws(
    () => buildImplantCatalog(audit),
    (error) => error instanceof ImplantCatalogValidationError
      && error.details.some((detail) => detail.includes('.reference')),
  );
});
