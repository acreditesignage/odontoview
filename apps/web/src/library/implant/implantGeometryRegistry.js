import { ImplantGeometryError, validateNeutralGeometry } from './geometrySchema.js';

const registry = new Map();
const revisions = new Map();

function validKey(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneMetadata(metadata) {
  if (metadata == null) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new ImplantGeometryError('INVALID_GEOMETRY_VALUE', 'Geometry registry metadata must be an object.');
  }
  return structuredClone(metadata);
}

export function registerImplantGeometry({ geometryKey, mesh, metadata = {} } = {}) {
  if (!validKey(geometryKey)) {
    throw new ImplantGeometryError('INVALID_GEOMETRY_VALUE', 'geometryKey must be a non-empty string.');
  }
  const validation = validateNeutralGeometry(mesh);
  if (!validation.valid) {
    throw new ImplantGeometryError(
      'INVALID_GEOMETRY_VALUE',
      'Geometry registry accepts only valid neutral meshes.',
      validation.errors,
    );
  }

  const normalizedKey = geometryKey.trim();
  const revision = (revisions.get(normalizedKey) || 0) + 1;
  const entry = {
    geometryKey: normalizedKey,
    mesh,
    metadata: cloneMetadata(metadata),
    revision,
  };
  registry.set(normalizedKey, entry);
  revisions.set(normalizedKey, revision);
  return entry;
}

export function getImplantGeometry(geometryKey) {
  if (!validKey(geometryKey)) return null;
  return registry.get(geometryKey.trim()) || null;
}

export function unregisterImplantGeometry(geometryKey) {
  if (!validKey(geometryKey)) return false;
  return registry.delete(geometryKey.trim());
}

export function clearImplantGeometryRegistry() {
  registry.clear();
  revisions.clear();
}
