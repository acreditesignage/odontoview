# OdontoView Implant Geometry 3D — Milestone 3 Design

**Date:** 2026-09-26  
**Branch:** `feat/entrega-1-odonto-view-network`  
**Status:** Approved design, awaiting implementation plan review

## 1. Goal

Milestone 3 converts a resolved implant-library catalog asset into neutral 3D geometry, applies only explicit coordinate transformations, and renders the result in an isolated 3D test viewer.

The milestone must prove this pipeline:

`validated catalog -> resolved STL asset -> neutral mesh -> explicit transform -> isolated 3D visualization`

It must **not** place manufacturer geometry inside the production DICOM/CBCT Viewer yet.

## 2. Why this milestone exists

Milestone 2 proved that OdontoView can audit implant-library bundles, normalize their metadata, preserve diagnostics, and navigate manufacturer -> system -> component -> variant -> geometry asset without hiding `missing` or `ambiguous` source files.

Milestone 3 establishes the next boundary: whether a catalog asset that is actually present can be converted into geometry OdontoView controls independently of any particular rendering engine.

Keeping loading, transformation, and rendering separate prevents the implant library from becoming tightly coupled to VTK.js, React, the existing Viewer, or any future renderer.

## 3. Approved architecture

The approved sequence is:

### 3A — STL Loader

Input: one catalog geometry asset and the bytes for its resolved source file.

Responsibilities:
- accept only assets with `resolution === 'resolved'`;
- require a non-empty `matchedPath`;
- reject `missing` and `ambiguous` assets instead of choosing a source silently;
- detect STL ASCII versus STL Binary;
- parse triangle geometry;
- return a renderer-neutral mesh contract;
- preserve source identity/provenance;
- never promote clinical validation or redistribution rights.

### 3B — Coordinate Transformation

Input: a neutral mesh plus an explicit 4x4 transform or explicit transform components.

Responsibilities:
- default to identity transformation;
- apply only supplied transformations;
- transform vertex positions;
- transform normals correctly without applying translation to normals;
- keep mesh topology unchanged;
- expose the exact matrix applied;
- avoid guessing axis orientation, handedness, units, scale, or clinical placement.

### 3C — Isolated 3D Viewer

Input: transformed neutral mesh.

Responsibilities:
- render the mesh in a standalone geometry test surface;
- provide orbit, zoom, and pan;
- show reference axes;
- display basic mesh/source information;
- permit choosing another resolved catalog variant during testing;
- remain isolated from the production DICOM/CBCT Viewer.

## 4. Architectural boundaries

### In scope

- STL ASCII loading.
- STL Binary loading.
- Geometry validation sufficient to reject structurally invalid/corrupt STL input.
- Neutral arrays for positions, normals, and indices.
- Explicit 4x4 transformation support.
- Identity, rotation, and translation test cases.
- Isolated 3D rendering test surface.
- Selection of a resolved catalog asset through existing catalog selectors.
- Deterministic error codes and deterministic mesh output.

### Explicitly out of scope

- Integration into the production Viewer.
- Implant placement inside CBCT/DICOM coordinates.
- Surgical guide CAD.
- Collision analysis.
- Automatic implant positioning.
- Automatic unit conversion.
- Guessing orientation from STL geometry.
- Automatic clinical validation of a manufacturer's mesh.
- Changing `validatedGeometry` from `false`.
- Changing `redistributionAllowed` from `unknown` without separate evidence.
- Decoding SDFA.
- Publishing or committing proprietary commercial STL/SDFA assets into the public repository.
- Archive decompression in the application.

## 5. Geometry input gate

A geometry asset is loadable only when all of the following are true:

1. it is a catalog asset object;
2. `resolution === 'resolved'`;
3. `matchedPath` is a non-empty string;
4. the supplied source bytes correspond to that requested source path at the caller boundary;
5. the asset is an STL source supported by this milestone.

`missing` and `ambiguous` are valid catalog states, but they are **not loadable geometry states**.

The loader must never pick an ambiguous candidate automatically.

## 6. Neutral mesh contract

The STL loader returns a renderer-independent object shaped conceptually as:

```js
{
  geometrySchemaVersion: 1,
  source: {
    assetId,
    sourcePath,
    filename,
    format: 'stl-ascii' | 'stl-binary',
  },
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  vertexCount,
  triangleCount,
  bounds: {
    min: [x, y, z],
    max: [x, y, z],
  },
  safety: {
    validatedGeometry: false,
    redistributionAllowed: 'unknown' | 'allowed' | 'not-allowed',
  },
}
```

