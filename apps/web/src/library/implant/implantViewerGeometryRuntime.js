import { IDENTITY_MATRIX_4X4 } from './geometrySchema.js';
import { getImplantGeometry } from './implantGeometryRegistry.js';
import { transformGeometry } from './transformGeometry.js';

function localTransform(implant) {
  return implant?.geometryLocalTransform ?? IDENTITY_MATRIX_4X4;
}

function parametricSignature(implant) {
  return `parametric:${Number(implant?.diameter) || 0}:${Number(implant?.length) || 0}`;
}

export function implantGeometrySignature(implant, entry) {
  const matrix = localTransform(implant);
  const key = String(implant?.geometryKey || '');
  const revision = Number(entry?.revision) || 0;
  return `mesh:${key}:${revision}:${matrix.join(',')}`;
}

export function resolveImplantGeometryRuntime(implant) {
  const matrix = localTransform(implant);
  if (!implant?.geometryKey) {
    return {
      mode: 'parametric',
      entry: null,
      localTransform: [...IDENTITY_MATRIX_4X4],
      signature: parametricSignature(implant),
      diagnostic: null,
    };
  }

  const entry = getImplantGeometry(implant.geometryKey);
  if (!entry) {
    return {
      mode: 'parametric',
      entry: null,
      localTransform: Array.isArray(matrix) ? [...matrix] : matrix,
      signature: parametricSignature(implant),
      diagnostic: {
        code: 'GEOMETRY_NOT_REGISTERED',
        message: 'Implant geometry is not available in the current runtime registry.',
      },
    };
  }

  try {
    transformGeometry(entry.mesh, matrix);
  } catch (error) {
    return {
      mode: 'parametric',
      entry,
      localTransform: Array.isArray(matrix) ? [...matrix] : matrix,
      signature: parametricSignature(implant),
      diagnostic: {
        code: error?.code || 'INVALID_GEOMETRY_VALUE',
        message: error?.message || 'Implant geometry cannot be rendered safely.',
      },
    };
  }

  return {
    mode: 'mesh',
    entry,
    localTransform: [...matrix],
    signature: implantGeometrySignature(implant, entry),
    diagnostic: null,
  };
}
