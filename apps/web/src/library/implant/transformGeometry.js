import {
  IDENTITY_MATRIX_4X4,
  ImplantGeometryError,
  validateNeutralGeometry,
} from './geometrySchema.js';

const EPSILON = 1e-12;

function validatedMatrix(matrix4x4) {
  const matrix = matrix4x4 ?? IDENTITY_MATRIX_4X4;
  if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
    throw new ImplantGeometryError(
      'INVALID_TRANSFORM',
      'Geometry transform must contain exactly 16 finite numbers.',
    );
  }
  return [...matrix];
}

function computeBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

function transformNormals(normals, matrix) {
  const output = new Float32Array(normals.length);
  for (let offset = 0; offset < normals.length; offset += 3) {
    const x = normals[offset];
    const y = normals[offset + 1];
    const z = normals[offset + 2];
    const nx = matrix[0] * x + matrix[4] * y + matrix[8] * z;
    const ny = matrix[1] * x + matrix[5] * y + matrix[9] * z;
    const nz = matrix[2] * x + matrix[6] * y + matrix[10] * z;
    const length = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(length) || length <= EPSILON) {
      throw new ImplantGeometryError('INVALID_TRANSFORM', 'Geometry transform collapses a normal vector.');
    }
    output[offset] = nx / length;
    output[offset + 1] = ny / length;
    output[offset + 2] = nz / length;
  }
  return output;
}

export function transformGeometry(mesh, matrix4x4 = IDENTITY_MATRIX_4X4) {
  const validation = validateNeutralGeometry(mesh);
  if (!validation.valid) {
    throw new ImplantGeometryError(
      'INVALID_GEOMETRY_VALUE',
      'Geometry must satisfy the neutral mesh contract before transformation.',
      validation.errors,
    );
  }

  const matrix = validatedMatrix(matrix4x4);
  const positions = new Float32Array(mesh.positions.length);

  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    const x = mesh.positions[offset];
    const y = mesh.positions[offset + 1];
    const z = mesh.positions[offset + 2];
    positions[offset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    positions[offset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    positions[offset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }

  return {
    ...mesh,
    source: structuredClone(mesh.source),
    safety: structuredClone(mesh.safety),
    positions,
    normals: transformNormals(mesh.normals, matrix),
    indices: new Uint32Array(mesh.indices),
    bounds: computeBounds(positions),
    transform: { matrix },
  };
}
