import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function loadParser() {
  const mod = await import('./parseExocadLibrary.js').catch(() => null);
  assert.ok(mod, 'parseExocadLibrary.js must exist');
  return mod.parseExocadLibrary;
}

test('parses Implacil source relationships, vectors, rotation and signatures', async () => {
  const parseExocadLibrary = await loadParser();
  const { source, warnings } = parseExocadLibrary(await fixture('implacil-minimal.xml'));

  assert.equal(source.supplier.name, 'Implacil de Bortoli Material Odontologico Ltda');
  assert.equal(source.displayInformation, 'Implacil - HI 3.5 - Pilar Digital');
  assert.equal(source.geometry.implant, 'PILAR DIGITAL HI 3.5 - ANALOGO DIGITAL HI 3.5-1.sdfa');
  assert.deepEqual(source.coordinateFrame.axisOcclusal, { x: 0, y: 1, z: 0 });
  assert.equal(source.types.length, 1);
  assert.equal(source.types[0].subtypes.length, 3);
  assert.equal(source.types[0].subtypes[0].geometry.marker, 'TRANSFER DE ESCANEAMENTO 1.STL');
  assert.equal(source.types[0].subtypes[0].geometry.support, 'Base T 3.8 SF 1.sdfa');
  assert.equal(source.types[0].subtypes[0].geometry.interface, 'PILAR DIGITAL AR HI 3.5X1.sdfa');
  assert.equal(source.types[0].subtypes[0].coordinateFrame.referenceRotationOffset, 30);
  assert.equal(source.types[0].subtypes[0].rotationLockCount, 6);
  assert.deepEqual(source.signatures, [{ filename: 'Base T 3.8 SF 1.sdfa', signature: 'fixture-signature' }]);
  assert.deepEqual(warnings, []);
});

test('parses SIN geometry roles, design constraint and dimensional subtypes', async () => {
  const parseExocadLibrary = await loadParser();
  const { source } = parseExocadLibrary(await fixture('sin-minimal.xml'));

  assert.deepEqual(source.geometry, {
    implant: 'AD_CMSW.stl',
    marker: 'J_CMSW.stl',
    screw: '160323_PT 16 - Parafuso de retencao.sdfa',
    support: null,
    interface: null,
  });
  assert.equal(source.constraints.maxScrewChannelAngleDeg, 25);
  assert.equal(source.constraints.maxScrewChannelAngleIsDesignConstraint, true);
  assert.equal(source.types.length, 1);
  assert.equal(source.types[0].geometry.interface, 'ICMT 0502.stl');
  assert.deepEqual(source.types[0].subtypes.map((item) => item.displayInformation), [
    'Padrao', '+0.02mm', '+0.04mm', '+0.06mm',
  ]);
});

test('normalizes one and repeated ImplantTypeConfig elements to arrays', async () => {
  const parseExocadLibrary = await loadParser();
  const implacil = parseExocadLibrary(await fixture('implacil-minimal.xml')).source;
  const neodent = parseExocadLibrary(await fixture('neodent-minimal.xml')).source;

  assert.ok(Array.isArray(implacil.types));
  assert.equal(implacil.types.length, 1);
  assert.ok(Array.isArray(neodent.types));
  assert.equal(neodent.types.length, 2);
  assert.equal(neodent.types[0].subtypes.length, 2);
  assert.equal(neodent.types[1].subtypes.length, 2);
});

test('preserves missing optional fields instead of throwing', async () => {
  const parseExocadLibrary = await loadParser();
  const xml = `<?xml version="1.0"?><ImplantLibraryEntry><DisplayInformation>Minimal System</DisplayInformation><TypeConfig><ImplantTypeConfig><DisplayInformation>Only type</DisplayInformation></ImplantTypeConfig></TypeConfig></ImplantLibraryEntry>`;
  const { source, warnings } = parseExocadLibrary(xml);

  assert.equal(source.supplier.name, null);
  assert.deepEqual(source.geometry, { implant: null, marker: null, screw: null, support: null, interface: null });
  assert.equal(source.types[0].subtypes.length, 0);
  assert.deepEqual(warnings, []);
});

test('malformed and empty vector numbers become null with warnings, never zero', async () => {
  const parseExocadLibrary = await loadParser();
  const xml = `<?xml version="1.0"?><ImplantLibraryEntry><DisplayInformation>Broken vector</DisplayInformation><RegistrationClickCenter><x>oops</x><y></y><z>3</z></RegistrationClickCenter></ImplantLibraryEntry>`;
  const { source, warnings } = parseExocadLibrary(xml);

  assert.deepEqual(source.coordinateFrame.registrationClickCenter, { x: null, y: null, z: 3 });
  assert.ok(warnings.some((warning) => warning.code === 'MALFORMED_NUMBER' && warning.path.endsWith('.x')));
  assert.ok(warnings.some((warning) => warning.code === 'EMPTY_NUMBER' && warning.path.endsWith('.y')));
});
