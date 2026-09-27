import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldIncludeFile } = require('../../../../../js/archive-core.js');

test('default DICOM mode preserves existing DICOM filtering', () => {
  const dicom = new Uint8Array(132);
  dicom.set([68, 73, 67, 77], 128);
  assert.equal(shouldIncludeFile('series/image.dcm', dicom, 'dicom'), true);
  assert.equal(shouldIncludeFile('series/image.bin', dicom, 'dicom'), true);
  assert.equal(shouldIncludeFile('series/DICOMDIR', new Uint8Array(8), 'dicom'), false);
  assert.equal(shouldIncludeFile('implant/config.xml', new Uint8Array(8), 'dicom'), false);
});

test('implant-library mode only exposes config.xml, STL and SDFA entries', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(shouldIncludeFile('Neodent/config.xml', bytes, 'implant-library'), true);
  assert.equal(shouldIncludeFile('Neodent/mesh.STL', bytes, 'implant-library'), true);
  assert.equal(shouldIncludeFile('Neodent/component.sdfa', bytes, 'implant-library'), true);
  assert.equal(shouldIncludeFile('Neodent/readme.txt', bytes, 'implant-library'), false);
  assert.equal(shouldIncludeFile('Neodent/image.dcm', bytes, 'implant-library'), false);
});

test('unknown extraction mode rejects instead of broadening archive access', () => {
  assert.throws(
    () => shouldIncludeFile('file.stl', new Uint8Array([1]), 'everything'),
    /Modo de extração não suportado/,
  );
});
