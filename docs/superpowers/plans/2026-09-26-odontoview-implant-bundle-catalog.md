# OdontoView Implant Bundle Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build catalog schema v1 from a package audit so OdontoView can navigate imported implant libraries and explicitly track resolved, missing, and ambiguous geometry without involving Viewer code.

**Architecture:** Keep the existing XML parser/normalizer and bundle auditor unchanged as the source boundary. Add a catalog builder that enriches normalized geometry with audit resolution state, a package-level validator that protects identity and resolution invariants, and pure selectors for manufacturer/system/component/variant navigation. Expose the catalog API from the existing implant-library `index.js` only after unit and mixed-bundle integration tests pass.

**Tech Stack:** JavaScript ESM, Node.js test runner, `fast-xml-parser` through the existing importer, Vite 6.1.0 build.

**Spec:** `docs/superpowers/specs/2026-09-26-odontoview-implant-bundle-catalog-design.md`

## Global Constraints

- Work only on branch `feat/entrega-1-odonto-view-network`.
- Do not modify Viewer UI or place imported manufacturer meshes in the 3D scene.
- Do not add archive decompression, database persistence, guide CAD, or automatic geometry validation.
- Preserve `validatedGeometry=false` unless an explicit later validation process changes it.
- Preserve `redistributionAllowed=unknown` unless separately established.
- Missing and ambiguous geometry are valid observed package states; they must not be silently dropped or auto-selected.
- Case-insensitive path matching must preserve the exact source package path spelling/case.
- IDs must be deterministic and must not use random UUIDs or array indexes as durable identity.
- Do not infer new clinical compatibility or dimensions in the catalog/selectors layer.
- Every behavior change follows RED -> minimal GREEN -> full implant-library suite -> production web build.

## Review Focus

1. **Duplicate source identity across different config paths:** catalog construction must reject a real ID collision instead of merging entries; pinned in Task 2 collision tests.
2. **Malformed audit geometry state:** a `resolved` reference without `matchedPath`, or `ambiguous` without at least two candidates, must fail catalog validation; pinned in Task 1 resolution tests.
3. **Mixed-case duplicate package paths:** the catalog must preserve auditor ambiguity rather than collapsing case-only collisions; pinned in Task 2 geometry enrichment tests.
4. **Incomplete/unknown source metadata:** selectors must keep unknown values unknown and still navigate using stable normalized fields; pinned in Task 3 selector tests.
5. **Summary drift after filtering unsupported/invalid entries:** catalog summary must remain the bundle audit summary and validator must reject inconsistent library/diagnostic counts; pinned in Task 1 summary tests and Task 4 mixed-bundle test.

---

## File Structure

### Create

- `apps/web/src/library/implant/catalogSchema.js` — catalog schema version, validation, and stable catalog validation error.
- `apps/web/src/library/implant/catalogSchema.test.js` — package-level invariant tests.
- `apps/web/src/library/implant/buildImplantCatalog.js` — audit report -> deterministic catalog v1.
- `apps/web/src/library/implant/buildImplantCatalog.test.js` — catalog assembly and geometry enrichment tests.
- `apps/web/src/library/implant/catalogSelectors.js` — pure read-only catalog navigation helpers.
- `apps/web/src/library/implant/catalogSelectors.test.js` — navigation and resolved-only geometry tests.
- `apps/web/src/library/implant/catalog-mixed-bundle.fixture.js` — small synthetic mixed package manifest; no proprietary mesh bytes.
- `apps/web/src/library/implant/catalogIntegration.test.js` — auditor -> catalog -> validator -> selector integration test.

### Modify

- `apps/web/src/library/implant/index.js` — export the catalog builder/schema/selectors as the implant-library public API after all behavior is covered.

No package script change is required because `apps/web/package.json` already runs `node --test src/library/implant/*.test.js`.

---

### Task 1: Catalog schema and invariants

**Files:**
- Create: `apps/web/src/library/implant/catalogSchema.js`
- Create: `apps/web/src/library/implant/catalogSchema.test.js`

**Interfaces:**
- Consumes: plain catalog object produced later by `buildImplantCatalog(auditReport, options)`.
- Produces: `IMPLANT_CATALOG_SCHEMA_VERSION = 1`, `validateImplantCatalog(catalog) -> { valid, errors }`, and `ImplantCatalogValidationError` for builder/public-API use.

- [ ] **Step 1: Write the failing minimal-valid-catalog test**

Create a catalog with `catalogSchemaVersion: 1`, one library, one resolved geometry asset, and matching summary/diagnostic counts. Assert `validateImplantCatalog(catalog).valid === true`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `cd apps/web && node --test src/library/implant/catalogSchema.test.js`

Expected: FAIL because `catalogSchema.js` does not exist or the exported validator is missing.

- [ ] **Step 3: Implement the minimal schema/version validator**

Implement `validateImplantCatalog(catalog)` with checks for schema version, `libraries` array, `diagnostics` object, and integer summary fields used by the spec.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `cd apps/web && node --test src/library/implant/catalogSchema.test.js`

Expected: PASS.

- [ ] **Step 5: Add RED tests for identity, geometry-resolution, and summary invariants**

