import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseExocadLibrary } from './parseExocadLibrary.js';
import { validateNormalizedLibrary } from './schema.js';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function loadNormalizer() {
  const mod = await import('./normalizeImplantLibrary.js').catch(() => null);
  assert.ok(mod, 'normalizeImplantLibrary.js must exist');
  return mod.normalizeImplantLibrary;
}

async function normalize(name) {
  const normalizeImplantLibrary = await loadNormalizer();
  return normalizeImplantLibrary(parseExocadLibrary(await fixture(name)));
}

test('normalizes Implacil subtype relationships without losing geometry roles', async () => {
  const { library, warnings } = await normalize('implacil-minimal.xml');
  assert.equal(validateNormalizedLibrary(library).valid, true);
  assert.equal(library.schemaVersion, 1);
  assert.equal(library.manufacturer.name, 'Implacil de Bortoli Material Odontologico Ltda');
  assert.equal(library.system.name, 'Implacil - HI 3.5 - Pilar Digital');
  assert.equal(library.validatedGeometry, false);
  assert.equal(library.redistributionAllowed, 'unknown');
  assert.equal(library.geometry.implant.filename, 'PILAR DIGITAL HI 3.5 - ANALOGO DIGITAL HI 3.5-1.sdfa');
  assert.equal(library.geometry.implant.format, 'SDFA');

  const family = library.components[0];
  assert.equal(family.displayInformation, 'PD38 C');
  assert.equal(family.variants.length, 3);
  assert.deepEqual(family.variants.map((variant) => variant.attributes.heightMm), [1, 2, 3]);
  assert.equal(family.variants[0].geometry.marker.filename, 'TRANSFER DE ESCANEAMENTO 1.STL');
  assert.equal(family.variants[0].geometry.support.filename, 'Base T 3.8 SF 1.sdfa');
  assert.equal(family.variants[0].geometry.interface.filename, 'PILAR DIGITAL AR HI 3.5X1.sdfa');
  assert.deepEqual(family.variants[0].coordinateFrame.axisScrewChannel, { x: 0, y: 1, z: 0 });
  assert.equal(family.variants[0].coordinateFrame.referenceRotationOffset, 30);
  assert.equal(family.variants[0].compatibility.rotationLockCount, 6);
  assert.deepEqual(warnings, []);
});

test('normalizes SIN standard and dimensional variants without reinterpreting them clinically', async () => {
  const { library } = await normalize('sin-minimal.xml');
  assert.equal(validateNormalizedLibrary(library).valid, true);
  assert.equal(library.manufacturer.name, 'SIN Implante');
  assert.equal(library.system.name, 'SIN | CM 16° (STRONG SW)');
  assert.equal(library.geometry.marker.filename, 'J_CMSW.stl');
  assert.equal(library.geometry.screw.filename, '160323_PT 16 - Parafuso de retencao.sdfa');
  assert.equal(library.compatibility.maxScrewChannelAngleDeg, 25);
  assert.equal(library.compatibility.maxScrewChannelAngleIsDesignConstraint, true);

  const family = library.components[0];
  assert.equal(family.geometry.interface.filename, 'ICMT 0502.stl');
  assert.deepEqual(family.variants.map((variant) => variant.displayInformation), ['Padrao', '+0.02mm', '+0.04mm', '+0.06mm']);
  assert.equal(family.variants[0].attributes.dimensionOffsetMm, undefined);
  assert.equal(family.variants[1].attributes.dimensionOffsetMm, 0.02);
  assert.equal(family.variants[2].attributes.dimensionOffsetMm, 0.04);
  assert.equal(family.variants[3].attributes.dimensionOffsetMm, 0.06);
  assert.equal(family.variants[2].sourceAttributes.clinicalMeaning, undefined);
});

test('normalizes Neodent Hex/Rot and Link SMALL/LARGE open/closed height variants', async () => {
  const { library } = await normalize('neodent-minimal.xml');
  assert.equal(validateNormalizedLibrary(library).valid, true);
  assert.equal(library.manufacturer.name, 'Neodent');
  assert.equal(library.system.name, '[A3.2] Neodent Grand Morse');

  const implantFamily = library.components.find((family) => family.displayInformation === 'Implante');
  assert.equal(implantFamily.role, 'implant');
  assert.deepEqual(implantFamily.variants.map((variant) => variant.attributes.rotationMode), ['hex', 'rotational']);

  const linkFamily = library.components.find((family) => family.displayInformation === 'Link');
  assert.equal(linkFamily.role, 'interface');
  assert.deepEqual(linkFamily.variants[0].attributes, { heightMm: 1.5, sizeClass: 'SMALL', design: 'open' });
  assert.deepEqual(linkFamily.variants[1].attributes, { heightMm: 3.5, sizeClass: 'LARGE', design: 'closed' });
  assert.equal(linkFamily.variants[0].geometry.support.filename, 'interface_small_3_8_cinta_150.stl');
  assert.equal(linkFamily.variants[0].geometry.interface.filename, 'LINK CAD CAM CINTA 1_50MM SMALL.stl');
});

test('preserves provenance, signatures and safe geometry defaults on every asset', async () => {
  const { library } = await normalize('implacil-minimal.xml');
  assert.equal(library.source.format, 'exocad-implant-library');
  assert.equal(library.source.supplierName, 'Implacil de Bortoli Material Odontologico Ltda');
  assert.deepEqual(library.source.signatures, [{ filename: 'Base T 3.8 SF 1.sdfa', signature: 'fixture-signature' }]);

  const asset = library.components[0].variants[0].geometry.support;
  assert.equal(asset.validatedGeometry, false);
  assert.equal(asset.redistributionAllowed, 'unknown');
  assert.equal(asset.sourceSignature, 'fixture-signature');
});

test('normalization is deterministic for the same parsed source', async () => {
  const normalizeImplantLibrary = await loadNormalizer();
  const parsed = parseExocadLibrary(await fixture('neodent-minimal.xml'));
  assert.deepEqual(normalizeImplantLibrary(parsed), normalizeImplantLibrary(parsed));
});

test('does not silently choose between conflicting signatures for the same geometry file', async () => {
  const normalizeImplantLibrary = await loadNormalizer();
  const parsed = {
    source: {
      sourceFormat: 'exocad-implant-library',
      displayInformation: 'Safety Test System',
      supplier: { name: 'Safety Test Manufacturer', url: null },
      geometry: { implant: 'implant.stl' },
      coordinateFrame: {},
      signatures: [
        { filename: 'implant.stl', signature: 'signature-a' },
        { filename: 'implant.stl', signature: 'signature-b' },
      ],
      sourceAttributes: {},
      types: [],
    },
    warnings: [],
  };

  const { library, warnings } = normalizeImplantLibrary(parsed);
  assert.equal(library.geometry.implant.sourceSignature, null);
  assert.ok(warnings.some((warning) => warning.includes('conflicting signatures')));
});
