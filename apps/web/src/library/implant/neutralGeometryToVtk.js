import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData.js';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points.js';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray.js';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray.js';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper.js';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor.js';
import {
  IDENTITY_MATRIX_4X4,
  ImplantGeometryError,
  validateNeutralGeometry,
} from './geometrySchema.js';
import { transformGeometry } from './transformGeometry.js';

export function createVtkPolyDataFromNeutralGeometry(mesh) {
  const validation = validateNeutralGeometry(mesh);
  if (!validation.valid) {
    throw new ImplantGeometryError(
      'INVALID_GEOMETRY_VALUE',
      'Neutral mesh must be valid before creating VTK geometry.',
      validation.errors,
    );
  }

  const poly = vtkPolyData.newInstance();
  const points = vtkPoints.newInstance();
  points.setData(new Float32Array(mesh.positions), 3);
  poly.setPoints(points);

  const cells = new Uint32Array(mesh.triangleCount * 4);
  for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) {
    const cellOffset = triangle * 4;
    const indexOffset = triangle * 3;
    cells[cellOffset] = 3;
    cells[cellOffset + 1] = mesh.indices[indexOffset];
    cells[cellOffset + 2] = mesh.indices[indexOffset + 1];
    cells[cellOffset + 3] = mesh.indices[indexOffset + 2];
  }
  const polys = vtkCellArray.newInstance({ values: cells });
  poly.setPolys(polys);

  const normals = vtkDataArray.newInstance({
    name: 'Normals',
    numberOfComponents: 3,
    values: new Float32Array(mesh.normals),
  });
  poly.getPointData().setNormals(normals);

  return { poly, points, polys, normals };
}

export function createVtkImplantGeometryBundle({
  mesh,
  localTransform = IDENTITY_MATRIX_4X4,
  active = false,
} = {}) {
  const calibrated = transformGeometry(mesh, localTransform);
  const geometry = createVtkPolyDataFromNeutralGeometry(calibrated);
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(geometry.poly);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);

  const prop = actor.getProperty();
  prop.setColor(...(active ? [0.04, 1, 0.86] : [0.96, 0.75, 0.30]));
  prop.setOpacity(1);
  prop.setAmbient(active ? 0.92 : 0.72);
  prop.setDiffuse(active ? 0.46 : 0.58);
  prop.setSpecular(0.92);
  prop.setSpecularPower(54);
  prop.setEdgeVisibility?.(active);
  if (active) prop.setEdgeColor?.(0.72, 1, 0.96);

  return {
    mode: 'mesh',
    actor,
    mapper,
    ...geometry,
    calibrated,
    localTransform: [...localTransform],
    disposed: false,
  };
}

export function disposeVtkImplantGeometryBundle(bundle) {
  if (!bundle || bundle.disposed) return;
  bundle.disposed = true;
  bundle.actor?.delete?.();
  bundle.mapper?.delete?.();
  bundle.normals?.delete?.();
  bundle.polys?.delete?.();
  bundle.points?.delete?.();
  bundle.poly?.delete?.();
}