Add assertions that validation fails for:
- duplicate library IDs;
- duplicate component/variant IDs inside a library;
- geometry asset without filename/reference;
- `resolution: 'resolved'` without `matchedPath`;
- `resolution: 'ambiguous'` with fewer than two candidates;
- a resolution value outside `resolved | missing | ambiguous`;
- summary counts inconsistent with `libraries` and diagnostics.

- [ ] **Step 6: Run the focused tests and confirm only the new invariant cases fail**

Run: `cd apps/web && node --test src/library/implant/catalogSchema.test.js`

Expected: existing minimal case PASS; newly added invariant cases FAIL.

- [ ] **Step 7: Implement the minimal invariant checks**

Keep validation read-only and deterministic. Reuse normalized-library assumptions instead of re-parsing clinical metadata.

- [ ] **Step 8: Run focused and full implant-library tests**

Run:
- `cd apps/web && node --test src/library/implant/catalogSchema.test.js`
- `cd apps/web && npm run test:implant-library`

Expected: all PASS.

- [ ] **Step 9: Commit Task 1**

Commit message: `feat(implant-library): add catalog schema validation`

---

### Task 2: Build deterministic catalog from audit report

**Files:**
- Create: `apps/web/src/library/implant/buildImplantCatalog.js`
- Create: `apps/web/src/library/implant/buildImplantCatalog.test.js`
- Use: `apps/web/src/library/implant/catalogSchema.js`
- Use: `apps/web/src/library/implant/auditImplantLibraryBundle.js`

**Interfaces:**
- Consumes: `buildImplantCatalog(auditReport, { sourceName = null } = {})`, where `auditReport` is the current `{ summary, entries }` result from `auditImplantLibraryBundle()`.
- Produces: validated catalog schema v1 with `{ catalogSchemaVersion, source, summary, libraries, diagnostics }` and geometry assets enriched with `{ reference, resolution, matchedPath?, candidates? }`.

- [ ] **Step 1: Write RED tests for imported versus diagnostic entries**

Create a synthetic audit report containing one imported, one unsupported, and one invalid entry. Assert:
- `libraries.length === 1`;
- unsupported/invalid entries are absent from `libraries`;
- both remain under `diagnostics`;
- `summary` is preserved;
- `source.kind === 'implant-library-bundle'`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `cd apps/web && node --test src/library/implant/buildImplantCatalog.test.js`

Expected: FAIL because builder is missing.

- [ ] **Step 3: Implement minimal catalog assembly and validation gate**

Implement `buildImplantCatalog()` so it copies the normalized library data, adds `sourcePath`, creates a deterministic library ID from stable normalized source identity fields, copies diagnostics, then calls `validateImplantCatalog()` before returning.

Use a canonical-string + deterministic hash/slug helper local to this module; do not use random UUIDs or array positions.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `cd apps/web && node --test src/library/implant/buildImplantCatalog.test.js`

Expected: PASS.

- [ ] **Step 5: Add RED geometry enrichment tests**

Cover all three states from one imported audit entry:
- resolved geometry attaches exact `matchedPath` preserving original case;
- missing geometry remains present with `resolution: 'missing'`;
- ambiguous geometry remains present with all candidates;
- case-only ambiguous candidates are not collapsed;
- geometry assets not referenced by the audit report are not silently treated as resolved.

- [ ] **Step 6: Run focused tests and confirm geometry cases fail before enrichment exists**

Run: `cd apps/web && node --test src/library/implant/buildImplantCatalog.test.js`

Expected: new geometry assertions FAIL.

- [ ] **Step 7: Implement geometry enrichment by reference and role**

Match catalog assets to auditor geometry items using normalized reference filename plus role. Copy resolution metadata only; preserve normalized clinical/provenance fields exactly.

- [ ] **Step 8: Add RED determinism and collision tests**

Assert:
- identical input twice produces `deepEqual` catalog output;
- two imported entries that intentionally generate the same proposed catalog ID cause `ImplantCatalogValidationError` rather than merge;
- source path participates in stable entry identity so distinct real config paths do not collide accidentally.

- [ ] **Step 9: Implement stable identity/collision behavior and verify GREEN**

Run:
- `cd apps/web && node --test src/library/implant/buildImplantCatalog.test.js`
- `cd apps/web && npm run test:implant-library`

Expected: all PASS.

- [ ] **Step 10: Commit Task 2**

Commit message: `feat(implant-library): build deterministic bundle catalog`

---

### Task 3: Pure catalog selectors

**Files:**
- Create: `apps/web/src/library/implant/catalogSelectors.js`
- Create: `apps/web/src/library/implant/catalogSelectors.test.js`

**Interfaces:**
- Consumes: validated catalog schema v1.
- Produces:
  - `listCatalogManufacturers(catalog)`
  - `listCatalogSystems(catalog, manufacturerId)`
  - `listCatalogComponents(catalog, systemId)`
  - `listCatalogVariants(catalog, componentId)`
  - `getVariantGeometryAssets(catalog, variantId, { resolvedOnly = false } = {})`

- [ ] **Step 1: Write RED navigation tests**

