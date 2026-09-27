# OdontoView 3D-First Planning Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/viewer2` into the approved professional implant-planning workstation with dominant 3D, draggable grid panes, revealable tools drawer, and a visual implant transform gizmo.

**Architecture:** Keep all DICOM, MPR, implant, library, nerve and export state in the existing `Viewer2` / `Viewer3DPanel` flow. Add a thin workspace-layout layer for pane slot ordering, maximize/restore and drawer behavior, plus an isolated implant gizmo that edits the same `x/y/z/rx/ry/rz` fields already consumed by the 3D renderer. Styling changes the visual hierarchy without duplicating imaging logic.

**Tech Stack:** React, existing VTK.js viewer, CSS Grid, Pointer Events, Node test runner/Vitest as already configured, GitHub Actions, Railway.

**Spec:** `docs/superpowers/specs/2026-09-27-odontoview-3d-first-planning-layout-design.md`

## Global Constraints

- Desktop default: top-left tangential/multi-cut, top-center axial, top-right sagittal/coronal, bottom-left dominant 3D, bottom-right reconstructed panoramic.
- Right-side tools become an overlay drawer opened from a slim edge tab; it must not permanently consume imaging width.
- Pane rearrangement uses deterministic grid-slot swapping, not arbitrary free-floating windows.
- Existing clinical state and imaging calculations must remain authoritative and unchanged by layout movement.
- Visual gizmo edits the existing implant transform fields; no second implant state model.
- Numeric transform controls remain available as a precision fallback but are de-emphasized.
- Mobile/tablet performance behavior must not regress.
- Existing implant-library, WebGL and build gates remain mandatory.

## Review Focus

- Pane swapping must not remount/reset image or implant state unnecessarily.
- Maximizing/restoring the 3D panel must preserve active implant and loaded real geometry.
- Drawer open/close must not change viewer width calculations in a way that breaks canvas/WebGL sizing.
- Pointer drag on the implant gizmo must clamp/commit finite transform values and never emit NaN/Infinity.
- Tablet/phone must retain usable access even where full desktop drag behavior is reduced.

---

### Task 1: Deterministic workspace layout model

**Files:**
- Create: `apps/web/src/viewerWorkspaceLayout.js`
- Create: `apps/web/src/viewerWorkspaceLayout.test.js`

**Interfaces:**
- Produces: `DEFAULT_VIEWER_WORKSPACE_SLOTS`, `swapWorkspacePanes(slots, paneA, paneB)`, `resetWorkspaceSlots()`, `isWorkspacePaneId(value)`.

- [ ] Write failing tests proving the approved default pane order/slot map, deterministic swap, unknown-pane no-op/rejection behavior, and reset.
- [ ] Run the focused test file and confirm RED because the module does not yet exist.
- [ ] Implement the minimal pure layout helpers with no React or imaging imports.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit as `feat(viewer): add deterministic planning workspace layout`.

### Task 2: 3D-first viewer shell and revealable tools drawer

**Files:**
- Create: `apps/web/src/ViewerWorkspaceLayout.jsx`
- Modify: `apps/web/src/Viewer2.jsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes the Task 1 slot model.
- Produces a workspace shell that receives existing pane content as keyed children and exposes callbacks for swap/reset/maximize/drawer state.

- [ ] Add a failing layout/component smoke test or DOM-focused test that asserts five approved panes, dominant 3D slot, panoramic lower-right, hidden-by-default tools drawer, and deterministic swap/reset.
- [ ] Confirm RED.
- [ ] Implement the shell around the existing pane renderers without duplicating canvas/MPR code.
- [ ] Move the existing permanent `.viewer2-side` contents into a slide-over drawer opened by a slim `Ferramentas` edge tab; retain export/PDF and other tools inside the drawer.
- [ ] Preserve existing maximize behavior and add `Restaurar layout`.
- [ ] Add pointer/drag swapping plus a button-based swap/move fallback.
- [ ] Update desktop/tablet/phone CSS to match the approved dark planning-workstation visual hierarchy.
- [ ] Run tests and `npm run build`; fix only layout regressions.
- [ ] Commit as `feat(viewer): add 3d-first planning workspace`.

### Task 3: Visual implant transform gizmo

**Files:**
- Create: `apps/web/src/ImplantTransformGizmo.jsx`
- Create: `apps/web/src/implantTransformGizmo.test.js`
- Modify: `apps/web/src/Viewer3DPanel.jsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `ImplantTransformGizmo({ implant, onChange, disabled })`
- `onChange(nextTransform)` returns finite updates to the existing `x/y/z/rx/ry/rz` model only.

- [ ] Write failing tests for axis translation, rotation handle updates, finite-value clamping, disabled/no-active-implant behavior, and preservation of untouched transform fields.
- [ ] Confirm RED.
- [ ] Implement the compact head/orientation cue with X/Y/Z visual handles using Pointer Events.
- [ ] Integrate it as an overlay in the 3D viewport only when an implant is active.
- [ ] Route gizmo updates through the same existing implant-change callback/state used by current numeric controls.
- [ ] Move/de-emphasize persistent numeric transform chrome into the revealable tools area or a compact precision section; do not delete precision access.
- [ ] Run gizmo tests plus existing implant-library tests/build.
- [ ] Commit as `feat(viewer): add visual implant transform gizmo`.

### Task 4: Visual smoke, regression gates and production deployment

**Files:**
- Create: `apps/web/scripts/viewer-workspace-visual-smoke.mjs` or extend the existing smoke harness.
- Modify: `.github/workflows/<existing verification workflow>.yml` only if needed to run the new smoke.

**Interfaces:**
- Browser smoke must verify the production-like `/viewer2` DOM/layout without changing clinical data.

- [ ] Add a failing smoke gate that checks: five-pane layout, 3D dominant lower-left, panoramic lower-right, drawer open/close, one pane swap, maximize/restore, active-implant gizmo visibility, and zero uncaught browser exceptions.
- [ ] Confirm RED before implementation wiring is considered complete.
- [ ] Make the minimum fixes required for GREEN.
- [ ] Run the complete existing gates: API tests, implant-library tests, web build, geometry-lab WebGL smoke, implant-viewer geometry smoke, and the new workspace smoke.
- [ ] Verify exact GitHub Actions run and head SHA are GREEN.
- [ ] Trigger Railway production deploy from that exact GREEN branch head.
- [ ] Verify Railway deploy `SUCCESS`, runtime startup, and exact commit hash.
- [ ] Commit final smoke/harness changes as `test(viewer): gate 3d-first planning workspace`.
