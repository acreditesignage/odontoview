import { importImplantLibraryXml } from './index.js';

function normalizePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
}

function dirname(path) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function basename(path) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function geometryAssets(geometry) {
  return Object.values(geometry ?? {}).filter(
    (asset) => asset && typeof asset === 'object' && typeof asset.filename === 'string' && asset.filename.length > 0,
  );
}

function collectGeometryReferences(library) {
  const assets = [...geometryAssets(library?.geometry)];
  for (const component of library?.components ?? []) {
    assets.push(...geometryAssets(component?.geometry));
    for (const variant of component?.variants ?? []) {
      assets.push(...geometryAssets(variant?.geometry));
    }
  }
  return assets.map((asset) => ({
    reference: asset.filename,
    role: asset.role ?? null,
  }));
}

function resolveGeometry(reference, entryPath, availableFiles) {
  const normalizedReference = normalizePath(reference.reference);
  const entryDirectory = dirname(entryPath);
  const localPath = normalizePath(entryDirectory ? `${entryDirectory}/${normalizedReference}` : normalizedReference);

  if (availableFiles.includes(localPath)) {
    return { ...reference, matchedPath: localPath, resolution: 'resolved' };
  }

  if (availableFiles.includes(normalizedReference)) {
    return { ...reference, matchedPath: normalizedReference, resolution: 'resolved' };
  }

  const referenceBasename = basename(normalizedReference);
  const basenameMatches = availableFiles.filter((path) => basename(path) === referenceBasename);
  if (basenameMatches.length === 1) {
    return { ...reference, matchedPath: basenameMatches[0], resolution: 'resolved' };
  }
  if (basenameMatches.length > 1) {
    return { ...reference, candidates: basenameMatches, resolution: 'ambiguous' };
  }
  return { ...reference, resolution: 'missing' };
}

function geometryReport(library, entryPath, availableFiles) {
  const references = collectGeometryReferences(library);
  const resolved = [];
  const missing = [];
  const ambiguous = [];

  for (const reference of references) {
    const result = resolveGeometry(reference, entryPath, availableFiles);
    if (result.resolution === 'resolved') resolved.push(result);
    else if (result.resolution === 'ambiguous') ambiguous.push(result);
    else missing.push(result);
  }

  return { references, resolved, missing, ambiguous };
}

function importedEntry(entry, availableFiles) {
  const imported = importImplantLibraryXml(entry.xmlText);
  return {
    path: normalizePath(entry.path),
    status: 'imported',
    library: imported.library,
    warnings: imported.warnings,
    geometry: geometryReport(imported.library, entry.path, availableFiles),
  };
}

function failedEntry(entry, error) {
  return {
    path: normalizePath(entry.path),
    status: error?.code === 'UNSUPPORTED_ROOT' ? 'unsupported' : 'invalid',
    error: {
      code: error?.code ?? 'IMPORT_FAILED',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

export function auditImplantLibraryBundle({ entries = [], availableFiles = [] } = {}) {
  const normalizedFiles = availableFiles.map(normalizePath).filter(Boolean);
  const auditedEntries = entries.map((entry) => {
    try {
      return importedEntry(entry, normalizedFiles);
    } catch (error) {
      return failedEntry(entry, error);
    }
  });

  const importedEntries = auditedEntries.filter((entry) => entry.status === 'imported');
  const summary = {
    totalEntries: auditedEntries.length,
    importedEntries: importedEntries.length,
    unsupportedEntries: auditedEntries.filter((entry) => entry.status === 'unsupported').length,
    invalidEntries: auditedEntries.filter((entry) => entry.status === 'invalid').length,
    components: importedEntries.reduce((total, entry) => total + (entry.library?.components?.length ?? 0), 0),
    variants: importedEntries.reduce(
      (total, entry) => total + (entry.library?.components ?? []).reduce(
        (componentTotal, component) => componentTotal + (component?.variants?.length ?? 0),
        0,
      ),
      0,
    ),
    warnings: importedEntries.reduce((total, entry) => total + (entry.warnings?.length ?? 0), 0),
    geometryReferences: importedEntries.reduce((total, entry) => total + entry.geometry.references.length, 0),
    resolvedGeometryFiles: importedEntries.reduce((total, entry) => total + entry.geometry.resolved.length, 0),
    missingGeometryFiles: importedEntries.reduce((total, entry) => total + entry.geometry.missing.length, 0),
    ambiguousGeometryFiles: importedEntries.reduce((total, entry) => total + entry.geometry.ambiguous.length, 0),
  };

  return { summary, entries: auditedEntries };
}
