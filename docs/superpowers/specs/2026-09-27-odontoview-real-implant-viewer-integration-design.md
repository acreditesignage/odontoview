# OdontoView Milestone 4 — Real Implant Geometry in Viewer 3D

Date: 2026-09-27
Branch: `feat/entrega-1-odonto-view-network`
Status: Design specification pending written-spec approval

## 1. Purpose

Milestone 4 connects the already validated implant-geometry pipeline from Milestone 3 to the existing OdontoView clinical 3D viewer so an implant can use a real STL mesh instead of only the current parametric envelope.

The milestone succeeds when a real, user-authorized STL can be loaded locally, normalized through the existing geometry pipeline, attached to an implant plan, and rendered inside the existing VTK.js CBCT viewer while continuing to follow the implant's clinical position and rotation controls.

This milestone does **not** make any geometry clinically validated by itself. `validatedGeometry` remains `false` unless a separate validation process establishes otherwise.

## 2. Existing baseline

Milestone 3 already provides:

- generic STL loading for ASCII and Binary STL;
- a neutral geometry contract;
- deterministic geometry validation;
- explicit 4×4 transforms;
- provenance and safety metadata;
- a Three.js isolated geometry laboratory;
- visual smoke tests proving real WebGL rendering and camera interactions.

The current clinical viewer already provides:

- CBCT VTK.js volume rendering;
- implant planning state using `x`, `y`, `z`, `rx`, `ry`, `rz`, `diameter`, and `length`;
- parametric implant actors;
- active implant selection;
- placement and repositioning in the 3D scene;
- mandibular nerve overlay and implant/nerve clearance logic;
- actor lifecycle management.

Milestone 4 bridges those two existing subsystems instead of replacing either one.

## 3. Scope

### In scope

1. Load a user-authorized STL from the browser locally.
2. Pass that file through the existing `loadStlGeometry()` neutral pipeline.
3. Preserve safety metadata:
   - `validatedGeometry: false` by default;
   - `redistributionAllowed: 'unknown'` by default.
4. Compute and expose geometry diagnostics:
   - triangle count;
   - vertex count;
   - bounds;
   - extents X/Y/Z;
   - center;
   - source format;
   - source filename.
5. Keep geometry bytes and decoded neutral meshes outside the serializable implant-plan object.
6. Add a runtime geometry registry keyed by a stable local geometry key.
7. Add a VTK adapter that converts `NeutralMesh` into `vtkPolyData`/`vtkActor` input without reparsing STL in the viewer.
8. Allow an implant-plan object to reference geometry through metadata such as `geometryKey`, `geometryLocalTransform`, and safety/provenance fields.
9. Render the real geometry in the existing `Viewer3DPanel` when a registered real mesh exists.
10. Fall back to the existing parametric implant when real geometry is unavailable or invalid.
11. Apply local mesh calibration first, then clinical implant translation/rotation.
12. Keep existing XYZ and RX/RY/RZ placement controls as the source of clinical placement state.
13. Dispose removed/replaced VTK actors and geometry resources correctly.
14. Add automated tests and a visual smoke gate that proves a real geometry actor appears in the Viewer 3D path.

### Out of scope

1. Exact STL intersection overlays in axial/coronal/sagittal/tangential 2D slices.
2. Surgical-guide generation.
3. Automatic clinical validation of manufacturer geometry.
4. Automatic inference that STL units are millimetres.
5. Automatic inference of implant axis/origin from filenames.
6. SDFA decoding.
7. Uploading proprietary/commercial STL libraries to the public repository.
8. Persisting raw STL bytes in database records, PDF exports, localStorage, or implant JSON.
9. Deploying this milestone to production before the agreed verification gates pass.

## 4. Architectural decision

Use the existing neutral geometry pipeline as the single geometry source of truth.

Approved data flow:

```text
Local authorized STL
  -> temporary resolved asset descriptor
  -> loadStlGeometry()
  -> NeutralMesh
  -> explicit local geometry calibration transform
  -> runtime geometry registry
  -> VTK neutral-mesh adapter
  -> implant actor in Viewer3DPanel
  -> existing clinical x/y/z + rx/ry/rz transform
```

The Viewer must not bypass the neutral pipeline by feeding the same STL directly into `vtkSTLReader` for implant geometry. Existing STL/PLY readers for unrelated intraoral-scan fusion may remain unchanged.

Reasoning:

- parsing behavior stays identical between lab and Viewer;
- safety/provenance rules remain centralized;
- geometry validation is tested once;
- VTK becomes only a rendering adapter, not a second STL interpretation path;
- later storage or cloud delivery can replace the byte provider without rewriting clinical rendering.

## 5. Runtime geometry registry

Raw file bytes and large typed arrays must not live inside the serializable `implants` React state.

A runtime registry will hold neutral meshes in memory.

Conceptual API:

```js
registerImplantGeometry({ geometryKey, mesh, metadata })
getImplantGeometry(geometryKey)
unregisterImplantGeometry(geometryKey)
clearImplantGeometryRegistry()
```

