# OdontoView Implant Geometry 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load resolved STL assets from the implant catalog into a renderer-neutral mesh, apply only explicit 4x4 transforms, and render the result in an isolated 3D lab without integrating manufacturer meshes into the production DICOM/CBCT Viewer.

**Architecture:** Keep geometry parsing and transformation in pure JavaScript modules under the existing implant-library boundary. Add a thin Three.js adapter and a separate React test surface at `/implant-geometry-lab`; it consumes the neutral mesh but does not import or modify `Viewer2.jsx` or `Viewer3DPanel.jsx`. Public tests use only synthetic STL data; no proprietary implant meshes are committed.

**Tech Stack:** JavaScript ESM, Node.js test runner, React 18.3.1, Three.js 0.169.0, React Router 6.30.1, Vite 6.1.0.

**Spec:** `docs/superpowers/specs/2026-09-26-odontoview-implant-geometry-3d-design.md`

## Global Constraints

- Work only on branch `feat/entrega-1-odonto-view-network`.
- Do not integrate manufacturer geometry into the production Viewer in this milestone.
- Do not place implants into CBCT/DICOM patient coordinates.
- Do not decode SDFA; reject it as unsupported for geometry loading while preserving it in the catalog.
- Do not add archive decompression to the application.
- Do not publish or commit proprietary commercial STL/SDFA assets into the public repository.
- Do not guess units, handedness, orientation, implant long axis, clinical depth, or patient alignment.
- Keep `validatedGeometry` unchanged; loading/rendering must never promote it to `true`.
- Keep `redistributionAllowed` unchanged unless already explicit in the source asset.
- Only `resolution === 'resolved'` assets with a non-empty `matchedPath` are loadable.
- Missing and ambiguous geometry remain explicit failures; no candidate may be auto-selected.
- Neutral geometry must remain independent of Three.js and VTK.js.
- Every production behavior change follows RED -> minimal GREEN -> full implant-library suite -> production build.
- Do not deploy this milestone to production while it is still an isolated geometry lab.

## Review Focus

1. **Binary STL whose 80-byte header begins with `solid`:** format detection must still identify it as binary by structural length/triangle-count evidence; pinned in Task 2.
2. **Declared Binary STL triangle count incompatible with the byte length:** reject with `TRUNCATED_BINARY_STL` before allocating/parsing triangle arrays; pinned in Task 2.
3. **ASCII/Binary triangle with non-finite or degenerate coordinates:** never emit `NaN` normals or partial mesh; reject with stable geometry errors; pinned in Task 2.
4. **Affine transforms with non-uniform scale or a singular linear part:** normals use inverse-transpose semantics and a non-invertible normal transform is rejected with `INVALID_TRANSFORM`; pinned in Task 3.
5. **Renderer conversion accidentally mutating neutral mesh or safety metadata:** Three.js adapter must copy/reference data read-only and leave source/safety fields untouched; pinned in Task 5.

---

## File Structure

### Create

- `apps/web/src/library/implant/geometrySchema.js` — geometry schema version, neutral-mesh validation, identity matrix, and `ImplantGeometryError`.
- `apps/web/src/library/implant/geometrySchema.test.js` — neutral-mesh contract and stable error tests.
- `apps/web/src/library/implant/stlTestFixtures.js` — generated/synthetic ASCII/Binary STL helpers; no proprietary bytes.
- `apps/web/src/library/implant/loadStlGeometry.js` — resolved-asset gate, STL detection, ASCII/Binary parsing, normals and bounds.
- `apps/web/src/library/implant/loadStlGeometry.test.js` — loader TDD coverage.
- `apps/web/src/library/implant/transformGeometry.js` — pure 4x4 mesh transformation and normal-matrix logic.
- `apps/web/src/library/implant/transformGeometry.test.js` — identity/translation/rotation/non-uniform-scale tests.
- `apps/web/src/library/implant/geometryPipelineIntegration.test.js` — catalog selector -> loader -> transformer integration.
- `apps/web/src/library/implant/threeGeometryAdapter.js` — thin neutral-mesh -> `THREE.BufferGeometry` adapter.
- `apps/web/src/library/implant/threeGeometryAdapter.test.js` — adapter attributes/topology/non-mutation tests.
- `apps/web/src/implantGeometryLabFixtures.js` — small synthetic catalog plus synthetic STL bytes for the browser lab.
- `apps/web/src/ImplantGeometryLab.jsx` — isolated 3D geometry test surface.
- `apps/web/src/implantGeometryLab.css` — lab-only layout and controls.

