# OdontoView — 3D-first planning layout design

Date: 2026-09-27
Status: approved visual direction, awaiting written-spec review
Branch: feat/entrega-1-odonto-view-network

## Intent

Rework `/viewer2` from a dense equal-weight diagnostic mosaic into a modern implant-planning workstation whose visual hierarchy matches the user-approved mockup: three diagnostic views across the top, a large 3D planning viewport in the lower-left, and the reconstructed panoramic view in the lower-right. The experience must feel like a professional planning application rather than an administrative dashboard.

The change is visual/interaction architecture only. Existing DICOM/MPR calculations, reconstructed panoramic logic, implant state, local implant-library ingestion, real geometry rendering, nerve data, curve logic, measurements, and export capabilities remain functionally available.

## Approved layout

Desktop default composition:

- Top-left: tangential/multi-cut view.
- Top-center: axial view, including the dental-arch curve when active.
- Top-right: sagittal/coronal planning view; current sagittal view is the default visible panel and related orthogonal controls remain accessible.
- Bottom-left: large 3D planning viewport. This is the dominant visual panel.
- Bottom-right: reconstructed panoramic view.

The layout should visually follow the approved concept image exactly in hierarchy and proportion, while retaining OdontoView branding rather than copying another product's chrome.

## Visual direction

- Dark graphite/navy clinical workstation palette.
- Thin separators instead of heavy cards.
- Minimal headers per viewport.
- High-contrast imaging area, restrained accent color.
- 3D viewport receives the largest uninterrupted surface.
- Controls should float or reveal contextually rather than permanently consuming space.
- No permanent patient-information/PDF/info sidebar taking horizontal space from imaging.

## Revealable side tools

Replace the current always-open right-side information stack with a narrow edge tab.

Behavior:

- A slim clickable `Ferramentas` tab remains docked to the right edge.
- Clicking reveals a slide-in panel over the viewer instead of resizing the imaging mosaic.
- Closing returns the drawer to its edge tab.
- Drawer groups existing tools by task: Implant planning/library, Nerve/Foramen, Arch curve, Image controls, Export/secondary tools.
- Patient-identifying study header remains compact at the top; verbose informational blocks and PDF controls are not permanently visible.

## Draggable viewport layout

Each imaging viewport is a movable module.

- Viewports can be dragged by their header.
- Dropping one viewport on another swaps their grid slots; arbitrary free-floating windows are not required.
- The 3D viewport starts in the large lower-left slot but can be swapped if desired.
- Provide a non-drag alternative (swap/move control) for touch/accessibility.
- Provide `Restaurar layout` to return all panes to the approved default positions.
- Layout movement must not change cursor coordinates, slice indices, implant state, or reconstruction data.

## Maximize / restore

Every viewport can temporarily occupy the full viewer work area.

- One-click maximize from its compact header.
- Restore returns it to its previous grid slot.
- Existing `expandedPanel` behavior may be adapted rather than replaced if it preserves current functionality.
- Escape may restore on desktop.

## 3D implant manipulation gizmo

The user explicitly approved a visual orientation/manipulation control resembling a small head/orientation widget with axes.

Goal: reduce dependence on persistent numeric X/Y/Z/RX/RY/RZ button clusters.

Design:

- Add a compact 3D orientation/manipulation gizmo over the 3D viewport.
- Show a simplified head/orientation cue plus orthogonal axis handles.
- When an implant is active, the manipulator controls implant translation/rotation through direct pointer interaction.
- Translation and rotation are visual-first; numeric values can remain available inside the revealable tools drawer for precision, but they are not the primary always-visible controls.
- Existing implant world position and rotation state remain authoritative. The gizmo edits the same `x/y/z/rx/ry/rz` values already used by the planning engine.
- The gizmo must not imply automatic anatomical registration or clinical validation.

Initial interaction scope:

1. Click/select active implant in the planning workflow.
2. Manipulator becomes active for that implant.
3. Drag axis/handle to move or rotate the implant.
4. Releasing commits the updated transform through the existing implant-change callback.
5. Numeric precision controls remain available in the drawer as a fallback.