Registry properties:

- memory-only in Milestone 4;
- deterministic key supplied by the importer/runtime session;
- no raw proprietary geometry committed to Git;
- clearing/replacing geometry disposes references cleanly;
- no assumption that geometry can be redistributed.

The implant-plan object may carry only lightweight references and calibration metadata, for example:

```js
{
  id,
  x, y, z,
  rx, ry, rz,
  diameter,
  length,
  geometryKey: 'local:session-...:asset-...',
  geometryMode: 'mesh',
  geometryLocalTransform: [...16],
  geometrySafety: {
    validatedGeometry: false,
    redistributionAllowed: 'unknown'
  },
  geometryProvenance: {
    sourceKind: 'local-file',
    filename: '...'
  }
}
```

No STL bytes or `Float32Array`/`Uint32Array` payloads are embedded in this object.

## 6. Local STL import

Milestone 4 adds a controlled local-import path for real STL validation.

Behavior:

1. User chooses a `.stl` file from the browser.
2. Browser reads it into memory only.
3. Code creates a temporary resolved asset descriptor with:
   - local filename;
   - local matched-path surrogate;
   - `resolution: 'resolved'`;
   - `validatedGeometry: false`;
   - `redistributionAllowed: 'unknown'`.
4. Existing `loadStlGeometry()` parses the bytes.
5. Diagnostics are calculated from the neutral mesh.
6. The mesh is registered under a runtime `geometryKey`.
7. The active/new implant references that key.
8. No network upload is required for the Milestone 4 validation flow.

Invalid, empty, malformed, unsupported, missing, or ambiguous geometry does not replace the current implant actor.

## 7. Units, scale, orientation, and origin

STL does not declare a universal physical unit. Therefore the system must not silently label STL coordinates as millimetres.

### Initial state

A freshly imported real STL has:

- unit status: `unknown`;
- clinical validation: false;
- identity local transform unless an explicit transform is supplied.

### Diagnostic calibration

The UI/lab integration should expose:

- raw bounds min/max;
- extents X/Y/Z;
- geometric center;
- known catalog diameter/length when available;
- current local transform.

The system may offer explicit calibration inputs, but no automatic scaling is accepted as clinical truth unless the rule is separately documented and validated.

### Transform order

Two transform layers remain separate:

1. **Geometry-local transform**
   - corrects source mesh orientation/origin/scale;
   - belongs to geometry calibration.

2. **Clinical implant transform**
   - `x/y/z` position;
   - `rx/ry/rz` orientation;
   - belongs to planning state.

Conceptually:

```text
source mesh
 -> geometryLocalTransform
 -> calibrated implant-local mesh
 -> clinical implant position/orientation
 -> Viewer world
```

Changing geometry calibration must not silently rewrite implant clinical coordinates.

## 8. VTK adapter

Add a focused adapter from the neutral geometry contract to VTK.

Responsibilities:

- convert neutral `positions` into `vtkPoints`;
- convert triangle indices into VTK polygon-cell representation;
- preserve neutral mesh immutability;
- create/render a surface actor through `vtkMapper` + `vtkActor`;
- avoid STL reparsing;
- make disposal straightforward;
- expose no clinical inference.

The adapter must be testable without requiring a live CBCT volume.

A likely module boundary is:

```text
library/implant/neutralGeometryToVtk.js
```

or an equivalently focused name chosen during implementation.

## 9. Viewer integration

`Viewer3DPanel` already manages a map of implant actors. Milestone 4 extends that actor lifecycle rather than creating a parallel render subsystem.

For each implant:

```text
if geometryKey resolves to a valid registered NeutralMesh:
    build/use real mesh actor
else:
    use existing parametric implant bundle
```

### Actor identity and replacement

A geometry-backed implant actor must be rebuilt when any geometry-defining input changes, including:

- `geometryKey`;
- `geometryLocalTransform`;
- source mesh registration/version.

Position-only or rotation-only changes should update actor transforms without reparsing/rebuilding geometry.

### Existing visual behavior

The real mesh actor should preserve the current planning affordances where practical:

- active implant highlighting;
- visibility through the planning volume overlay;
- clinical placement controls;
- camera behavior;
- active selection;
- nerve overlay visibility.

The parametric guide/axis helper may remain as a separate planning helper if useful, but must not masquerade as manufacturer geometry.

## 10. Nerve-clearance behavior

Existing nerve-clearance calculations currently use the implant plan's declared diameter/length and axis, not triangle-level mesh collision.

Milestone 4 preserves that behavior.

Rendering a real STL does not silently upgrade nerve-clearance computation to mesh collision analysis.

This distinction must remain explicit:

- real STL = visual geometry;
- existing declared diameter/length = current clearance model;
- triangle-level collision/clearance = future separately specified work.

## 11. Fallback and error handling

A real geometry failure must never make the implant disappear unexpectedly when a safe parametric fallback is available.

Fallback conditions include:

- geometry key not found;
- invalid neutral mesh;
- VTK adapter failure;
- unsupported geometry mode;
- stale registry reference.

