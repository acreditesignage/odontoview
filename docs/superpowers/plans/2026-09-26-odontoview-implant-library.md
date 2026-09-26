# OdontoView Implant Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested standalone parser/normalizer that converts exocad-style implant `config.xml` content into deterministic OdontoView JSON without changing Viewer2 or importing source STL/SDFA assets.

**Architecture:** A small browser/Node-compatible library under `apps/web/src/library/implant/` will parse XML into a source-neutral intermediate object, then normalize manufacturer/system/components/variants/geometries/coordinate data into schema version 1. Conservative inference helpers extract only explicit height/size/design/rotation metadata; ambiguous values remain source metadata plus warnings.

**Tech Stack:** JavaScript ES modules, Node 22 built-in test runner, `fast-xml-parser`, Vite 6.

**Spec:** `docs/superpowers/specs/2026-09-26-odontoview-implant-library-design.md`

## Global Constraints

- Do not modify `Viewer2.jsx` or production planning UI in this milestone.
- Do not import or commit the user's STL/SDFA library assets.
- Preserve source filenames, supplier metadata, vectors, offsets, signatures, and explicit constraints.
- `validatedGeometry` defaults to `false`.
- `redistributionAllowed` defaults to `unknown`.
- XML semantics outrank display/keyword metadata; filename heuristics are fallback only.
- Missing fields are valid; ambiguous metadata produces warnings instead of guesses.
- Main parser must not branch on manufacturer names.

## Review Focus

- Missing optional XML blocks must produce valid output rather than throwing.
- One XML element vs repeated XML elements must normalize to the same array shape.
- Numeric/vector fields supplied as strings, empty values, or malformed values must not silently become valid zeroes.
- Referenced geometry roles must remain distinct (`implant`, `marker`, `support`, `interface`, `screw`).
- Metadata inference must not mislabel ambiguous numbers in filenames as clinical dimensions.

---

### Task 1: Test Harness and Schema Contract

**Files:**
- Modify: `apps/web/package.json`
- Modify: `.github/workflows/entrega1-network-ci.yml`
- Create: `apps/web/src/library/implant/schema.js`
- Create: `apps/web/src/library/implant/schema.test.js`

**Interfaces:**
- Produces: `IMPLANT_LIBRARY_SCHEMA_VERSION`, `createEmptyLibrary()`, `validateNormalizedLibrary(library)`.
- Later tasks rely on schema version `1` and validation returning `{valid:boolean, errors:string[]}`.

- [ ] **Step 1: Write failing schema tests**

Create tests proving: schema version is `1`; empty normalized library carries `validatedGeometry:false`/`redistributionAllowed:"unknown"` defaults; validator rejects missing manufacturer/system and accepts a minimal valid library.

- [ ] **Step 2: Run tests and verify failure**

Run: `cd apps/web && npm run test:implant-library`

Expected: FAIL because the script/module does not yet exist.

- [ ] **Step 3: Add test dependency/runtime wiring**

Add `fast-xml-parser` dependency and `test:implant-library` script using Node's built-in test runner. Add a CI step named `Web implant library tests` before `Web build`.

- [ ] **Step 4: Implement schema helpers**

Implement `createEmptyLibrary()` and `validateNormalizedLibrary(library)` in `schema.js` with the exact defaults and contract above.

- [ ] **Step 5: Run tests and build**

Run: `cd apps/web && npm run test:implant-library && npm run build`

Expected: all tests PASS and Vite build succeeds.

- [ ] **Step 6: Commit**

Commit message: `test(implant-library): add schema contract and harness`

---

### Task 2: Generic exocad XML Parser

**Files:**
- Create: `apps/web/src/library/implant/parseExocadLibrary.js`
- Create: `apps/web/src/library/implant/parseExocadLibrary.test.js`
- Create: `apps/web/src/library/implant/fixtures/implacil-minimal.xml`
- Create: `apps/web/src/library/implant/fixtures/sin-minimal.xml`
- Create: `apps/web/src/library/implant/fixtures/neodent-minimal.xml`

**Interfaces:**
- Consumes: raw XML string.
- Produces: `parseExocadLibrary(xmlText) -> {source, warnings}` where `source` is manufacturer-agnostic and preserves root metadata, type configs, subtype configs, geometry references, vectors, numeric constraints, and signatures.

- [ ] **Step 1: Add three reduced fixtures**

Create small fixtures modeled only on the observed structures needed for tests: Implacil marker/support/interface plus 1.0/2.0/3.0 variants; SIN marker/screw/implant plus standard/+0.02/+0.04/+0.06 and max screw angle; Neodent Hex/Rot plus Link SMALL/LARGE/open/closed height variants. Do not copy signatures, warranty text, or full vendor files.

- [ ] **Step 2: Write failing parser tests**

Assert supplier/system display fields, top-level geometry roles, nested type/subtype arrays, coordinate vectors, rotation fields, screw-angle constraint, and preservation of missing optional fields.

Add regression tests for single-vs-multiple `ImplantTypeConfig` and malformed numeric vector values producing warnings.

- [ ] **Step 3: Run parser tests and verify failure**

Run: `cd apps/web && node --test src/library/implant/parseExocadLibrary.test.js`

Expected: FAIL because parser is not implemented.