The contract is intentionally independent of VTK.js and Three.js.

### Mesh invariants

- `positions.length === vertexCount * 3`.
- `normals.length === vertexCount * 3`.
- `indices.length === triangleCount * 3`.
- every index is within `[0, vertexCount)`.
- positions and normals contain only finite numbers.
- `triangleCount > 0` for a successfully loaded mesh.
- bounds contain finite values and enclose all vertices.

The first implementation may emit one independent vertex per STL triangle corner rather than deduplicating vertices. Vertex welding is not required for this milestone.

## 7. STL format handling

### ASCII STL

The loader recognizes a structurally valid ASCII STL and extracts triangle facets and their vertices.

It must reject malformed facet/vertex structures instead of returning partial geometry silently.

### Binary STL

The loader reads:
- 80-byte header;
- 4-byte little-endian triangle count;
- 50-byte triangle records.

It verifies that the byte length is compatible with the declared triangle count before parsing the mesh.

### Format detection

Format detection must not rely solely on the first five bytes being `solid`, because valid binary STL headers may also begin with that text.

The detection strategy should use structural validation/expected binary length and fall back to ASCII parsing when appropriate.

If neither parser can establish a valid STL, loading fails with a stable error.

## 8. Normals

When a valid non-zero facet normal is supplied by STL, the loader may preserve it.

When a facet normal is absent, malformed, or zero-length, the loader computes a triangle normal from the vertices.

A degenerate triangle that cannot produce a valid normal must be rejected or explicitly reported; it must not introduce `NaN` values into the mesh.

## 9. Geometry error model

Use a dedicated error type with stable machine-readable codes.

Required error categories include:

- `UNRESOLVED_GEOMETRY` — asset is `missing`, `ambiguous`, or lacks a usable matched path.
- `UNSUPPORTED_GEOMETRY_FORMAT` — source is not supported by this milestone, including SDFA.
- `INVALID_STL` — source does not form a structurally valid STL.
- `TRUNCATED_BINARY_STL` — binary byte length is inconsistent with its triangle count.
- `INVALID_GEOMETRY_VALUE` — parsed coordinates or normals contain invalid numeric data.
- `DEGENERATE_GEOMETRY` — geometry cannot form a usable triangle mesh.
- `INVALID_TRANSFORM` — transformation matrix is missing required values or contains non-finite numbers.

Errors must not be inferred from manufacturer names or clinical metadata.

## 10. Transformation contract

The transformation layer operates only on neutral mesh geometry.

Primary interface concept:

```js
transformGeometry(mesh, matrix4x4)
```

### Matrix behavior

- default matrix is identity;
- matrix contains 16 finite numbers;
- positions use the full affine transform;
- normals use the linear orientation portion and are re-normalized;
- translation must not affect normals;
- indices remain unchanged;
- source metadata and safety metadata remain unchanged;
- transformed bounds are recomputed from transformed positions;
- output records the exact matrix applied.

### No hidden assumptions

The transform layer must not infer:
- millimeters versus another unit;
- patient coordinate system;
- maxilla versus mandible;
- left/right or superior/inferior orientation;
- implant long axis;
- clinical depth;
- CBCT alignment.

Those concerns belong to a later placement/alignment milestone.

## 11. Relationship to existing XML coordinate metadata

The existing implant-library parser preserves coordinate vectors and offsets from XML.

Milestone 3 may define adapters that convert **explicitly understood and tested** source transform metadata into a 4x4 matrix, but the generic transformer itself remains source-agnostic.

No source field should be assigned new clinical meaning merely because it resembles a translation, height, or rotation value.

If the semantics of a field are uncertain, it remains metadata and is not automatically applied.

## 12. Isolated 3D viewer design

The visualizer is a development/test surface, not the production implant-planning interface.

### Required controls

- orbit camera;
- zoom;
- pan;
- reset camera;
- XYZ reference axes;
- fit mesh to view.

### Required information display

- manufacturer/system/component/variant identity when available;
- source filename/matched path;
- STL format;
- vertex count;
- triangle count;
- bounds;
- active transform matrix or identity status;
- `validatedGeometry` state;
- `redistributionAllowed` state.

