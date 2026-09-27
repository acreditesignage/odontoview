# OdontoView Real Implant Viewer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load a user-authorized real STL through the existing neutral implant-geometry pipeline and render it as the active implant inside the existing VTK.js Viewer 3D while preserving XYZ/RX/RY/RZ planning controls and a safe parametric fallback.

**Architecture:** Real STL parsing remains outside `Viewer3DPanel`: local bytes are decoded by `loadStlGeometry()`, optionally calibrated with `transformGeometry()`, and stored in a memory-only runtime registry. `Viewer3DPanel` resolves a lightweight `geometryKey`, converts the registered neutral mesh to VTK through a dedicated adapter, and uses the existing implant actor lifecycle; if resolution or rendering fails, it keeps the existing parametric implant. Clinical position/rotation stays on the implant plan object and is applied after the geometry-local transform.

**Tech Stack:** React 18.3.1, Vite 6.1.0, Node test runner, VTK.js 37.1.1, existing OdontoView neutral geometry/STL pipeline, GitHub Actions Chrome/WebGL smoke tests.

**Spec:** `docs/superpowers/specs/2026-09-27-odontoview-real-implant-viewer-integration-design.md`

## Global Constraints

- Work on branch `feat/entrega-1-odonto-view-network`; refetch branch HEAD and current blob SHA before every write because concurrent Native changes are possible.
- Do not commit proprietary/commercial STL or SDFA bytes unless redistribution rights are explicitly established.
- CI and repository fixtures must remain synthetic/minimal and non-proprietary.
- `validatedGeometry` defaults to `false`; rendering never promotes it.
- `redistributionAllowed` defaults to `'unknown'`; local import never promotes it.
- Do not infer millimetres, manufacturer identity, clinical dimensions, implant axis, or origin from an STL filename.
- Raw STL bytes and typed-array mesh payloads must not be stored in the serializable `implants` state, database records, PDF payloads, or localStorage.
- The clinical placement source of truth remains `x`, `y`, `z`, `rx`, `ry`, `rz`, `diameter`, and `length` on the implant plan.
- Geometry-local calibration is applied before clinical placement and must not rewrite clinical XYZ/RX/RY/RZ.
- Existing nerve-clearance math continues to use declared implant diameter/length and axis; this milestone does not add triangle collision analysis.
- Existing intraoral scan STL/PLY fusion may keep its current VTK reader; implant geometry must not bypass the neutral loader through `vtkSTLReader`.
- Do not deploy this milestone to production until all verification gates are GREEN and deployment is separately requested.

## Review Focus

- Re-registering different geometry under the same `geometryKey` must bump a revision/signature so an existing actor is rebuilt instead of silently showing stale mesh; pin in Task 1 and Task 3 tests.
- Malformed/unsupported local STL must leave the active implant state and current actor usable; pin in Task 2 and Task 4 tests.
- Unknown STL units must remain explicitly unknown and must not trigger automatic scaling; pin in Task 2 tests and visual copy.
- Invalid/singular `geometryLocalTransform` must fall back safely without changing clinical coordinates; pin in Task 3 tests.
- Geometry replacement/removal must dispose VTK resources and leave no orphan actor; pin in Task 3 tests and Task 5 visual smoke.

---

### Task 1: Memory-only implant geometry registry

**Files:**
- Create: `apps/web/src/library/implant/implantGeometryRegistry.js`
- Create: `apps/web/src/library/implant/implantGeometryRegistry.test.js`
- Modify: `apps/web/src/library/implant/index.js`

**Interfaces:**
- Consumes: `validateNeutralGeometry(mesh)` from `geometrySchema.js`.
- Produces:
  - `registerImplantGeometry({ geometryKey, mesh, metadata = {} }) -> { geometryKey, mesh, metadata, revision }`
  - `getImplantGeometry(geometryKey) -> entry | null`
  - `unregisterImplantGeometry(geometryKey) -> boolean`
  - `clearImplantGeometryRegistry() -> void`
