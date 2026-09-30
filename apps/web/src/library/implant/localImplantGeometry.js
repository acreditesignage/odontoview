import { ImplantGeometryError } from './geometrySchema.js';
import { loadStlGeometry } from './loadStlGeometry.js';
import { registerImplantGeometry } from './implantGeometryRegistry.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateGeometryKey(geometryKey) {
  if (!isNonEmptyString(geometryKey)) {
    throw new ImplantGeometryError('INVALID_GEOMETRY_VALUE', 'geometryKey must be a non-empty string.');
  }
  return geometryKey.trim();
}

function validateStlFilename(filename) {
  if (!isNonEmptyString(filename)) {
    throw new ImplantGeometryError('INVALID_GEOMETRY_VALUE', 'Local geometry filename must be a non-empty string.');
  }
  const normalized = filename.trim();
  if (!/\.stl$/i.test(normalized)) {
    throw new ImplantGeometryError('UNSUPPORTED_GEOMETRY_FORMAT', 'Local implant geometry must use the .stl extension.');
  }
  return normalized;
}

function geometryDiagnostics(mesh) {
  const min = [...mesh.bounds.min];
  const max = [...mesh.bounds.max];
  return {
    format: mesh.source.format,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    bounds: { min, max },
    extents: max.map((value, axis) => value - min[axis]),
    center: max.map((value, axis) => (value + min[axis]) / 2),
    unitStatus: 'unknown',
  };
}

export function makeLocalImplantGeometryKey({ implantId } = {}) {
  if (!isNonEmptyString(implantId)) {
    throw new ImplantGeometryError('INVALID_GEOMETRY_VALUE', 'implantId must be a non-empty string.');
  }
  return `local:implant:${implantId.trim()}`;
}

export function loadLocalImplantGeometry({ geometryKey, filename, bytes } = {}) {
  const normalizedKey = validateGeometryKey(geometryKey);
  const normalizedFilename = validateStlFilename(filename);
  const asset = {
    id: normalizedKey,
    role: 'implant',
    filename: normalizedFilename,
    reference: normalizedFilename,
    resolution: 'resolved',
    matchedPath: `local/${normalizedKey}/${normalizedFilename}`,
    validatedGeometry: false,
    redistributionAllowed: 'unknown',
  };
  const mesh = loadStlGeometry(asset, bytes);
  const diagnostics = geometryDiagnostics(mesh);
  const metadata = {
    safety: {
      validatedGeometry: false,
      redistributionAllowed: 'unknown',
    },
    provenance: {
      sourceKind: 'local-file',
      filename: normalizedFilename,
    },
    unitStatus: 'unknown',
  };
  return { geometryKey: normalizedKey, mesh, diagnostics, metadata };
}

export function registerLocalImplantGeometry(args = {}) {
  const loaded = loadLocalImplantGeometry(args);
  const entry = registerImplantGeometry({
    geometryKey: loaded.geometryKey,
    mesh: loaded.mesh,
    metadata: {
      ...loaded.metadata,
      diagnostics: structuredClone(loaded.diagnostics),
    },
  });
  return {
    ...entry,
    diagnostics: loaded.diagnostics,
  };
}
