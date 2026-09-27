export const IMPLANT_GEOMETRY_SCHEMA_VERSION = 1;

const REDISTRIBUTION_VALUES = ['unknown', 'allowed', 'not-allowed'];
const STL_FORMATS = ['stl-ascii', 'stl-binary'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateNeutralGeometry(mesh) {
  const errors = [];

  if (!isObject(mesh)) return { valid: false, errors: ['mesh must be an object'] };

  if (mesh.geometrySchemaVersion !== IMPLANT_GEOMETRY_SCHEMA_VERSION) {
    errors.push(`geometrySchemaVersion must be ${IMPLANT_GEOMETRY_SCHEMA_VERSION}`);
  }

  if (!isObject(mesh.source)) {
    errors.push('source must be an object');
  } else {
    if (!isNonEmptyString(mesh.source.assetId)) errors.push('source.assetId must be a non-empty string');
    if (!isNonEmptyString(mesh.source.sourcePath)) errors.push('source.sourcePath must be a non-empty string');
    if (!isNonEmptyString(mesh.source.filename)) errors.push('source.filename must be a non-empty string');
    if (!STL_FORMATS.includes(mesh.source.format)) errors.push('source.format must be stl-ascii or stl-binary');
  }

  if (!(mesh.positions instanceof Float32Array)) errors.push('positions must be a Float32Array');
  if (!(mesh.normals instanceof Float32Array)) errors.push('normals must be a Float32Array');
  if (!(mesh.indices instanceof Uint32Array)) errors.push('indices must be a Uint32Array');

  if (!Number.isInteger(mesh.vertexCount) || mesh.vertexCount < 0) errors.push('vertexCount must be a non-negative integer');
  if (!Number.isInteger(mesh.triangleCount) || mesh.triangleCount < 0) errors.push('triangleCount must be a non-negative integer');

  if (!isObject(mesh.bounds) || !Array.isArray(mesh.bounds.min) || !Array.isArray(mesh.bounds.max)) {
    errors.push('bounds must contain min and max arrays');
  }

  if (!isObject(mesh.safety)) {
    errors.push('safety must be an object');
  } else {
    if (typeof mesh.safety.validatedGeometry !== 'boolean') errors.push('safety.validatedGeometry must be boolean');
    if (!REDISTRIBUTION_VALUES.includes(mesh.safety.redistributionAllowed)) {
      errors.push('safety.redistributionAllowed must be unknown, allowed, or not-allowed');
    }
  }

  return { valid: errors.length === 0, errors };
}
