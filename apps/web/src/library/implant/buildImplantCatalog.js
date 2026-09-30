import {
  IMPLANT_CATALOG_SCHEMA_VERSION,
  ImplantCatalogValidationError,
  validateImplantCatalog,
} from './catalogSchema.js';

function normalizePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value ?? '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function libraryIdentity(entry) {
  const manufacturer = entry?.library?.manufacturer?.name ?? '';
  const system = entry?.library?.system?.name ?? '';
  const sourcePath = normalizePath(entry?.path);
  return `${manufacturer}\u0000${system}\u0000${sourcePath}`;
}

function clone(value) {
  return structuredClone(value);
}

function resolutionKey(role, reference) {
  return `${String(role ?? '').toLowerCase()}\u0000${normalizePath(reference).toLowerCase()}`;
}

function geometryResolutionIndex(entry) {
  const index = new Map();
  for (const bucket of ['resolved', 'missing', 'ambiguous']) {
    for (const item of entry?.geometry?.[bucket] ?? []) {
      const key = resolutionKey(item?.role, item?.reference);
      if (!index.has(key)) index.set(key, item);
    }
  }
  return index;
}

function enrichGeometryMap(geometry, resolutionIndex) {
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) return;

  for (const [geometryRole, asset] of Object.entries(geometry)) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) continue;
    const role = asset.role ?? geometryRole;
    const resolution = resolutionIndex.get(resolutionKey(role, asset.filename));
    if (!resolution) continue;

    asset.reference = resolution.reference ?? asset.filename;
    asset.resolution = resolution.resolution;

    if (resolution.resolution === 'resolved') {
      asset.matchedPath = resolution.matchedPath;
      delete asset.candidates;
    } else if (resolution.resolution === 'ambiguous') {
      asset.candidates = clone(resolution.candidates ?? []);
      delete asset.matchedPath;
    } else {
      delete asset.matchedPath;
      delete asset.candidates;
    }
  }
}

function enrichLibraryGeometry(library, entry) {
  const resolutionIndex = geometryResolutionIndex(entry);
  enrichGeometryMap(library.geometry, resolutionIndex);

  for (const component of library.components ?? []) {
    enrichGeometryMap(component?.geometry, resolutionIndex);
    for (const variant of component?.variants ?? []) {
      enrichGeometryMap(variant?.geometry, resolutionIndex);
    }
  }
}

function catalogLibrary(entry) {
  const library = clone(entry.library);
  enrichLibraryGeometry(library, entry);

  return {
    ...library,
    id: `implant-library-${stableHash(libraryIdentity(entry))}`,
    sourcePath: normalizePath(entry.path),
    warnings: clone(entry.warnings ?? []),
    provenance: {
      sourcePath: normalizePath(entry.path),
    },
  };
}

function diagnosticEntry(entry) {
  return clone(entry);
}

function catalogWarnings(importedEntries) {
  return importedEntries.flatMap((entry) =>
    (entry.warnings ?? []).map((warning) => ({
      sourcePath: normalizePath(entry.path),
      warning: clone(warning),
    })),
  );
}

export function buildImplantCatalog(auditReport, { sourceName = null } = {}) {
  const entries = Array.isArray(auditReport?.entries) ? auditReport.entries : [];
  const importedEntries = entries.filter((entry) => entry?.status === 'imported');

  const catalog = {
    catalogSchemaVersion: IMPLANT_CATALOG_SCHEMA_VERSION,
    source: {
      kind: 'implant-library-bundle',
      name: sourceName,
    },
    summary: clone(auditReport?.summary ?? {}),
    libraries: importedEntries.map(catalogLibrary),
    diagnostics: {
      unsupportedEntries: entries.filter((entry) => entry?.status === 'unsupported').map(diagnosticEntry),
      invalidEntries: entries.filter((entry) => entry?.status === 'invalid').map(diagnosticEntry),
      warnings: catalogWarnings(importedEntries),
    },
  };

  const validation = validateImplantCatalog(catalog);
  if (!validation.valid) {
    throw new ImplantCatalogValidationError(
      'Built implant catalog does not satisfy OdontoView catalog schema v1',
      validation.errors,
    );
  }

  return catalog;
}
