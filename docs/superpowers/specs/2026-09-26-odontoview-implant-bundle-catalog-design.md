# OdontoView Implant Bundle Catalog — Design

Date: 2026-09-26
Branch: `feat/entrega-1-odonto-view-network`

## Goal

Turn the validated implant-library parser from Milestone 1 into a package-level ingestion and catalog pipeline that can inspect a real exocad-style implant bundle, classify each library entry, resolve its referenced geometry, and produce an OdontoView catalog that later planning code can consume without knowing the source package layout.

This milestone remains isolated from the Viewer UI. It prepares a trusted catalog boundary; it does not yet place manufacturer meshes in the 3D scene.

## Validated baseline

Milestone 1 already provides:

- exocad `ImplantLibraryEntry` XML parsing;
- normalization to OdontoView implant-library schema v1;
- conservative metadata inference;
- source provenance and signatures;
- deterministic output;
- bundle auditing with imported / unsupported / invalid entry states;
- geometry resolution with resolved / missing / ambiguous states;
- case-insensitive geometry path matching while preserving the original package path.

A real SIN bundle has already exposed two important production requirements:

1. a single package can contain multiple XML root families, so unsupported roots must be classified rather than coerced into schema v1;
2. source XML and archive filenames can disagree only by letter case (`.stl` versus `.STL`), so path resolution must be case-insensitive while collision detection remains explicit.

## Scope

Milestone 2 covers the pipeline:

`bundle manifest -> entry classification -> XML import -> geometry resolution -> catalog assembly -> catalog validation`

It does not cover:

- archive decompression in browser or server;
- database persistence;
- Viewer UI changes;
- implant placement with imported STL;
- redistribution/licensing decisions;
- surgical guide libraries;
- automatic geometry validation;
- manufacturer authorization claims.

Archive extraction remains an adapter concern. The core catalog module receives a manifest of paths plus XML text for candidate config entries.

## Architecture

Keep the subsystem under `apps/web/src/library/implant/` and preserve the current parser boundary.

### Existing units

- `parseExocadLibrary.js`
  - XML -> source representation
- `normalizeImplantLibrary.js`
  - source representation -> schema v1 library
- `inferLibraryMetadata.js`
  - conservative semantic inference
- `schema.js`
  - schema v1 validation
- `auditImplantLibraryBundle.js`
  - package-level entry and geometry audit

### New units

#### `buildImplantCatalog.js`

Consumes an audit report and returns a catalog containing only successfully imported libraries.

Responsibilities:

- exclude unsupported and invalid XML entries from the usable catalog while preserving them in catalog diagnostics;
- assign stable catalog entry IDs from normalized source identity, not array position;
- retain manufacturer, system, component, variant, geometry, coordinate-frame, constraint, warning, and provenance data;
- attach geometry resolution state to each geometry asset;
- never silently drop unresolved or ambiguous geometry references;
- produce deterministic ordering.

#### `catalogSchema.js`

Defines catalog schema version 1 and validates package-level invariants.

The catalog validator must detect:

- duplicate catalog entry IDs;
- duplicate component/variant IDs within a library;
- geometry assets without source filenames;
- geometry references whose resolution state is invalid;
- a `resolved` asset without an actual matched package path;
- an `ambiguous` asset without at least two candidates;
- inconsistent summary counts.

#### `catalogSelectors.js`

Pure read helpers for later planning code. No React dependency.

Initial selectors:

- list manufacturers;
- list systems for a manufacturer;
- list component families for a system;
- list variants for a component family;
- find geometry assets for a variant;
- expose only geometry assets with `resolution === resolved` when a caller explicitly asks for loadable geometry.

Selectors must not infer compatibility that the source did not state.

## Catalog data model

Package-level shape:

```json
{
  "catalogSchemaVersion": 1,
  "source": {
    "kind": "implant-library-bundle",
    "name": "SIN_EXO_COMPLETA_v3_Global_2023"
  },
  "summary": {
    "totalEntries": 55,
    "importedEntries": 53,
    "unsupportedEntries": 2,
    "invalidEntries": 0,
    "geometryReferences": 970,
    "resolvedGeometryFiles": 970,
    "missingGeometryFiles": 0,
    "ambiguousGeometryFiles": 0
  },
  "libraries": [],
  "diagnostics": {
    "unsupportedEntries": [],
    "invalidEntries": [],
    "warnings": []
  }
}
```

The numeric example documents the currently observed SIN package baseline. Tests must not hardcode those counts unless they run against an intentionally checked-in reduced fixture representing that case.

### Catalog library entry

Each imported audit entry becomes one catalog library entry:

- `id`
- `sourcePath`
- `manufacturer`
- `system`
- `components`
- `signatures`
- `warnings`
- `provenance`

The normalized schema v1 library remains intact. The catalog layer enriches geometry assets with package-resolution metadata rather than rewriting clinical semantics.