- `revision` is a monotonically increasing integer assigned on each successful registration, including replacement under the same key.

- [ ] **Step 1: Write the failing registry tests**

Test names/assertions:
- `registers and retrieves a valid neutral mesh without mutating it`
- `replacement under the same geometry key increments revision and exposes the new mesh`
- `rejects blank geometry keys and invalid neutral meshes`
- `unregister and clear remove entries deterministically`
- `preserves safety and provenance metadata without promoting validation`

Use a synthetic one-triangle neutral mesh with `validatedGeometry:false` and `redistributionAllowed:'unknown'`.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `apps/web`:
`node --test src/library/implant/implantGeometryRegistry.test.js`

Expected: FAIL because `implantGeometryRegistry.js` does not exist / exports are missing.

- [ ] **Step 3: Implement the registry with module-local `Map` state**

Reject invalid keys and invalid neutral meshes with `ImplantGeometryError('INVALID_GEOMETRY_VALUE', ...)`. Store references in memory only; do not serialize or clone large typed arrays. Clone/freeze only lightweight metadata as needed to prevent accidental mutation.

- [ ] **Step 4: Export the registry API from `index.js` and run tests GREEN**

Run:
`node --test src/library/implant/implantGeometryRegistry.test.js`

Expected: all Task 1 tests PASS.

- [ ] **Step 5: Run the full implant-library suite**

Run:
`npm run test:implant-library`

Expected: all existing and new tests PASS with zero failures/skips.

- [ ] **Step 6: Commit**

Commit message: `feat(implant-library): add runtime geometry registry`

---

### Task 2: Safe local STL import and geometry diagnostics

**Files:**
- Create: `apps/web/src/library/implant/localImplantGeometry.js`
- Create: `apps/web/src/library/implant/localImplantGeometry.test.js`
- Modify: `apps/web/src/library/implant/index.js`
- Reuse: `apps/web/src/library/implant/stlTestFixtures.js`

**Interfaces:**
- Consumes: `loadStlGeometry(asset, bytes)` and the registry API from Task 1.
- Produces:
  - `makeLocalImplantGeometryKey({ implantId, filename, size = 0, lastModified = 0 }) -> string`
  - `loadLocalImplantGeometry({ geometryKey, filename, bytes }) -> { geometryKey, mesh, diagnostics, metadata }`
  - `registerLocalImplantGeometry({ geometryKey, filename, bytes }) -> registryEntryWithDiagnostics`
- `diagnostics` contains `{ format, vertexCount, triangleCount, bounds, extents, center, unitStatus:'unknown' }`.
- Temporary asset descriptor must use `resolution:'resolved'`, a local matched-path surrogate, `validatedGeometry:false`, and `redistributionAllowed:'unknown'`.

- [ ] **Step 1: Write RED tests for the local importer**

Test names/assertions:
- ASCII `.stl` imports through the existing loader and reports exact counts/bounds.
- Binary `.STL` imports through the existing loader.
- extension other than `.stl` rejects with stable `UNSUPPORTED_GEOMETRY_FORMAT` behavior and does not register an entry.
- malformed STL rejects and does not overwrite an already registered good entry.
- diagnostics report `unitStatus:'unknown'`; no scale or `mm` field is invented.
- safety defaults remain false/unknown.
- generated local key is stable for identical implant/file metadata.

- [ ] **Step 2: Run focused test and verify RED**

Run:
`node --test src/library/implant/localImplantGeometry.test.js`

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement local import using `loadStlGeometry()` only**

Do not call VTK or Three. Calculate extents as `max-min` and center as `(min+max)/2`. Register only after the full parse/diagnostic step succeeds so a failed import cannot replace a working entry.

- [ ] **Step 4: Export helper API and run focused + full tests GREEN**