Expected behavior:

1. report a structured/non-blocking geometry diagnostic;
2. render the current parametric implant fallback;
3. preserve implant planning coordinates;
4. do not mark geometry as validated.

Stable error codes from the Milestone 3 loader remain authoritative for STL parsing errors.

## 12. Safety and licensing constraints

1. No proprietary/commercial STL is committed to the public repository without explicit redistribution rights.
2. CI fixtures remain synthetic/minimal and non-proprietary.
3. Local real STL validation may use user-supplied files in memory.
4. `validatedGeometry` remains false by default.
5. `redistributionAllowed` remains unknown by default.
6. Filenames are not a trusted source for clinical dimensions, units, model identity, or orientation.
7. Rendering success does not equal dimensional or clinical validation.
8. No claim of manufacturer compatibility is produced solely from visual fit.

## 13. Testing strategy

Implementation follows TDD: RED -> GREEN -> CI.

### A. Runtime geometry registry tests

- register/get mesh;
- replace mesh deterministically;
- unregister/clear;
- reject malformed registrations;
- safety/provenance preserved;
- no mutation of neutral mesh.

### B. VTK adapter tests

Using synthetic neutral geometry only:

- point count correct;
- triangle cells correct;
- input mesh not mutated;
- empty/invalid geometry rejected;
- bounds remain consistent;
- disposal helpers are safe/idempotent where applicable.

### C. Viewer actor-selection tests

- geometry key present -> real-mesh bundle selected;
- missing/stale key -> parametric fallback;
- changing XYZ/RX/RY/RZ does not rebuild mesh unnecessarily;
- changing geometry key/local transform does rebuild geometry;
- removing implant disposes actor resources;
- replacing real geometry leaves no orphan actor.

### D. Local import tests

- local STL asset gets safe defaults;
- ASCII local file follows existing loader;
- Binary local file follows existing loader;
- unsupported extension rejected;
- invalid STL does not replace working implant state;
- no implicit mm unit status.

### E. Integration tests

Synthetic catalog/implant + synthetic STL bytes:

```text
file/import
 -> loadStlGeometry
 -> registry
 -> VTK adapter
 -> Viewer implant bundle decision
```

Verify the exact same neutral mesh contract used by the geometry lab feeds the Viewer adapter.

### F. Visual smoke test

The CI visual gate must prove, with synthetic geometry:

1. Viewer 3D route initializes;
2. a geometry-backed implant actor is visible with the CBCT/Viewer rendering path;
3. changing implant translation changes its rendered screen/world result;
4. changing implant rotation changes its rendered result;
5. removing or switching geometry updates the render;
6. no browser exception occurs;
7. screenshot artifacts are uploaded.

A build alone is not sufficient proof.

## 14. Real-file validation gate

After automated synthetic tests pass, one user-authorized real STL is loaded locally for a non-committed validation session.

Record only diagnostics, not proprietary bytes:

- filename or redacted identifier as appropriate;
- format;
- triangle/vertex counts;
- raw bounds/extents;
- unit status;
- local transform used;
- whether the mesh visually follows XYZ and RX/RY/RZ;
- whether orientation/origin appear plausible;
- remaining uncertainty.

No real-file observation automatically changes `validatedGeometry` to true.

## 15. Acceptance criteria

Milestone 4 is GREEN only when all are true:

1. Existing Milestone 3 implant-library tests stay green.
2. New registry and VTK-adapter tests are green.
3. Viewer integration tests are green.
4. Web build succeeds.
5. Existing API tests succeed.
6. CI visual smoke proves a geometry-backed implant actor renders in the Viewer path.
7. XYZ translation visibly moves the real/synthetic mesh actor.
8. RX/RY/RZ rotation visibly rotates the mesh actor.
9. Parametric fallback still works when real geometry is absent.
10. Real geometry replacement/removal leaves no orphan VTK actors.
11. No proprietary/commercial STL bytes are committed.
12. Safety defaults remain conservative.
13. At least one user-authorized real STL is successfully loaded locally and appears in the Viewer 3D before calling the milestone complete.
14. The milestone is not deployed to production unless separately requested after GREEN verification.

## 16. Expected implementation boundaries

Likely files/modules involved:

- `apps/web/src/library/implant/` — runtime registry, local-import helper, VTK adapter, tests;
- `apps/web/src/Viewer3DPanel.jsx` — real-mesh actor lifecycle + fallback;
- `apps/web/src/Viewer2.jsx` — only lightweight geometry selection/import wiring if needed;
- visual smoke script/workflow — extend coverage to Viewer integration;
- synthetic test fixtures only.

Avoid unrelated refactors.

## 17. Explicitly deferred follow-up

The following is intentionally a future milestone:

**Mesh-aware 2D slice visualization** — intersecting the calibrated implant mesh with axial/coronal/sagittal/tangential planes so the exact real implant contour appears in 2D MPR views.

Milestone 4 proves the real mesh in the 3D clinical Viewer first. That keeps calibration errors visible and contained before introducing slice-plane geometry complexity.
