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

function inverseTranspose3x3(matrix) {
  const a00 = matrix[0], a01 = matrix[4], a02 = matrix[8];
  const a10 = matrix[1], a11 = matrix[5], a12 = matrix[9];
  const a20 = matrix[2], a21 = matrix[6], a22 = matrix[10];

  const determinant = a00 * (a11 * a22 - a12 * a21)
    - a01 * (a10 * a22 - a12 * a20)
    + a02 * (a10 * a21 - a11 * a20);

  if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON) {
    throw new ImplantGeometryError(
      'INVALID_TRANSFORM',
      'Geometry transform has a singular linear component and cannot transform normals.',
    );
  }

  const inverse = [
    (a11 * a22 - a12 * a21) / determinant,
    (a02 * a21 - a01 * a22) / determinant,
    (a01 * a12 - a02 * a11) / determinant,
    (a12 * a20 - a10 * a22) / determinant,
    (a00 * a22 - a02 * a20) / determinant,
    (a02 * a10 - a00 * a12) / determinant,
    (a10 * a21 - a11 * a20) / determinant,
    (a01 * a20 - a00 * a21) / determinant,
    (a00 * a11 - a01 * a10) / determinant,
  ];

  return [
    inverse[0], inverse[3], inverse[6],
    inverse[1], inverse[4], inverse[7],
    inverse[2], inverse[5], inverse[8],
  ];
}

function transformNormals(normals, matrix) {
  const normalMatrix = inverseTranspose3x3(matrix);
  const output = new Float32Array(normals.length);

  for (let offset = 0; offset < normals.length; offset += 3) {
    const x = normals[offset];
    const y = normals[offset + 1];
    const z = normals[offset + 2];
    const nx = normalMatrix[0] * x + normalMatrix[1] * y + normalMatrix[2] * z;
    const ny = normalMatrix[3] * x + normalMatrix[4] * y + normalMatrix[5] * z;
    const nz = normalMatrix[6] * x + normalMatrix[7] * y + normalMatrix[8] * z;
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