Use a catalog with two manufacturers/systems and explicit unknown metadata. Assert manufacturer -> system -> component -> variant navigation returns only matching entities and does not promote/infer unknown clinical attributes.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `cd apps/web && node --test src/library/implant/catalogSelectors.test.js`

Expected: FAIL because selectors are missing.

- [ ] **Step 3: Implement the five pure selectors**

Selectors must be React-free, side-effect-free, preserve catalog order, and return empty arrays for unknown IDs.

- [ ] **Step 4: Add RED resolved-only geometry test**

Assert `getVariantGeometryAssets(..., { resolvedOnly: true })` returns only assets with `resolution === 'resolved'` and a `matchedPath`; default mode returns resolved/missing/ambiguous assets.

- [ ] **Step 5: Implement resolved-only filtering and verify GREEN**

Run:
- `cd apps/web && node --test src/library/implant/catalogSelectors.test.js`
- `cd apps/web && npm run test:implant-library`

Expected: all PASS.

- [ ] **Step 6: Commit Task 3**

Commit message: `feat(implant-library): add catalog selectors`

---

### Task 4: Synthetic mixed-bundle integration and public API

**Files:**
- Create: `apps/web/src/library/implant/catalog-mixed-bundle.fixture.js`
- Create: `apps/web/src/library/implant/catalogIntegration.test.js`
- Modify: `apps/web/src/library/implant/index.js`
- Use: `apps/web/src/library/implant/auditImplantLibraryBundle.js`
- Use: `apps/web/src/library/implant/buildImplantCatalog.js`
- Use: `apps/web/src/library/implant/catalogSelectors.js`

**Interfaces:**
- Consumes: synthetic package entries and available file paths.
- Produces: end-to-end callable implant library API without React/Viewer dependencies.

- [ ] **Step 1: Create the small synthetic mixed-bundle fixture**

Include:
- two supported synthetic `ImplantLibraryEntry` XML configs;
- one unsupported `ModelLabAnalogEntries` config;
- one geometry reference whose file differs only by `.stl`/`.STL` case;
- one intentionally missing geometry file;
- one intentionally ambiguous geometry basename with two candidates.

Do not include proprietary mesh bytes; paths are sufficient.

- [ ] **Step 2: Write the RED end-to-end integration test**

Flow:
1. call `auditImplantLibraryBundle(fixture)`;
2. call `buildImplantCatalog(audit, { sourceName: 'synthetic-mixed-bundle' })`;
3. assert catalog validates;
4. assert 2 imported libraries remain navigable;
5. assert unsupported entry appears only in diagnostics;
6. assert case-only path resolves and exact package case is preserved;
7. assert missing and ambiguous assets remain explicit;
8. assert selector resolved-only mode excludes missing/ambiguous assets;
9. assert catalog summary matches the audit summary.

- [ ] **Step 3: Run integration test to verify RED before public exports**

Run: `cd apps/web && node --test src/library/implant/catalogIntegration.test.js`

Expected: FAIL if the intended public exports are not available yet.

- [ ] **Step 4: Export catalog API from `index.js`**

Export:
- `IMPLANT_CATALOG_SCHEMA_VERSION`
- `validateImplantCatalog`
- `ImplantCatalogValidationError`
- `buildImplantCatalog`
- all five selectors

Do not import React or Viewer code.

- [ ] **Step 5: Run focused integration and complete implant-library suite**

Run:
- `cd apps/web && node --test src/library/implant/catalogIntegration.test.js`
- `cd apps/web && npm run test:implant-library`

Expected: all PASS, zero failures/skips.

- [ ] **Step 6: Run production web build**

Run: `cd apps/web && npm run build`

Expected: exit 0. Existing non-module viewer-script/chunk-size warnings may remain; no new catalog build error is allowed.

- [ ] **Step 7: Commit Task 4**

Commit message: `feat(implant-library): expose validated bundle catalog`

---

### Task 5: Final verification against the Milestone 2 contract

**Files:**
- No new production files expected.
- Review all files added/modified in Tasks 1-4.

**Interfaces:**
- Consumes: completed branch implementation.
- Produces: verification evidence that the branch satisfies the Milestone 2 spec without Viewer integration.

- [ ] **Step 1: Run the full implant-library test command fresh**

Run: `cd apps/web && npm run test:implant-library`

Expected: all tests PASS, zero failures.

- [ ] **Step 2: Run production build fresh**

Run: `cd apps/web && npm run build`

Expected: exit 0.

- [ ] **Step 3: Review the branch diff for scope**

Verify no Viewer/3D placement files, database files, or archive-decompression dependencies were introduced.

- [ ] **Step 4: Verify catalog safety defaults and resolution semantics in test output/code review**

Confirm:
- resolved means source file existence only;
- `validatedGeometry` is not promoted to true;
- `redistributionAllowed` is not promoted from unknown;
- ambiguous geometry is never auto-selected;
- missing geometry remains visible.

- [ ] **Step 5: Record the final commit SHA and GitHub Actions result**

Only declare Milestone 2 GREEN after the branch's workflow run for the final commit completes successfully, including `Web implant library tests` and `Web build`.
