import { ImplantGeometryError } from './geometrySchema.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactBytes(sourceBytes) {
  if (sourceBytes instanceof ArrayBuffer) return new Uint8Array(sourceBytes);
  if (ArrayBuffer.isView(sourceBytes)) {
    return new Uint8Array(sourceBytes.buffer, sourceBytes.byteOffset, sourceBytes.byteLength);
  }
  return null;
}

export function loadStlGeometry(asset, sourceBytes) {
  if (
    !asset
    || typeof asset !== 'object'
    || asset.resolution !== 'resolved'
    || !isNonEmptyString(asset.matchedPath)
  ) {
    throw new ImplantGeometryError(
      'UNRESOLVED_GEOMETRY',
      'Geometry asset must be resolved to one package path before loading.',
    );
  }

  const path = asset.matchedPath.trim();
  if (!path.toLowerCase().endsWith('.stl')) {
    throw new ImplantGeometryError(
      'UNSUPPORTED_GEOMETRY_FORMAT',
      'Milestone 3 supports STL geometry only.',
      [path],
    );
  }

  const bytes = exactBytes(sourceBytes);
  if (!bytes || bytes.byteLength === 0) {
    throw new ImplantGeometryError('INVALID_STL', 'STL source bytes are empty or invalid.');
  }

  throw new ImplantGeometryError('INVALID_STL', 'STL source is not structurally valid.');
}
