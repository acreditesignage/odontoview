import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getVariantGeometryAssets,
  listCatalogComponents,
  listCatalogManufacturers,
  listCatalogSystems,
  listCatalogVariants,
} from './catalogSelectors.js';

function selectorCatalog() {
  return {
    catalogSchemaVersion: 1,
    libraries: [
      {
        id: 'library-sin-cm',
        manufacturer: { id: 'sin', name: 'SIN' },
        system: { id: 'sin-cm', manufacturerId: 'sin', name: 'CM' },
        components: [
          {
            id: 'sin-interface',
            systemId: 'sin-cm',
            name: 'Interface',
            variants: [
              {
                id: 'sin-interface-standard',
                familyId: 'sin-interface',
                name: 'Standard',
                attributes: { heightMm: null, sizeClass: null, design: null },
                sourceAttributes: { sourceToken: 'UNKNOWN' },
                geometry: {
                  support: {
                    id: 'sin-resolved',
                    role: 'support',
                    filename: 'sin-support.stl',
                    reference: 'sin-support.stl',
                    resolution: 'resolved',
                    matchedPath: 'implant/SIN/SIN-SUPPORT.STL',
                    validatedGeometry: false,
                    redistributionAllowed: 'unknown',
                  },
                  interface: {
                    id: 'sin-missing',
                    role: 'interface',
                    filename: 'sin-interface.stl',
                    reference: 'sin-interface.stl',
                    resolution: 'missing',
                    validatedGeometry: false,
                    redistributionAllowed: 'unknown',
                  },
                },
              },
            ],
          },
        ],
      },
      {
        id: 'library-sin-he',
        manufacturer: { id: 'sin', name: 'SIN' },
        system: { id: 'sin-he', manufacturerId: 'sin', name: 'HE' },
        components: [
          {
            id: 'sin-he-scanbody',
            systemId: 'sin-he',
            name: 'Scanbody',
            variants: [],
          },
        ],
      },
      {
        id: 'library-neodent-gm',
        manufacturer: { id: 'neodent', name: 'Neodent' },
        system: { id: 'neodent-gm', manufacturerId: 'neodent', name: 'Grand Morse' },
        components: [
          {
            id: 'neodent-link',
            systemId: 'neodent-gm',
            name: 'Link',
            variants: [
              {
                id: 'neodent-link-small',
                familyId: 'neodent-link',
                name: 'SMALL',
                attributes: { sizeClass: 'SMALL' },
                geometry: {},
              },
            ],
          },
        ],
      },
    ],
  };
}

test('navigates manufacturer to system to component to variant without inventing unknown metadata', () => {
  const catalog = selectorCatalog();

  assert.deepEqual(
    listCatalogManufacturers(catalog).map((manufacturer) => manufacturer.id),
    ['sin', 'neodent'],
  );
  assert.deepEqual(
    listCatalogSystems(catalog, 'sin').map((system) => system.id),
    ['sin-cm', 'sin-he'],
  );
  assert.deepEqual(
    listCatalogComponents(catalog, 'sin-cm').map((component) => component.id),
    ['sin-interface'],
  );

  const variants = listCatalogVariants(catalog, 'sin-interface');
  assert.equal(variants.length, 1);
  assert.equal(variants[0].id, 'sin-interface-standard');
  assert.equal(variants[0].attributes.heightMm, null);
  assert.equal(variants[0].attributes.sizeClass, null);
  assert.equal(variants[0].sourceAttributes.sourceToken, 'UNKNOWN');

  assert.equal(getVariantGeometryAssets(catalog, 'sin-interface-standard').length, 2);
});

test('unknown selector ids return empty arrays', () => {
  const catalog = selectorCatalog();
  assert.deepEqual(listCatalogSystems(catalog, 'missing-manufacturer'), []);
  assert.deepEqual(listCatalogComponents(catalog, 'missing-system'), []);
  assert.deepEqual(listCatalogVariants(catalog, 'missing-component'), []);
  assert.deepEqual(getVariantGeometryAssets(catalog, 'missing-variant'), []);
});

test('resolved-only variant geometry returns only assets with a resolved package path', () => {
  const catalog = selectorCatalog();
  const assets = getVariantGeometryAssets(
    catalog,
    'sin-interface-standard',
    { resolvedOnly: true },
  );

  assert.equal(assets.length, 1);
  assert.equal(assets[0].id, 'sin-resolved');
  assert.equal(assets[0].resolution, 'resolved');
  assert.equal(assets[0].matchedPath, 'implant/SIN/SIN-SUPPORT.STL');
});