## Current capabilities preserved

The redesign must preserve:

- MPR axial/coronal/sagittal navigation.
- Tangential and panoramic reconstruction.
- Crosshair synchronization.
- Brightness/contrast and presets.
- Manual/assisted arch curve.
- Nerve/foramen tools.
- Measurements.
- Implant placement, active implant selection, movement and rotation.
- Real implant geometry runtime + parametric fallback.
- Local RAR/ZIP implant-library drawer/import flow.
- 3D performance profiles for desktop/tablet/phone.
- Existing export/PDF feature, moved out of the permanent primary layout.

## Responsive behavior

Desktop is the reference implementation.

Tablet:
- 3D remains prominent when enabled.
- Drawer opens as an overlay.
- Dragging uses pointer events and receives explicit move controls as a touch fallback.
- Grid may reduce to fewer simultaneous columns where width requires it.

Phone:
- Do not attempt the full five-pane desktop workstation simultaneously.
- Preserve the current performance-aware mobile behavior and expose panes through maximized/stacked navigation.
- This milestone must not regress existing mobile access to DICOM images.

## Architecture

Primary files expected to change:

- `apps/web/src/Viewer2.jsx` — layout state, viewport slot order, drawer state, maximize/restore integration.
- `apps/web/src/Viewer3DPanel.jsx` — visual implant gizmo and removal/reduction of always-visible transform chrome.
- `apps/web/src/styles.css` — new workstation grid, drawer, drag/drop and responsive styling.

New isolated helpers/components are preferred where practical to avoid growing `Viewer2.jsx` further. Candidate modules:

- `ViewerWorkspaceLayout.jsx` / helper for ordered slots and drag/swap behavior.
- `ImplantTransformGizmo.jsx` for the visual manipulator.

The layout layer must not duplicate DICOM calculations or create new implant state outside the existing `Viewer2`/`Viewer3DPanel` flow.

## State model

New UI-only state may include:

- `workspaceSlots`: ordered pane IDs / slot mapping.
- `toolDrawerOpen`: boolean.
- `maximizedPane`: pane ID or null (can reuse current expanded state).
- `draggedPane`: transient only; avoid persisting clinical state.

Default slot mapping is deterministic and resettable.

Persistence across browser sessions is optional and out of scope for the first pass unless it can be implemented safely without affecting clinical state.

## Testing gates

Automated tests must cover layout logic separately from imaging code where possible:

- Default slot ordering matches the approved composition.
- Swapping panes produces deterministic slot order.
- Reset returns the default layout.
- Drawer open/close state does not alter viewer/implant state.
- Maximize/restore preserves slot assignment.
- Implant gizmo translates/rotates the existing active implant state without creating a second transform model.

Existing gates remain mandatory:

- Implant-library test suite GREEN.
- Web build GREEN.
- Geometry-lab WebGL smoke GREEN.
- Viewer implant-geometry WebGL smoke GREEN.

Add a new visual smoke for the workstation layout confirming:

- five approved panes are present;
- 3D is in the dominant lower-left slot by default;
- panoramic is lower-right;
- tool drawer opens and closes;
- one pane can be swapped with another;
- one pane can maximize and restore;
- implant manipulator is visible when an implant is active;
- browser console has no uncaught exceptions.

## Non-goals

- No rewrite of the DICOM rendering engine.
- No change to implant clinical geometry rules.
- No automatic implant positioning.
- No claim of clinical validation from the new gizmo.
- No free-floating desktop-window system.
- No removal of export/PDF functionality; it is only de-emphasized/re-homed.
- No new server/database schema required for layout state.

## Success criteria

The milestone is complete when production `/viewer2` visually matches the approved 3D-first concept, the 3D viewport is the dominant planning surface, diagnostic panes can swap positions and maximize/restore, the side tool stack is revealable rather than permanent, and the active implant can be manipulated through the visual 3D gizmo while all current viewer/implant/library CI gates remain GREEN.