- [ ] **Step 4: Implement `parseExocadLibrary(xmlText)`**

Use `fast-xml-parser` with explicit array handling for `ImplantTypeConfig`, `ImplantSubtypeConfig`, and `FileSignature`. Preserve raw source display/keyword values and parse vectors/numeric fields with `null` on malformed values plus warnings.

- [ ] **Step 5: Run parser tests**

Run: `cd apps/web && node --test src/library/implant/parseExocadLibrary.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(implant-library): parse exocad library xml`

---

### Task 3: Conservative Metadata Inference

**Files:**
- Create: `apps/web/src/library/implant/inferLibraryMetadata.js`
- Create: `apps/web/src/library/implant/inferLibraryMetadata.test.js`

**Interfaces:**
- Produces: `inferVariantAttributes({displayInformation, keyword, filenames}) -> {attributes, warnings}`.
- Attributes may include only `heightMm`, `sizeClass`, `design`, `rotationMode`, and `dimensionOffsetMm` when explicit enough to support them.

- [ ] **Step 1: Write failing inference tests**

Assert: `Cinta 1.5mm SMALL` => `{heightMm:1.5,sizeClass:"SMALL"}`; `[Aberto]` => `design:"open"`; `[Fechado]` => `design:"closed"`; `Hex`/`Rot` => corresponding rotation mode; `+0.04mm` => `dimensionOffsetMm:0.04`; ambiguous filename-only numbers remain uninferred and produce a warning.

- [ ] **Step 2: Run inference tests and verify failure**

Run: `cd apps/web && node --test src/library/implant/inferLibraryMetadata.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement inference helper**

Parse explicit display/keyword tokens first; use filenames only when they contain an unambiguous labeled unit/token. Never infer implant diameter/length from naked numbers.

- [ ] **Step 4: Run inference tests**

Run: `cd apps/web && node --test src/library/implant/inferLibraryMetadata.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(implant-library): infer conservative component metadata`

---

### Task 4: Normalize to OdontoView Schema v1

**Files:**
- Create: `apps/web/src/library/implant/normalizeImplantLibrary.js`
- Create: `apps/web/src/library/implant/normalizeImplantLibrary.test.js`

**Interfaces:**
- Consumes: `{source, warnings}` from `parseExocadLibrary` and `inferVariantAttributes`.
- Produces: `normalizeImplantLibrary(parsed) -> {library, warnings}` conforming to schema v1.

- [ ] **Step 1: Write failing normalization tests**

For all three fixtures, assert deterministic manufacturer/system output, component family/variant grouping, geometry roles and filenames, coordinate-frame preservation, defaults, and warnings.

Specifically assert Implacil 1.0/2.0/3.0 marker/support/interface relationships, SIN standard/+0.02/+0.04/+0.06 distinction without clinical reinterpretation, and Neodent SMALL/LARGE + open/closed + height normalization.

- [ ] **Step 2: Run normalization tests and verify failure**

Run: `cd apps/web && node --test src/library/implant/normalizeImplantLibrary.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement `normalizeImplantLibrary(parsed)`**

Group types/subtypes without manufacturer-specific branches. Use stable IDs derived from normalized source names/keywords and array position only where source identifiers are absent. Preserve unknown source attributes under `sourceAttributes`.

- [ ] **Step 4: Validate output with schema helper**

Each fixture test must call `validateNormalizedLibrary(library)` and assert `valid === true`.

- [ ] **Step 5: Run complete library test suite**

Run: `cd apps/web && npm run test:implant-library`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(implant-library): normalize exocad libraries to schema v1`

---

### Task 5: Public Import API and Regression Verification

**Files:**
- Create: `apps/web/src/library/implant/index.js`
- Create: `apps/web/src/library/implant/index.test.js`

**Interfaces:**
- Produces: `importImplantLibraryXml(xmlText) -> {library, warnings}` as the single public API for later Viewer/admin integration.

- [ ] **Step 1: Write failing end-to-end tests**

For each fixture, call only `importImplantLibraryXml(xmlText)` and assert schema version `1`, valid output, non-empty component list, preserved source provenance, and deterministic repeated output.

Add invalid-XML and unsupported-root tests that throw typed errors with stable error codes `INVALID_XML` and `UNSUPPORTED_ROOT`.

- [ ] **Step 2: Run end-to-end tests and verify failure**

Run: `cd apps/web && node --test src/library/implant/index.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement the public API**

Compose parse -> normalize -> validate; merge warnings; expose typed parser errors. Do not expose internal parser-specific shapes through `index.js`.

- [ ] **Step 4: Run full verification**

Run: `cd apps/web && npm run test:implant-library && npm run build`

Expected: all implant-library tests PASS and Vite production build succeeds.

- [ ] **Step 5: Verify CI**

Push and confirm `Web implant library tests` and `Web build` are both successful in GitHub Actions.

- [ ] **Step 6: Commit**

Commit message: `feat(implant-library): expose normalized xml import api`

---

## Milestone Result

At completion, OdontoView has a standalone, tested XML import foundation capable of understanding the three observed exocad library structures without touching Viewer2, production database, STL/SDFA distribution, or surgical-guide CAD. The next milestone can safely add an admin/import preview UI or consume normalized implant geometry metadata in planning.