### Modify

- `apps/web/src/library/implant/index.js` — export geometry schema, STL loader and transformer after tests pass.
- `apps/web/src/App.jsx` — add only the isolated `/implant-geometry-lab` route/import; do not alter `/viewer2`.

No dependency change is required: Three.js `0.169.0` is already installed.

---

### Task 1: Neutral geometry contract and stable errors

**Files:**
- Create: `apps/web/src/library/implant/geometrySchema.js`
- Create: `apps/web/src/library/implant/geometrySchema.test.js`

**Interfaces:**
- Produces: `IMPLANT_GEOMETRY_SCHEMA_VERSION = 1`.
- Produces: `IDENTITY_MATRIX_4X4` as a frozen 16-number array in column-major convention used consistently by Task 3.
- Produces: `ImplantGeometryError(code, message, details = [])`.
- Produces: `validateNeutralGeometry(mesh) -> { valid, errors }`.

- [ ] **Step 1: Write RED tests for the minimal neutral mesh contract**

Assert a one-triangle mesh with `Float32Array(9)` positions/normals, `Uint32Array([0,1,2])`, finite bounds, source metadata, and safety metadata validates successfully. Assert `IMPLANT_GEOMETRY_SCHEMA_VERSION === 1`.

```js
assert.equal(IMPLANT_GEOMETRY_SCHEMA_VERSION, 1);
assert.equal(validateNeutralGeometry(mesh).valid, true);
assert.equal(mesh.positions.length, mesh.vertexCount * 3);
assert.equal(mesh.indices.length, mesh.triangleCount * 3);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd apps/web && node --test src/library/implant/geometrySchema.test.js`

Expected: FAIL because `geometrySchema.js` does not exist.

- [ ] **Step 3: Implement the minimal schema validator and error class**

Validate typed-array types, schema version, positive triangle count, count/array-length consistency, finite positions/normals/bounds, index range, source fields, and safety fields. Do not introduce renderer objects.

- [ ] **Step 4: Add RED invariant tests**

Assert validation fails for: non-finite coordinates, out-of-range indices, wrong array lengths, zero triangles, invalid bounds, and malformed safety metadata.

- [ ] **Step 5: Implement invariant checks and verify GREEN**

Run:
- `cd apps/web && node --test src/library/implant/geometrySchema.test.js`
- `cd apps/web && npm run test:implant-library`

Expected: all PASS.

- [ ] **Step 6: Commit Task 1**

Commit message: `feat(implant-library): define neutral geometry contract`

---

### Task 2: STL ASCII/Binary loader with resolved-asset gate

**Files:**
- Create: `apps/web/src/library/implant/stlTestFixtures.js`
- Create: `apps/web/src/library/implant/loadStlGeometry.js`
- Create: `apps/web/src/library/implant/loadStlGeometry.test.js`
- Use: `apps/web/src/library/implant/geometrySchema.js`

**Interfaces:**
- Consumes: catalog geometry asset `{ id, filename, resolution, matchedPath, validatedGeometry, redistributionAllowed }` plus `ArrayBuffer | ArrayBufferView` bytes.
- Produces: `loadStlGeometry(asset, sourceBytes) -> neutralMesh`.
- Errors use `ImplantGeometryError` with codes from the spec.

- [ ] **Step 1: Create synthetic STL helpers**

Provide helpers for: one valid ASCII triangle, one valid Binary triangle, Binary STL with a header beginning `solid`, truncated Binary STL, zero-normal triangle, and degenerate triangle. Fixtures must be generated from source code and contain no commercial geometry.

- [ ] **Step 2: Write RED gate/error tests**

Assert `loadStlGeometry()` throws:
- `UNRESOLVED_GEOMETRY` for `missing`, `ambiguous`, or blank `matchedPath`;
- `UNSUPPORTED_GEOMETRY_FORMAT` for `.sdfa`;
- `INVALID_STL` for random/malformed bytes.

