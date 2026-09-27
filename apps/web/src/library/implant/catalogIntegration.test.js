import test from 'node:test';
import assert from 'node:assert/strict';
import { auditImplantLibraryBundle } from './auditImplantLibraryBundle.js';
import { catalogMixedBundleFixture } from './catalog-mixed-bundle.fixture.js';
import {
  buildImplantCatalog,
  getVariantGeometryAssets,
  listCatalogComponents,
  listCatalogManufacturers,
  listCatalogSystems,
  listCatalogVariants,
  validateImplantCatalog,
} from './index.js';

function geometryAssets(geometry) {
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) return [];
  return Object.values(geometry).filter(
    (asset) => asset && typeof asset === 'object' && !Array.isArray(asset),
  );
}

function allCatalogGeometryAssets(catalog) {
  const assets = [];
  for (const library of catalog.libraries ?? []) {
    assets.push(...geometryAssets(library.geometry));
    for (const component of library.components ?? []) {
      assets.push(...geometryAssets(component.geometry));
      for (const variant of component.variants ?? []) {
        assets.push(...geometryAssets(variant.geometry));
      }
    }
  }
  return assets;
}

test('audits a synthetic mixed bundle into a validated, navigable catalog without hiding geometry problems', () => {
  const audit = auditImplantLibraryBundle(catalogMixedBundleFixture);

  assert.equal(audit.summary.totalEntries, 3);
  assert.equal(audit.summary.importedEntries, 2);
  assert.equal(audit.summary.unsupportedEntries, 1);
  assert.equal(audit.summary.invalidEntries, 0);

  const catalog = buildImplantCatalog(audit, { sourceName: 'synthetic-mixed-bundle' });
  const validation = validateImplantCatalog(catalog);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(catalog.summary, audit.summary);
  assert.equal(catalog.libraries.length, 2);
  assert.equal(catalog.diagnostics.unsupportedEntries.length, 1);
  assert.equal(catalog.diagnostics.unsupportedEntries[0].error.code, 'UNSUPPORTED_ROOT');

  const assets = allCatalogGeometryAssets(catalog);
  const caseOnlyAssets = assets.filter((asset) => asset.reference === 'CaseOnly.stl');
  assert.ok(caseOnlyAssets.length >= 1);
  assert.ok(caseOnlyAssets.every((asset) => asset.resolution === 'resolved'));
  assert.ok(caseOnlyAssets.every((asset) => asset.matchedPath === 'implant/ALPHA/CASEONLY.STL'));

  const missingAssets = assets.filter((asset) =>
    ['MissingImplant.stl', 'MissingSupport.stl'].includes(asset.reference),
  );
  assert.ok(missingAssets.length >= 2);
  assert.ok(missingAssets.every((asset) => asset.resolution === 'missing'));

  const ambiguousAssets = assets.filter((asset) => asset.reference === 'Ambiguous.sdfa');
  assert.ok(ambiguousAssets.length >= 2);
  assert.ok(ambiguousAssets.every((asset) => asset.resolution === 'ambiguous'));
  assert.ok(ambiguousAssets.every((asset) => asset.candidates.length === 2));

  const manufacturers = listCatalogManufacturers(catalog);
  assert.equal(manufacturers.length, 2);

  const alphaLibrary = catalog.libraries.find((library) => library.sourcePath === 'implant/ALPHA/config.xml');
  assert.ok(alphaLibrary);

  const alphaSystems = listCatalogSystems(catalog, alphaLibrary.manufacturer.id);
  assert.ok(alphaSystems.some((system) => system.id === alphaLibrary.system.id));

  const alphaComponents = listCatalogComponents(catalog, alphaLibrary.system.id);
  const alphaComponent = alphaComponents.find((component) => (component.variants?.length ?? 0) >= 3);
  assert.ok(alphaComponent);

  const alphaVariants = listCatalogVariants(catalog, alphaComponent.id);
  assert.equal(alphaVariants.length, 3);

  const allVariantStates = new Set();
  for (const variant of alphaVariants) {
    const variantAssets = getVariantGeometryAssets(catalog, variant.id);
    variantAssets.forEach((asset) => allVariantStates.add(asset.resolution));

    const loadableAssets = getVariantGeometryAssets(catalog, variant.id, { resolvedOnly: true });
    assert.ok(loadableAssets.every((asset) =>
      asset.resolution === 'resolved'
      && typeof asset.matchedPath === 'string'
      && asset.matchedPath.length > 0,
    ));
    assert.ok(loadableAssets.every((asset) => asset.validatedGeometry === false));
    assert.ok(loadableAssets.every((asset) => asset.redistributionAllowed === 'unknown'));
  }

  assert.deepEqual([...allVariantStates].sort(), ['ambiguous', 'missing', 'resolved']);
});
