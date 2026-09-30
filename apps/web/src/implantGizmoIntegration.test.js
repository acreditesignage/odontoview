import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const panel = readFileSync(new URL('./Viewer3DPanel.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('viewer3d mounts the visual implant transform gizmo on active implant',()=>{
  assert.match(panel,/import ImplantTransformGizmo/);
  assert.match(panel,/activeImplant&&<ImplantTransformGizmo/);
  assert.match(panel,/onChange={updateActiveImplant}/);
});

test('vtk stage pointer capture yields to the gizmo',()=>{
  assert.match(panel,/closest\?\.\("\[data-implant-gizmo\]"\)/);
});

test('legacy numeric transform controls are secondary precision details',()=>{
  assert.match(panel,/viewer3d-implant-precision/);
  assert.match(panel,/Ajuste numérico de precisão/);
});

test('gizmo has dedicated workstation styling',()=>{
  assert.match(css,/\.viewer3d-implant-gizmo/);
  assert.match(css,/\.viewer3d-gizmo-head/);
  assert.match(css,/\.viewer3d-gizmo-axis/);
});