### Safety behavior

The visualizer may show a resolved mesh while still clearly retaining `validatedGeometry: false`.

Rendering successfully is **not evidence that the geometry is clinically correct**.

## 13. Renderer strategy

Three approaches were considered:

### A. Couple directly to the existing VTK/Viewer

Advantage: fastest path to seeing a mesh alongside current imaging code.

Rejected for this milestone because it couples catalog ingestion and geometry parsing directly to the most complex part of the application before the geometry contract is proven.

### B. Parse STL using a renderer-specific loader and retain renderer objects

Advantage: less custom parsing code.

Rejected as the core architecture because it makes renderer objects the persistence/interchange boundary and makes later testing or renderer changes harder.

### C. Neutral loader + neutral transformer + thin isolated renderer adapter

**Selected approach.**

Advantages:
- parser tests do not require WebGL;
- transformation tests do not require a browser;
- renderer can change independently;
- the same neutral mesh can later be handed to VTK.js for CBCT integration;
- failures can be isolated to loading, transformation, or rendering.

## 14. Catalog integration

Milestone 3 consumes the public catalog API completed in Milestone 2.

Expected navigation path:

`manufacturer -> system -> component -> variant -> getVariantGeometryAssets(..., { resolvedOnly: true })`

Only returned resolved assets are candidates for the geometry loader.

The catalog remains the source of identity and safety metadata. The loader does not create new manufacturer/system/component compatibility relationships.

## 15. Real commercial geometry handling

Real manufacturer STL files may be used locally for validation where the user has access to them.

They must not be added to the public repository unless redistribution rights have been independently established.

Public automated tests must use generated/synthetic STL fixtures small enough to review in source or create programmatically during tests.

## 16. Testing strategy

All production behavior follows RED -> minimal GREEN -> full implant-library suite -> production build.

### Loader tests

Must cover:
- minimal valid ASCII STL;
- minimal valid Binary STL;
- binary STL whose header begins with `solid`;
- truncated Binary STL;
- malformed ASCII STL;
- non-finite numeric values;
- zero/invalid facet normal fallback;
- unresolved catalog asset rejection;
- ambiguous catalog asset rejection;
- SDFA rejection as unsupported for this milestone;
- deterministic output for identical input.

### Transformer tests

Must cover:
- identity matrix leaves positions unchanged;
- translation changes positions but not normals;
- rotation changes positions and normals predictably;
- invalid/non-finite matrix rejected;
- transformed bounds recomputed;
- topology/indices preserved;
- source and safety metadata preserved.

### Integration test

A synthetic catalog asset with a resolved STL path must flow through:

`catalog selector -> STL loader -> transformer -> renderable neutral mesh`

The integration test must also verify that missing/ambiguous catalog assets cannot enter the loading path.

### Visual smoke test

The isolated viewer must successfully render a synthetic or redistributable test implant-like STL fixture and allow camera interaction.

Automated geometry correctness remains covered below the renderer layer; the visual surface is not a substitute for loader/transform tests.

## 17. Acceptance criteria

Milestone 3 is complete only when all of the following are true:

1. ASCII STL loads into the neutral geometry contract.
2. Binary STL loads into the same contract.
3. Invalid/truncated STL sources fail with stable errors.
4. `missing` and `ambiguous` assets cannot be loaded.
5. Resolved source path identity is preserved.
6. Geometry output is deterministic.
7. Identity transform is deterministic and lossless for positions/topology.
8. Explicit rotation/translation transforms behave predictably.
9. No unit/orientation/clinical placement is guessed.
10. `validatedGeometry` is not promoted to `true`.
11. `redistributionAllowed` is not promoted from `unknown` without explicit input evidence.
12. An isolated 3D surface can render the resulting mesh.
13. No production Viewer placement is introduced.
14. Full implant-library tests pass with zero failures/skips.
15. Production web build exits successfully.
16. GitHub Actions for the final Milestone 3 commit is GREEN before completion is declared.

## 18. Expected result

At the end of Milestone 3, OdontoView can select a resolved implant-library variant, read its STL geometry, produce a stable renderer-neutral mesh, apply an explicit known transform, and display the piece correctly in an isolated 3D environment.

This milestone proves the geometry pipeline only.

The later placement milestone will be responsible for connecting this neutral geometry to DICOM/CBCT patient space and the production implant-planning Viewer.