### Geometry resolution metadata

Each catalog geometry asset receives:

- `reference`
- `role`
- `resolution`
  - `resolved`
  - `missing`
  - `ambiguous`
- `matchedPath` when resolved
- `candidates` when ambiguous

`matchedPath` preserves the exact package path spelling/case.

## Stable identity

IDs must be deterministic for the same normalized source data.

Use a canonical string derived from stable source identity fields such as:

- manufacturer name;
- system name;
- source config path;
- component keyword/display information;
- variant keyword/display information.

Do not use random UUIDs and do not use array indexes as durable IDs.

If two source entries normalize to the same proposed catalog ID, validation must fail rather than merge them silently.

## Data flow

1. An external adapter enumerates package paths and provides XML text for candidate `config.xml` entries.
2. `auditImplantLibraryBundle()` imports each supported XML and records unsupported/invalid entries.
3. The auditor resolves every normalized geometry reference against the package manifest.
4. `buildImplantCatalog()` converts imported audit entries into deterministic catalog entries and copies diagnostics for non-imported entries.
5. `validateImplantCatalog()` checks package-level invariants.
6. Selectors expose read-only manufacturer/system/component/variant navigation for future planning code.
7. A later milestone may connect only validated, resolved geometry assets to the 3D planning layer.

No Viewer code participates in steps 1-6.

## Error handling

### Unsupported XML root

Classification: diagnostic, not fatal to the entire bundle.

Example: `ModelLabAnalogEntries` remains visible in diagnostics and is excluded from schema v1 libraries.

### Invalid XML or invalid normalized library

Classification: invalid entry. Other independent entries continue processing.

### Missing geometry

The library remains in the catalog, but the affected geometry asset is marked `missing`. The catalog is valid because missing source files are an observed package condition, not a parser corruption.

### Ambiguous geometry

The library remains in the catalog, but the affected asset is marked `ambiguous` with candidate paths. No automatic choice is permitted.

### Case-only path differences

Resolve case-insensitively. Preserve the actual package path. If multiple case-insensitive matches exist, classify as ambiguous.

### Catalog invariant failure

Catalog construction throws a stable catalog validation error and does not return a partially trusted catalog object.

## Safety and provenance

The catalog must preserve the Milestone 1 defaults:

- `validatedGeometry = false` unless a later explicit validation process changes it;
- `redistributionAllowed = unknown` unless separately established;
- source supplier and filenames remain intact;
- signatures remain intact when supplied;
- no source file is considered clinically/manufacturer validated merely because it resolves successfully.

A successfully resolved STL means only: “the referenced source file exists in the package.”

## Testing strategy

Use TDD for every behavior change.

### Unit tests

`buildImplantCatalog.test.js`:

- includes imported entries;
- excludes unsupported/invalid entries from `libraries` but preserves their diagnostics;
- attaches resolved geometry paths;
- preserves missing geometry;
- preserves ambiguous candidates;
- is deterministic;
- rejects ID collisions.

`catalogSchema.test.js`:

- accepts a minimal valid catalog;
- rejects duplicate IDs;
- rejects malformed resolution metadata;
- rejects inconsistent summary counts.

`catalogSelectors.test.js`:

- manufacturer -> system -> component -> variant navigation;
- resolved-only geometry selection;
- unknown metadata remains unknown and is not inferred by selectors.

### Integration fixture

Add a reduced mixed-bundle fixture that contains:

- at least two supported `ImplantLibraryEntry` configs;
- one unsupported root;
- one case-only STL filename mismatch;
- one intentionally missing geometry;
- one intentionally ambiguous geometry basename.

The fixture must be small enough for the repository and must not include proprietary geometry copied from the real commercial bundle. Synthetic/empty path placeholders are sufficient because this milestone validates catalog relationships, not mesh contents.

### CI gate

The existing `test:implant-library` command must include catalog tests, followed by the production web build.

## Success criteria

Milestone 2 is complete when:

1. a mixed package audit can be converted into catalog schema v1;
2. supported libraries remain fully navigable by manufacturer/system/component/variant;
3. unsupported and invalid XML entries remain visible as diagnostics without poisoning valid entries;
4. every geometry asset carries explicit resolved/missing/ambiguous state;
5. case-insensitive path resolution is regression-tested;
6. no ambiguous geometry is selected automatically;
7. catalog output is deterministic;
8. catalog schema validation catches identity/resolution corruption;
9. the catalog can be consumed without importing React or Viewer code;
10. all implant-library tests and the production web build pass.

## Explicit next boundary

After Milestone 2, the next separate design will cover the planner bridge:

`catalog selector -> trusted geometry loader -> coordinate-frame transform -> 3D implant/component preview`

That bridge must not be implemented inside this milestone. It will require its own validation rules for geometry loading, units, origin/orientation, coordinate transforms, and safe fallback to parametric geometry.
