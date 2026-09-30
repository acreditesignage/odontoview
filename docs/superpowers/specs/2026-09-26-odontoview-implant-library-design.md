# OdontoView Implant Library — Design

Date: 2026-09-26
Branch: `feat/entrega-1-odonto-view-network`

## Goal

Build a normalized implant/prosthetic library layer for OdontoView that can ingest exocad-style `config.xml` libraries and represent manufacturers, systems, components, variants, geometries, coordinate frames, compatibility, and design constraints without hardcoding every manufacturer.

The first validated inputs are three real library families supplied for analysis:

- Implacil HI 3.5
- SIN CM SW
- Neodent Grand Morse

The first deliverable is **not** a production library importer and **not** surgical-guide CAD. It is a parser/normalizer that converts supported library XML into one OdontoView JSON model that can later feed Viewer planning, prosthetic libraries, and the future Guide module.

## Current OdontoView context

OdontoView already has CBCT/MPR viewing, 3D planning, implant placement state, an initial Neodent GM catalog, and parametric implant geometry. The current implant catalog intentionally does not claim manufacturer-authorized mesh geometry.

The new library subsystem must remain isolated from the current Viewer until its normalized output is stable.

## Source observations that shape the design

### Implacil HI 3.5

The source XML contains supplier metadata, implant/analog geometry, marker/scan files, support/base files, interface files, subtype heights (1.0/2.0/3.0 mm), screw-channel axes, rotation offsets, and rotation-lock counts.

### SIN CM SW

The source XML explicitly links marker, screw, implant geometry, component interfaces, subtype supports, dimensional variants (`Padrão`, `+0.02 mm`, `+0.04 mm`, `+0.06 mm`), and a maximum screw-channel angle design constraint.

### Neodent Grand Morse

The source XML distinguishes implant/connection geometries, Hex vs Rot variants, converter components, CAD/CAM links, SMALL/LARGE variants, open/closed designs, gingival heights, analog variants, and scanmarker geometry.

## Core rule

Do not derive clinical meaning only from filenames.

Priority when normalizing:

1. explicit XML field semantics;
2. structured display/keyword metadata;
3. filename heuristics only as fallback;
4. unknown values stay unknown rather than being guessed.

## Normalized domain model

### Manufacturer

- `id`
- `name`
- `supplierName`
- `supplierUrl`
- `source`

### ImplantSystem

- `id`
- `manufacturerId`
- `name`
- `displayName`
- `sourceDisplayInformation`

### ComponentFamily

Represents a functional family such as:

- implant
- analog
- scanbody / marker
- interface
- support / base
- abutment / pilar
- screw
- converter
- CAD/CAM link
- unknown

Fields:

- `id`
- `systemId`
- `name`
- `role`
- `keyword`
- `displayInformation`

### ComponentVariant

- `id`
- `familyId`
- `name`
- `displayInformation`
- `keyword`
- `attributes`
  - `heightMm`
  - `sizeClass`
  - `design`
  - `rotationMode`
  - `dimensionOffsetMm`
  - other source-specific structured values

Unknown attributes remain under `sourceAttributes` rather than being promoted to clinical meaning.

### GeometryAsset

- `id`
- `variantId` or `familyId`
- `role`
  - implant
  - marker
  - support
  - interface
  - screw
  - other
- `filename`
- `format`
  - STL
  - SDFA
  - other
- `sourceSignature`
- `validatedGeometry` (default `false`)
- `redistributionAllowed` (default `unknown`)

### CoordinateFrame

All vectors are stored exactly as provided by the source and normalized into a consistent coordinate structure.

- `registrationClickCenter: {x,y,z}`
- `axisAsymmetric: {x,y,z}`
- `axisOcclusal: {x,y,z}`
- `axisScrewChannel: {x,y,z}`
- `supportOrientation`
- `referenceHeightOffset`
- `referenceRotationOffset`

### CompatibilityRule

- `rotationLockEnabled`
- `rotationLockCount`
- `maxScrewChannelAngleDeg`
- `sourceConstraintFlags`
- explicit links between component family/variant and referenced geometry

## Canonical parser output

Example shape:

