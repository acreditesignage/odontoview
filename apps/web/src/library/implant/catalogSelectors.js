function catalogLibraries(catalog) {
  return Array.isArray(catalog?.libraries) ? catalog.libraries : [];
}

function uniqueById(values) {
  const seen = new Set();
  const unique = [];

  for (const value of values) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || value.id.length === 0) continue;
    if (seen.has(value.id)) continue;
    seen.add(value.id);
    unique.push(value);
  }

  return unique;
}

function componentEntries(catalog) {
  return catalogLibraries(catalog).flatMap((library) =>
    Array.isArray(library?.components) ? library.components : [],
  );
}

function variantEntries(catalog) {
  return componentEntries(catalog).flatMap((component) =>
    Array.isArray(component?.variants) ? component.variants : [],
  );
}

function geometryAssets(geometry) {
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) return [];
  return Object.values(geometry).filter(
    (asset) => asset && typeof asset === 'object' && !Array.isArray(asset),
  );
}

export function listCatalogManufacturers(catalog) {
  return uniqueById(catalogLibraries(catalog).map((library) => library?.manufacturer));
}

export function listCatalogSystems(catalog, manufacturerId) {
  return uniqueById(
    catalogLibraries(catalog)
      .filter((library) => library?.manufacturer?.id === manufacturerId)
      .map((library) => library?.system),
  );
}

export function listCatalogComponents(catalog, systemId) {
  return uniqueById(
    catalogLibraries(catalog)
      .filter((library) => library?.system?.id === systemId)
      .flatMap((library) => (Array.isArray(library?.components) ? library.components : [])),
  );
}

export function listCatalogVariants(catalog, componentId) {
  return uniqueById(
    componentEntries(catalog)
      .filter((component) => component?.id === componentId)
      .flatMap((component) => (Array.isArray(component?.variants) ? component.variants : [])),
  );
}

export function getVariantGeometryAssets(catalog, variantId) {
  return variantEntries(catalog)
    .filter((variant) => variant?.id === variantId)
    .flatMap((variant) => geometryAssets(variant?.geometry));
}