```js
assert.throws(() => loadStlGeometry(missingAsset, bytes), error => error.code === 'UNRESOLVED_GEOMETRY');
assert.throws(() => loadStlGeometry(sdfaAsset, bytes), error => error.code === 'UNSUPPORTED_GEOMETRY_FORMAT');
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `cd apps/web && node --test src/library/implant/loadStlGeometry.test.js`

Expected: FAIL because the loader is missing.

- [ ] **Step 4: Implement resolved-asset gate and format dispatch**

Use filename/matched-path extension case-insensitively. Accept only STL. Convert `ArrayBufferView` to the exact byte window before parsing.

- [ ] **Step 5: Add RED ASCII parsing tests**

Assert a valid ASCII STL produces exactly 3 vertices, 1 triangle, deterministic sequential indices `[0,1,2]`, finite bounds, `source.format === 'stl-ascii'`, preserved source path/safety metadata, and recomputed facet normal when supplied normal is zero.

Also assert malformed facet structure, non-finite vertex text (`NaN`, `Infinity`), and degenerate triangle fail with `INVALID_STL`, `INVALID_GEOMETRY_VALUE`, or `DEGENERATE_GEOMETRY` as appropriate.

- [ ] **Step 6: Implement ASCII parser and verify its RED cases turn GREEN**

Do not return partial geometry. Emit one independent vertex per triangle corner; vertex welding is out of scope.

- [ ] **Step 7: Add RED Binary parsing tests**

Assert:
- a standard valid Binary STL loads as `stl-binary`;
- a valid Binary STL whose header begins with `solid` still loads as binary;
- declared triangle count with insufficient bytes throws `TRUNCATED_BINARY_STL`;
- non-finite binary coordinates throw `INVALID_GEOMETRY_VALUE`;
- degenerate binary triangle throws `DEGENERATE_GEOMETRY`.

- [ ] **Step 8: Implement structural Binary detection/parsing**

Read the little-endian count at byte 80 and compute `84 + triangleCount * 50` using overflow-safe arithmetic before allocating output arrays. Prefer a structurally exact Binary match; otherwise attempt strict ASCII parsing. Never classify solely from the word `solid`.

- [ ] **Step 9: Add deterministic-output test**

Load the same ASCII bytes twice and deep-compare schema version, source, counts, bounds, safety and all typed-array contents.

- [ ] **Step 10: Run focused and full suite**

Run:
- `cd apps/web && node --test src/library/implant/loadStlGeometry.test.js`
- `cd apps/web && npm run test:implant-library`

Expected: all PASS.

- [ ] **Step 11: Commit Task 2**

Commit message: `feat(implant-library): load resolved STL geometry`

---

### Task 3: Explicit 4x4 geometry transformation

**Files:**
- Create: `apps/web/src/library/implant/transformGeometry.js`
- Create: `apps/web/src/library/implant/transformGeometry.test.js`
- Use: `apps/web/src/library/implant/geometrySchema.js`

**Interfaces:**
- Consumes: validated neutral mesh plus optional 16-number column-major matrix.
- Produces: `transformGeometry(mesh, matrix4x4 = IDENTITY_MATRIX_4X4) -> transformedMesh`.
- Output adds `transform: { matrix: number[16] }` while preserving source/safety metadata and topology.

- [ ] **Step 1: Write RED identity/translation tests**

Assert identity preserves all positions and indices exactly. Assert translation changes positions by the supplied offsets, leaves normals unchanged, recomputes bounds, and does not mutate the input mesh.

- [ ] **Step 2: Run focused test and verify RED**

Run: `cd apps/web && node --test src/library/implant/transformGeometry.test.js`

Expected: FAIL because transformer is missing.

- [ ] **Step 3: Implement matrix validation and position transformation**

Require exactly 16 finite numbers. Default to identity. Clone output typed arrays rather than mutating input.

- [ ] **Step 4: Add RED rotation and normal tests**

Use a known 90-degree rotation matrix and assert both position and normal vectors land on expected axes within a small numeric tolerance; translation components must not affect normals.

- [ ] **Step 5: Implement normal transformation correctly**

Derive the inverse-transpose of the matrix's upper-left 3x3 and normalize each output normal. Do not use translation for normals.

- [ ] **Step 6: Add RED non-uniform-scale and singular-matrix tests**

Assert a non-uniform scaling matrix transforms normals according to inverse-transpose semantics. Assert a singular/non-invertible 3x3 linear transform throws `INVALID_TRANSFORM` rather than producing invalid normals.

- [ ] **Step 7: Implement singular handling and verify GREEN**

Run:
- `cd apps/web && node --test src/library/implant/transformGeometry.test.js`
- `cd apps/web && npm run test:implant-library`

Expected: all PASS.

- [ ] **Step 8: Commit Task 3**

Commit message: `feat(implant-library): transform neutral implant geometry`

---

### Task 4: Catalog-to-geometry integration and public API

**Files:**
- Create: `apps/web/src/library/implant/geometryPipelineIntegration.test.js`
- Modify: `apps/web/src/library/implant/index.js`
- Use: existing catalog selectors plus Tasks 1-3.

**Interfaces:**
- Public exports added after integration is pinned:
  - `IMPLANT_GEOMETRY_SCHEMA_VERSION`
  - `IDENTITY_MATRIX_4X4`
  - `ImplantGeometryError`
  - `validateNeutralGeometry`
  - `loadStlGeometry`
  - `transformGeometry`

- [ ] **Step 1: Write RED end-to-end integration test through `index.js`**

Construct a small valid catalog with one variant containing resolved, missing and ambiguous geometry. Use `getVariantGeometryAssets(catalog, variantId, { resolvedOnly: true })` to obtain exactly the resolved STL asset, then feed synthetic STL bytes to the loader and identity transformer.

Assert:
- catalog selector returns only resolved asset;
- loader preserves `matchedPath` as `source.sourcePath`;
- loader keeps `validatedGeometry === false` and `redistributionAllowed === 'unknown'`;
- transformed mesh remains schema-valid;
- missing/ambiguous assets throw if passed directly to the loader.

- [ ] **Step 2: Run integration test and verify RED before exports**

Run: `cd apps/web && node --test src/library/implant/geometryPipelineIntegration.test.js`

Expected: FAIL because new geometry functions are not yet exported from `index.js`.

- [ ] **Step 3: Export the geometry API from `index.js`**

Do not import React, Three.js or Viewer modules into `index.js`.

- [ ] **Step 4: Run integration + complete implant-library suite**

Run:
- `cd apps/web && node --test src/library/implant/geometryPipelineIntegration.test.js`
- `cd apps/web && npm run test:implant-library`

Expected: all PASS, zero failures/skips.

- [ ] **Step 5: Commit Task 4**

Commit message: `feat(implant-library): expose geometry pipeline api`

---

### Task 5: Thin Three.js adapter and isolated geometry lab

**Files:**
- Create: `apps/web/src/library/implant/threeGeometryAdapter.js`
- Create: `apps/web/src/library/implant/threeGeometryAdapter.test.js`
- Create: `apps/web/src/implantGeometryLabFixtures.js`
- Create: `apps/web/src/ImplantGeometryLab.jsx`
- Create: `apps/web/src/implantGeometryLab.css`
- Modify: `apps/web/src/App.jsx` import block and route table only.

**Interfaces:**
- Produces: `createThreeBufferGeometry(mesh) -> THREE.BufferGeometry`.
- Browser lab route: `/implant-geometry-lab`.
- Lab uses a tiny synthetic catalog and in-memory synthetic STL byte map; it must not bundle commercial geometry.

- [ ] **Step 1: Write RED Three adapter test**

Create a neutral one-triangle mesh and assert the adapter result has `position` and `normal` attributes with `vertexCount` items and an index with `triangleCount * 3` entries. Snapshot/copy the neutral input before calling and assert its typed arrays, source and safety metadata remain unchanged afterward.

- [ ] **Step 2: Run focused adapter test and verify RED**

Run: `cd apps/web && node --test src/library/implant/threeGeometryAdapter.test.js`

Expected: FAIL because adapter is missing.

- [ ] **Step 3: Implement the thin Three.js adapter**

Create a new `THREE.BufferGeometry`; attach position/normal/index arrays; compute a Three bounding sphere only for camera fitting. The adapter must not parse STL or alter safety/source metadata.

- [ ] **Step 4: Build synthetic browser-lab fixtures**

Provide two small resolved catalog variants and corresponding generated ASCII/Binary STL byte buffers. Include manufacturer/system/component/variant identity and safe defaults. Do not reuse proprietary test assets.

- [ ] **Step 5: Implement `ImplantGeometryLab.jsx`**

Use existing catalog selectors for manufacturer -> system -> component -> variant selection. For the chosen variant: select its resolved STL asset, load bytes through `loadStlGeometry`, apply identity by default through `transformGeometry`, adapt through `createThreeBufferGeometry`, and render with Three.js.

Required visible lab behavior:
- orbit, zoom and pan via `OrbitControls`;
- reset/fit camera button;
- XYZ axes and grid/reference surface;
- manufacturer/system/component/variant selectors;
- source filename and matched path;
- ASCII/Binary format, vertex/triangle counts and bounds;
- active transform marked `Identity` initially;
- `validatedGeometry` and `redistributionAllowed` shown explicitly;
- a clear label that this is an isolated development geometry lab, not clinical placement.

Dispose renderer, controls, geometry and materials on unmount/variant replacement. Handle resize without changing Viewer code.

- [ ] **Step 6: Add isolated route only**

Import `ImplantGeometryLab` in `App.jsx` and add:

```jsx
<Route path="/implant-geometry-lab" element={<ImplantGeometryLab/>}/>
```

Do not change the existing `/viewer2` route or `Viewer2.jsx`/`Viewer3DPanel.jsx`.

- [ ] **Step 7: Run adapter test, full library tests, and production build**

Run:
- `cd apps/web && node --test src/library/implant/threeGeometryAdapter.test.js`
- `cd apps/web && npm run test:implant-library`
- `cd apps/web && npm run build`

Expected: all tests PASS and build exits 0. Existing non-module viewer-script/chunk-size warnings may remain; no new geometry-lab build error is allowed.

- [ ] **Step 8: Perform a browser visual smoke check**

Open `/implant-geometry-lab` in an available local/browser harness and verify: mesh visible, axes visible, orbit/zoom/pan respond, reset fits mesh, switching the synthetic variant replaces geometry, and safety metadata remains visible.

If no browser harness is available in the execution environment, do **not** declare Milestone 3 complete; record browser visual smoke as the only remaining verification rather than treating build success as rendering proof.

- [ ] **Step 9: Commit Task 5**

Commit message: `feat(implant-library): add isolated geometry lab`

---

### Task 6: Final Milestone 3 verification

**Files:**
- No new production files expected.
- Review all files added/modified in Tasks 1-5.

**Interfaces:**
- Produces evidence that Milestone 3 satisfies the approved spec without production Viewer integration.

- [ ] **Step 1: Run the implant-library suite fresh**

Run: `cd apps/web && npm run test:implant-library`

Expected: all tests PASS, zero failures/skips.

- [ ] **Step 2: Run production build fresh**

Run: `cd apps/web && npm run build`

Expected: exit 0.

- [ ] **Step 3: Review branch diff for scope**

Verify this milestone did not modify `Viewer2.jsx`, `Viewer3DPanel.jsx`, API/database files, archive handling, DICOM coordinate placement, or surgical-guide code. `App.jsx` may contain only the isolated lab import/route change for this milestone.

- [ ] **Step 4: Review safety/geometry semantics**

Confirm in code/tests:
- loading means structurally parseable source geometry, not clinical correctness;
- rendering does not set `validatedGeometry: true`;
- `redistributionAllowed` is preserved;
- SDFA is not decoded;
- missing/ambiguous assets cannot load;
- no automatic units/orientation/patient transform exists;
- real commercial meshes are absent from the public diff.

- [ ] **Step 5: Confirm visual smoke evidence**

A visible isolated mesh with working camera controls is required. Build-only evidence is insufficient for this criterion.

- [ ] **Step 6: Record final commit SHA and exact GitHub Actions result**

Only declare Milestone 3 GREEN after the workflow run for the final commit is `success` and includes `Web implant library tests` plus `Web build`, and after Step 5 is verified.
