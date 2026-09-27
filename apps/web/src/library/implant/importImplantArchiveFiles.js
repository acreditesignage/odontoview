import { auditImplantLibraryBundle } from './auditImplantLibraryBundle.js';
import { buildImplantCatalog } from './buildImplantCatalog.js';

function normalizePath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
}

function foldedPath(value) {
  return normalizePath(value).toLowerCase();
}

function archiveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readText(file) {
  if (typeof file?.text === 'function') return file.text();
  if (typeof file?.arrayBuffer !== 'function') {
    throw archiveError('INVALID_ARCHIVE_FILE', 'Arquivo extraído não pode ser lido.');
  }
  return new TextDecoder().decode(await file.arrayBuffer());
}

function geometryAssets(geometry) {
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) return [];
  return Object.entries(geometry)
    .filter(([, asset]) => asset && typeof asset === 'object' && !Array.isArray(asset))
    .map(([geometryRole, asset]) => ({ geometryRole, asset }));
}

function stlAsset(asset) {
  const path = asset?.matchedPath || asset?.filename || '';
  return asset?.resolution === 'resolved'
    && typeof asset?.matchedPath === 'string'
    && asset.matchedPath.length > 0
    && /\.stl$/i.test(path);
}

function renderableItem({ library, component = null, variant = null, geometryRole, asset }) {
  const role = asset.role ?? geometryRole ?? null;
  const path = normalizePath(asset.matchedPath);
  const identity = [library.id, component?.id ?? '', variant?.id ?? '', role ?? '', foldedPath(path)].join('|');
  return {
    id: identity,
    format: 'stl',
    matchedPath: path,
    reference: asset.reference ?? asset.filename ?? path,
    filename: asset.filename ?? path.split('/').pop() ?? path,
    role,
    manufacturerId: library.manufacturer?.id ?? null,
    manufacturerName: library.manufacturer?.name ?? null,
    systemId: library.system?.id ?? null,
    systemName: library.system?.name ?? null,
    libraryId: library.id,
    componentId: component?.id ?? null,
    componentLabel: component?.name ?? null,
    componentRole: component?.role ?? null,
    variantId: variant?.id ?? null,
    variantLabel: variant?.name ?? null,
    attributes: variant?.attributes ? structuredClone(variant.attributes) : null,
    validatedGeometry: asset.validatedGeometry === true,
    redistributionAllowed: asset.redistributionAllowed ?? 'unknown',
    sourceSignature: asset.sourceSignature ?? null,
  };
}

export async function importImplantArchiveFiles(files, { sourceName = null } = {}) {
  const incoming = Array.from(files ?? []);
  const availableFiles = [];
  const filesByPath = new Map();
  const entries = [];

  for (const file of incoming) {
    const path = normalizePath(file?.name);
    if (!path) continue;
    availableFiles.push(path);
    filesByPath.set(foldedPath(path), { path, file });
    if (/(^|\/)config\.xml$/i.test(path)) {
      entries.push({ path, xmlText: await readText(file) });
    }
  }

  if (!entries.length) {
    throw archiveError(
      'NO_IMPLANT_LIBRARY_CONFIG',
      'Nenhum config.xml de biblioteca de implantes foi encontrado.',
    );
  }

  const audit = auditImplantLibraryBundle({ entries, availableFiles });
  const catalog = buildImplantCatalog(audit, { sourceName });
  return { audit, catalog, filesByPath };
}

export function listRenderableImplantGeometry(catalog) {
  const out = [];
  for (const library of catalog?.libraries ?? []) {
    for (const { geometryRole, asset } of geometryAssets(library.geometry)) {
      if (stlAsset(asset)) out.push(renderableItem({ library, geometryRole, asset }));
    }
    for (const component of library.components ?? []) {
      for (const { geometryRole, asset } of geometryAssets(component.geometry)) {
        if (stlAsset(asset)) out.push(renderableItem({ library, component, geometryRole, asset }));
      }
      for (const variant of component.variants ?? []) {
        for (const { geometryRole, asset } of geometryAssets(variant.geometry)) {
          if (stlAsset(asset)) out.push(renderableItem({ library, component, variant, geometryRole, asset }));
        }
      }
    }
  }
  return out;
}

export async function readArchiveGeometryBytes(filesByPath, matchedPath) {
  const entry = filesByPath?.get?.(foldedPath(matchedPath));
  if (!entry?.file || typeof entry.file.arrayBuffer !== 'function') {
    throw archiveError(
      'ARCHIVE_GEOMETRY_NOT_FOUND',
      `Geometria não encontrada no arquivo compactado: ${normalizePath(matchedPath)}`,
    );
  }
  return entry.file.arrayBuffer();
}
