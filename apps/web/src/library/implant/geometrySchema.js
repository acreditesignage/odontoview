export const IMPLANT_GEOMETRY_SCHEMA_VERSION = 1;

export const IDENTITY_MATRIX_4X4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

const REDISTRIBUTION_VALUES = ['unknown', 'allowed', 'not-allowed'];
const STL_FORMATS = ['stl-ascii', 'stl-binary'];

export class ImplantGeometryError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'ImplantGeometryError';
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyFiniteValues(values) {
  return values != null && Array.from(values).every(Number.isFinite);
}

function validateBounds(mesh, errors) {
  if (!isObject(mesh.bounds) || !Array.isArray(mesh.bounds.min) || !Array.isArray(mesh.bounds.max)) {
    errors.push('bounds must contain min and max arrays');
    return;
  }

  const { min, max } = mesh.bounds;
  if (min.length !== 3 || max.length !== 3 || !hasOnlyFiniteValues(min) || !hasOnlyFiniteValues(max)) {
    errors.push('bounds min and max must contain exactly three finite numbers');
    return;
  }

  if (min.some((value, axis) => value > max[axis])) {
    errors.push('bounds min values must not exceed max values');
    return;
  }

  if (!(mesh.positions instanceof Float32Array)) return;
  for (let offset = 0; offset + 2 < mesh.positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[offset + axis];
      if (value < min[axis] || value > max[axis]) {
        errors.push('bounds must enclose all vertex positions');
        return;
      }
    }
  }
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

  if (!(mesh.positions instanceof Float32Array)) {
    errors.push('positions must be a Float32Array');
  } else if (!hasOnlyFiniteValues(mesh.positions)) {
    errors.push('positions must contain only finite numbers');
  }

  if (!(mesh.normals instanceof Float32Array)) {
    errors.push('normals must be a Float32Array');
  } else if (!hasOnlyFiniteValues(mesh.normals)) {
    errors.push('normals must contain only finite numbers');
  }

  if (!(mesh.indices instanceof Uint32Array)) errors.push('indices must be a Uint32Array');

  if (!Number.isInteger(mesh.vertexCount) || mesh.vertexCount < 0) {
    errors.push('vertexCount must be a non-negative integer');
  }
  if (!Number.isInteger(mesh.triangleCount) || mesh.triangleCount <= 0) {
    errors.push('triangleCount must be a positive integer');
  }

  if (mesh.positions instanceof Float32Array && Number.isInteger(mesh.vertexCount)) {
    if (mesh.positions.length !== mesh.vertexCount * 3) {
      errors.push('positions.length must equal vertexCount * 3');
    }
  }
  if (mesh.normals instanceof Float32Array && Number.isInteger(mesh.vertexCount)) {
    if (mesh.normals.length !== mesh.vertexCount * 3) {
      errors.push('normals.length must equal vertexCount * 3');
    }
  }
  if (mesh.indices instanceof Uint32Array && Number.isInteger(mesh.triangleCount)) {
    if (mesh.indices.length !== mesh.triangleCount * 3) {
      errors.push('indices.length must equal triangleCount * 3');
    }
  }

  if (mesh.indices instanceof Uint32Array && Number.isInteger(mesh.vertexCount) && mesh.vertexCount >= 0) {
    if (Array.from(mesh.indices).some((index) => index >= mesh.vertexCount)) {
      errors.push('every index must reference an existing vertex');
    }
  }

  validateBounds(mesh, errors);

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