```json
{
  "schemaVersion": 1,
  "manufacturer": {
    "name": "Neodent"
  },
  "system": {
    "name": "Grand Morse"
  },
  "components": [
    {
      "role": "interface",
      "name": "Link",
      "variants": [
        {
          "displayInformation": "[Aberto] Cinta 1.5mm SMALL",
          "attributes": {
            "heightMm": 1.5,
            "sizeClass": "SMALL",
            "design": "open"
          },
          "geometry": {
            "support": "interface_small_3_8_cinta_150.stl",
            "interface": "...stl"
          }
        }
      ]
    }
  ]
}
```

## Parser architecture

Create a standalone module under a library/import area, not inside `Viewer2.jsx`.

Suggested boundaries:

- `library/implant/parseExocadLibrary.js`
  - parses XML into an intermediate source representation
- `library/implant/normalizeImplantLibrary.js`
  - converts the source representation into OdontoView schema
- `library/implant/inferLibraryMetadata.js`
  - conservative helpers for parsing display text such as height/size/design
- `library/implant/schema.js`
  - schema version and validation helpers
- tests with fixtures for Implacil, SIN, and Neodent

## Parsing behavior

The parser must support at least these XML concepts:

- `ImplantFilename`
- `MarkerFilename`
- `ScrewFilename`
- `SupportFilename`
- `InterfaceFilename`
- `DisplayInformation`
- `Keyword`
- `Supplier`
- `SupplierLink`
- `RegistrationClickCenter`
- `AxisAsymmetric`
- `AxisOcclusal`
- `AxisScrewChannel`
- `SupportOrientation`
- `ReferenceHeightOffset`
- `ReferenceRotationOffset`
- `RotationLockCount`
- `AxisScrewChannelMaxUserAngle`
- nested `TypeConfig / ImplantTypeConfig / SubtypeConfig / ImplantSubtypeConfig`
- `FileSignatures`

Missing fields are valid and become `null`/absent. A library must not fail only because one manufacturer omits a field another uses.

## Error handling

Parser errors must distinguish:

- invalid XML;
- unsupported root structure;
- missing referenced geometry;
- malformed numeric/vector field;
- ambiguous inferred metadata.

Ambiguous metadata must not block parsing. It is recorded as a warning.

## Safety / provenance

The importer must preserve:

- source supplier;
- source filenames;
- signatures when present;
- source library/version metadata when available;
- `validatedGeometry=false` by default;
- `redistributionAllowed=unknown` by default.

No source geometry is automatically bundled into the OdontoView product merely because it can be parsed.

## Scope boundary: surgical guide

This subsystem prepares the implant/prosthetic library foundation but does not yet generate surgical guides.

A future `GuideLibrary` must separately represent:

- surgical kit;
- drill sequence;
- drill diameters/lengths;
- sleeve inner/outer diameters;
- sleeve height;
- sleeve-to-implant platform offset;
- guided depth rules;
- manufacturer-specific constraints.

The current three sample libraries do not provide enough evidence to define that layer safely.

## First implementation milestone

Milestone 1 is complete when:

1. each of the three sample XMLs parses without manufacturer-specific branching in the main parser;
2. all referenced geometry filenames are preserved by role;
3. coordinate/vector and rotation fields are preserved;
4. Neodent height/size/design variants normalize correctly where explicit in source text;
5. Implacil 1.0/2.0/3.0 variants remain linked to the correct marker/support/interface files;
6. SIN standard/+0.02/+0.04/+0.06 variants remain distinct without assigning unsupported clinical meaning;
7. warnings are produced instead of guesses for ambiguous fields;
8. tests cover all three fixtures.

## Out of scope for Milestone 1

- importing all 332 libraries;
- writing to the production database;
- changing Viewer2 UI;
- redistributing source STL/SDFA files;
- guide CAD;
- STL boolean operations;
- automatic CBCT/STL registration;
- claiming manufacturer validation.

## Success criterion

Given any of the three reference `config.xml` files, the parser produces deterministic, inspectable OdontoView JSON that preserves the source relationships and can later be consumed by planning UI without understanding manufacturer-specific XML quirks.