Run:
`node --test src/library/implant/localImplantGeometry.test.js`
`npm run test:implant-library`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(implant-library): add safe local STL import`

---

### Task 3: NeutralMesh-to-VTK adapter and runtime geometry decision

**Files:**
- Create: `apps/web/src/library/implant/neutralGeometryToVtk.js`
- Create: `apps/web/src/library/implant/neutralGeometryToVtk.test.js`
- Create: `apps/web/src/library/implant/implantViewerGeometryRuntime.js`
- Create: `apps/web/src/library/implant/implantViewerGeometryRuntime.test.js`
- Modify: `apps/web/src/library/implant/index.js`

**Interfaces:**
- Consumes: registry entries from Task 1, `transformGeometry(mesh, matrix4x4)`, `IDENTITY_MATRIX_4X4`, VTK.js `vtkPolyData`, `vtkPoints`, `vtkCellArray`, `vtkMapper`, `vtkActor`.
- Produces:
  - `createVtkPolyDataFromNeutralGeometry(mesh) -> { poly, points, polys }`
  - `createVtkImplantGeometryBundle({ mesh, localTransform, active }) -> { mode:'mesh', actor, mapper, poly, points, polys, geometrySignature }`
  - `disposeVtkImplantGeometryBundle(bundle) -> void`
  - `resolveImplantGeometryRuntime(implant) -> { mode:'mesh'|'parametric', entry:null|registryEntry, localTransform, signature, diagnostic }`
  - `implantGeometrySignature(implant, entry) -> string`
- Signature must include `geometryKey`, registry `revision`, and all 16 local-transform values; clinical XYZ/RX/RY/RZ must not be part of geometry rebuild identity.

- [ ] **Step 1: Write RED adapter tests**

Assertions:
- valid neutral positions become `vtkPoints` with the same point count/data.
- each triangle index triple becomes one VTK polygon cell `[3,a,b,c]`.
- neutral input arrays/source/safety are unchanged.
- invalid neutral mesh throws `INVALID_GEOMETRY_VALUE`.
- bundle applies an explicit local transform before VTK conversion and keeps clinical actor position/orientation unset at geometry-build time.
- disposal is idempotent.

- [ ] **Step 2: Run adapter test RED**

Run:
`node --test src/library/implant/neutralGeometryToVtk.test.js`

Expected: FAIL because adapter does not exist.

- [ ] **Step 3: Implement the minimal VTK adapter**

Use `transformGeometry()` for local calibration, then copy neutral positions/indices into VTK structures. Do not parse STL here.

- [ ] **Step 4: Write RED runtime-resolution tests**

Assertions:
- registered key resolves to `mode:'mesh'`.
- missing/stale key resolves to `mode:'parametric'` with a non-blocking diagnostic.
- same key re-registered with a higher revision changes signature.
- XYZ/RX/RY/RZ-only edits do not change signature.
- local transform edit changes signature.
- invalid/singular local transform resolves/fails safely without mutating clinical coordinates.

- [ ] **Step 5: Implement runtime resolution/signature and run both test files GREEN**

Run:
`node --test src/library/implant/neutralGeometryToVtk.test.js src/library/implant/implantViewerGeometryRuntime.test.js`

Expected: PASS.

- [ ] **Step 6: Run full implant suite and commit**

Run:
`npm run test:implant-library`

Commit message: `feat(implant-library): adapt neutral geometry to vtk`

---

### Task 4: Integrate real mesh actor + local import UI into `Viewer3DPanel`

**Files:**
- Modify: `apps/web/src/Viewer3DPanel.jsx` around current parametric bundle helpers (`~300-400`), local import/planning helpers (`~540-760`), actor lifecycle effect (`~1000-1080`), and implant planner UI (`~1120-1210`).
- Optional targeted style additions only if required: `apps/web/src/styles.css`.
- Test behavior through pure Task 3 helpers plus Task 5 browser smoke; do not create a brittle full React unit test harness.

**Interfaces:**
- Consumes: `registerLocalImplantGeometry`, `resolveImplantGeometryRuntime`, `createVtkImplantGeometryBundle`, `disposeVtkImplantGeometryBundle`.
- Existing props remain unchanged: `implants`, `activeImplantId`, `onImplantsChange`, `onActiveImplantChange`.
- Adds lightweight implant fields only:
  - `geometryKey`
  - `geometryMode:'mesh'`
  - `geometryLocalTransform:[16 finite numbers]`
  - `geometrySafety:{ validatedGeometry:false, redistributionAllowed:'unknown' }`
  - `geometryProvenance:{ sourceKind:'local-file', filename }`
  - optional diagnostics summary without typed arrays/raw bytes.

- [ ] **Step 1: Add hidden implant-STL input and import status state without changing existing scan fusion**

Add a separate `implantGeometryInputRef`; do not reuse `scanInputRef` and do not change `importIntraoralScan()`.

- [ ] **Step 2: Implement `importActiveImplantGeometry(file)`**

Behavior:
- require an active implant;
- read `await file.arrayBuffer()` locally;
- derive a stable local key using Task 2 helper;
- parse/register before touching implant state;
- on success patch only the active implant with lightweight geometry metadata;
- on failure keep implant object/actor unchanged and show the loader error code/message;
- show diagnostics including filename, format, counts, raw extents, and `Unidade STL: desconhecida`.

- [ ] **Step 3: Extend implant actor lifecycle to choose mesh or parametric fallback**

For every implant in the existing `implantActorsRef` loop:
- resolve Task 3 runtime geometry;
- rebuild when bundle absent or geometry signature/parametric dimensions require rebuild;
- create real VTK mesh bundle when resolution is mesh;
- if real bundle creation throws, record diagnostic and create current `createParametricImplantBundle()` instead;
- add actor (and existing guide helper if retained) to the same renderer used for implants;
- position/orient both real and parametric actors with existing `updateImplantBundle()` semantics;
- preserve active highlighting;
- no STL parser inside the Viewer.

- [ ] **Step 4: Make disposal handle both bundle modes**

`disposeImplantBundle()` must route real-mesh resources through Task 3 disposal and preserve existing parametric guide cleanup. Removal/replacement must delete actors, mapper, polydata and points exactly once.

- [ ] **Step 5: Add planner controls/copy**

For an active implant add:
- `Carregar STL do implante` / `Trocar STL` button;
- mesh-vs-parametric status;
- local filename and raw diagnostic extents when available;
- explicit copy that units are unknown until calibrated;
- safety state (`validatedGeometry:false`).

Do not change the existing nerve-clearance claim into mesh collision. Keep the existing warning/model distinction.

- [ ] **Step 6: Run full tests and production build**

Run from `apps/web`:
`npm run test:implant-library`
`npm run build`

Expected: all tests PASS and Vite build succeeds. Known legacy script/chunk warnings may remain, but no new real-geometry errors.

- [ ] **Step 7: Commit**

Commit message: `feat(viewer): render registered implant meshes in 3d`

---

### Task 5: Clinical Viewer WebGL smoke for real mesh, XYZ/RX/RZ, replacement and fallback

**Files:**
- Create: `apps/web/src/ImplantViewerGeometrySmoke.jsx`
- Modify: `apps/web/src/AppEntry.jsx`
- Create: `apps/web/scripts/smoke-implant-viewer-geometry.mjs`
- Modify: `.github/workflows/entrega1-network-ci.yml`
- Reuse synthetic STL generators only; do not add commercial mesh bytes.

**Interfaces:**
- Smoke route: `/implant-viewer-geometry-smoke`.
- Route mounts the real `Viewer3DPanel` with a tiny deterministic synthetic CBCT volume/meta and one planned implant.
- The harness registers a synthetic STL through the same Task 2 local-import path and attaches its lightweight geometry reference to the implant.

- [ ] **Step 1: Build the synthetic smoke page**

Create deterministic volume dimensions/spacing large enough for the implant to be visible. Register a deliberately asymmetric synthetic implant-like STL so rotation produces a visibly different screenshot (do not use a symmetric tetrahedron for the rotation assertion).

- [ ] **Step 2: Add the route in `AppEntry.jsx`**

Keep `/implant-geometry-lab` unchanged. Add only the hidden smoke route; no navigation link.

- [ ] **Step 3: Write the Chrome/CDP smoke script**

The script must:
1. open `/implant-viewer-geometry-smoke`;
2. wait for VTK/WebGL canvas and a `mesh` status marker;
3. capture initial screenshot;
4. click/trigger X translation and verify viewport pixels change while geometry signature stays constant;
5. trigger RX or RY rotation and verify viewport pixels change while geometry signature stays constant;
6. replace geometry under the same key/revision path and verify rendered result changes/rebuild marker advances;
7. unregister/switch to a stale key and verify parametric fallback remains visible;
8. remove the implant and verify the implant render/status disappears without browser exception;
9. save screenshots and print a machine-readable success summary.

- [ ] **Step 4: Add CI workflow steps and artifact upload**

After existing implant tests/build and existing geometry-lab smoke, run the new Viewer smoke against the same Vite preview process or a separate deterministic preview command. Upload screenshots as artifact `implant-viewer-geometry-smoke`.

- [ ] **Step 5: Run/observe RED then GREEN in GitHub Actions**

RED is acceptable only for the newly introduced smoke expectation; existing API, implant tests, build and geometry-lab smoke must remain green.

GREEN gate:
- API tests pass;
- all implant-library tests pass;
- Vite build passes;
- existing geometry-lab smoke passes;
- new Viewer geometry smoke reports mesh visible + translate + rotate + replace + fallback + removal success;
- screenshots artifact uploads successfully.

- [ ] **Step 6: Commit**

Commit message: `test(viewer): verify real implant mesh in vtk scene`

---

### Task 6: Real user-authorized STL validation and final scope verification

**Files:**
- No proprietary mesh added to repository.
- Optional documentation-only result: `docs/superpowers/verification/2026-09-27-real-implant-viewer-validation.md` containing diagnostics only, if useful and if filename/model details are safe to record.

**Interfaces:**
- Consumes the completed local import control from Task 4 and the real clinical `Viewer3DPanel` path.
- Produces verification evidence only; no promotion of safety metadata.

- [ ] **Step 1: Refetch final branch HEAD and verify CI for that exact SHA**

Require the latest workflow run attached to the exact head SHA to be completed/success before real-file validation.

- [ ] **Step 2: Load one user-authorized real STL locally without committing/uploading its bytes to GitHub**

Use the Viewer control `Carregar STL do implante`. If the environment cannot programmatically select a user-local file, do not fake this gate: stop the completion claim at the automated GREEN state and surface the exact route/control for the user's one local selection. The milestone is complete only after evidence from a real authorized file exists.

- [ ] **Step 3: Record non-byte diagnostics**

Record:
- filename or redacted identifier;
- STL format;
- vertex/triangle counts;
- raw bounds/extents and center;
- `unitStatus:'unknown'` unless independently established;
- local transform used;
- geometry safety values;
- whether the mesh follows XYZ and RX/RY/RZ visibly;
- any orientation/origin uncertainty.

Do not infer clinical correctness from appearance.

- [ ] **Step 4: Verify the parametric fallback still works after removing/staling the geometry reference**

The implant must remain visible and retain its planning coordinates.

- [ ] **Step 5: Final branch scope audit**

Compare from plan/spec baseline to final HEAD. Confirm changes are limited to implant geometry/runtime/viewer/smoke/docs/workflow needs; no database schema, API contract, PDF clinical-report behavior, 2D exact mesh intersection, or proprietary asset was introduced.

- [ ] **Step 6: Final verification commands/evidence**

Require on exact final SHA:
- API `npm test` GREEN through GitHub Actions;
- `npm run test:implant-library` GREEN with zero failures/skips;
- `npm run build` GREEN;
- both visual smoke gates GREEN;
- real authorized STL observed in Viewer 3D before calling Milestone 4 complete.

- [ ] **Step 7: Commit diagnostics doc only if created**

Commit message: `docs(viewer): record real implant geometry validation`

Do not commit the STL.
