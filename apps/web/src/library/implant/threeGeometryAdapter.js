import * as THREE from 'three';
import { ImplantGeometryError, validateNeutralGeometry } from './geometrySchema.js';

export function createThreeBufferGeometry(mesh) {
  const validation = validateNeutralGeometry(mesh);
  if (!validation.valid) {
    throw new ImplantGeometryError(
      'INVALID_GEOMETRY_VALUE',
      'Neutral mesh must be valid before creating Three.js geometry.',
      validation.errors,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.positions), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(mesh.normals), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
