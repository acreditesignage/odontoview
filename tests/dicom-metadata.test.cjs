'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../js/dicom-metadata.js');
const metadata = fs.existsSync(modulePath) ? require(modulePath) : {};

// Values are hand-defined, independent of production geometry calculations.
function slice(z = 0, overrides = {}) {
  return { studyInstanceUID: '1.2.1', seriesInstanceUID: '1.2.2', frameOfReferenceUID: '1.2.3',
    sopInstanceUID: `1.2.4.${z + 100}`, rows: 4, columns: 6, pixelSpacing: [0.3, 0.5],
    imagePosition: [10, 20, z], orientation: [1, 0, 0, 0, 1, 0],
    sliceThickness: 1, spacingBetweenSlices: 1, numberOfFrames: 1, ...overrides };
}
function codes(report) { return report.errors.map(e => e.code); }

test('normalizes decimal strings and preserves unknown values instead of inventing zero', () => {
  const actual = metadata.normalize({ ...slice(), imagePosition: '10\\20\\-2.5',
    orientation: '1\\0\\0\\0\\1\\0', pixelSpacing: '0.3\\0.5',
    rows: '4', columns: '6', sliceThickness: '', spacingBetweenSlices: undefined,
    instanceNumber: '7', seriesInstanceUID: ' 1.2.2\0 ' });
  assert.deepEqual(actual.imagePosition, [10, 20, -2.5]);
  assert.deepEqual(actual.pixelSpacing, [0.3, 0.5]);
  assert.equal(actual.rows, 4);
  assert.equal(actual.instanceNumber, 7);
  assert.equal(actual.seriesInstanceUID, '1.2.2');
  assert.equal(actual.sliceThickness, null);
  assert.equal(actual.spacingBetweenSlices, null);
});

test('valid regular series has millimetre positions and nominal spacing', () => {
  const report = metadata.validateImport([slice(0), slice(1), slice(2)]);
  assert.equal(report.valid, true);
  assert.deepEqual(report.series[0].slicePositions, [0, 1, 2]);
  assert.deepEqual(report.series[0].sliceNormal, [0, 0, 1]);
  assert.equal(report.series[0].nominalSpacing, 1);
});

test('sorts spatially despite reversed names and instance numbers without mutating input', () => {
  const input = [slice(2, {instanceNumber: 1}), slice(0, {instanceNumber: 9}), slice(1)];
  const report = metadata.validateImport(input);
  assert.equal(report.valid, true);
  assert.deepEqual(report.series[0].sortedItems.map(s => s.imagePosition[2]), [0, 1, 2]);
  assert.deepEqual(input.map(s => s.imagePosition[2]), [2, 0, 1]);
});

test('negative normal orders by projection, not the patient Z component', () => {
  const orientation = [1, 0, 0, 0, -1, 0];
  const report = metadata.validateImport([slice(0, {orientation}), slice(1, {orientation}), slice(2, {orientation})]);
  assert.equal(report.valid, true);
  assert.deepEqual(report.series[0].sortedItems.map(s => s.imagePosition[2]), [2, 1, 0]);
});

test('sagittal acquisition uses X spatial positions', () => {
  const items = [0, 2, 1].map(x => slice(x, {imagePosition:[x,10,20], orientation:[0,1,0,0,0,1]}));
  const report = metadata.validateImport(items);
  assert.equal(report.valid, true);
  assert.deepEqual(report.series[0].slicePositions, [0,1,2]);
});

for (const field of ['studyInstanceUID', 'seriesInstanceUID', 'frameOfReferenceUID']) {
  test(`groups separately and refuses mixed ${field}`, () => {
    const report = metadata.validateImport([slice(0), slice(1, {[field]:'9.8.7'})]);
    assert.equal(report.valid, false);
    assert.equal(report.series.length, 2);
    assert.ok(codes(report).includes('MULTIPLE_SERIES'));
  });
  test(`missing ${field} cannot merge into an anonymous volume`, () => {
    assert.equal(metadata.validateImport([slice(0, {[field]:''})]).valid, false);
  });
}

for (const field of ['rows', 'columns']) {
  test(`refuses inconsistent ${field}`, () => {
    const r = metadata.validateImport([slice(0), slice(1, {[field]: 8})]);
    assert.ok(codes(r).includes('DIMENSIONS_MISMATCH'));
  });
}
test('anisotropic pixel spacing is valid, but changes between slices are not', () => {
  assert.equal(metadata.validateImport([slice(0),slice(1)]).valid, true);
  assert.ok(codes(metadata.validateImport([slice(0),slice(1,{pixelSpacing:[0.5,0.3]})])).includes('PIXEL_SPACING_MISMATCH'));
});

for (const [name, overrides] of [
  ['zero spacing', {pixelSpacing:[0,0.5]}],
  ['missing spacing', {pixelSpacing:''}],
  ['blank component', {imagePosition:'10\\\\0'}],
  ['missing position', {imagePosition:undefined}],
  ['infinite position', {imagePosition:[0,0,Infinity]}],
  ['malformed number', {pixelSpacing:'0.3foo\\0.5'}],
  ['non-unit directions', {orientation:[2,0,0,0,1,0]}],
  ['parallel directions', {orientation:[1,0,0,1,0,0]}],
  ['missing orientation', {orientation:null}],
  ['fractional rows', {rows:4.5}],
  ['missing rows', {rows:null}],
  ['parse failure', {parseError:true}],
  ['multi-frame', {numberOfFrames:3}],
  ['malformed frame count', {numberOfFrames:'abc'}],
]) {
  test(`rejects ${name}`, () => assert.equal(metadata.validateImport([slice(0, overrides)]).valid, false));
}

test('small decimal rounding in direction cosines is tolerated', () => {
  const orientation = [0.707107,0.707107,0,-0.707107,0.707107,0];
  assert.equal(metadata.validateImport([slice(0,{orientation}),slice(1,{orientation})]).valid, true);
});

test('in-plane rotation with the same normal is incompatible', () => {
  const report = metadata.validateImport([slice(0),slice(1,{orientation:[0,1,0,-1,0,0]})]);
  assert.ok(codes(report).includes('ORIENTATION_MISMATCH'));
});
test('duplicate positions with different SOP IDs cannot make a thicker volume', () => {
  const report = metadata.validateImport([slice(0),slice(0,{sopInstanceUID:'1.2.999'})]);
  assert.ok(codes(report).includes('DUPLICATE_POSITION'));
});
test('repeated SOP instance with contradictory position is still a duplicate', () => {
  const report = metadata.validateImport([slice(0),slice(1,{sopInstanceUID:'1.2.4.100'})]);
  assert.ok(codes(report).includes('DUPLICATE_INSTANCE'));
});
test('detects a missing slice among otherwise regular intervals', () => {
  const report = metadata.validateImport([0,1,2,4,5].map(z => slice(z)));
  assert.equal(report.valid, false);
  assert.ok(codes(report).includes('SLICE_GAP'));
  assert.ok(codes(report).includes('IRREGULAR_SPACING'));
});
test('irregular spacing is not silently rendered as uniform', () => {
  const report = metadata.validateImport([0,1,2.2,3.2].map(z => slice(z)));
  assert.ok(codes(report).includes('IRREGULAR_SPACING'));
});
test('two slices with spacing greater than declared spacing signal a possible gap', () => {
  assert.ok(codes(metadata.validateImport([slice(0),slice(3)])).includes('SLICE_GAP'));
});
test('in-plane displacement blocks a sheared stack unsupported by the current loader', () => {
  assert.ok(codes(metadata.validateImport([slice(0),slice(1,{imagePosition:[10.5,20,1]})])).includes('IN_PLANE_SHIFT'));
});
test('slice thickness is not used to infer missing slices', () => {
  const r = metadata.validateImport([0,1,2].map(z => slice(z,{sliceThickness:0.2,spacingBetweenSlices:null})));
  assert.equal(r.valid,true);
});
test('a single slice reports depth uncertainty instead of inventing inter-slice spacing', () => {
  const r = metadata.validateImport([slice(0,{sliceThickness:null,spacingBetweenSlices:null})]);
  assert.equal(r.valid,true);
  assert.equal(r.series[0].nominalSpacing,null);
  assert.ok(r.warnings.some(w => w.code === 'SINGLE_SLICE'));
});
test('empty selection returns a structured error', () => {
  assert.ok(codes(metadata.validateImport([])).includes('NO_FILES'));
});
test('guard exposes a clear error and report for multiple series', () => {
  assert.throws(() => metadata.assertValidImport([slice(0),slice(1,{seriesInstanceUID:'9.8.7'})]), error => {
    assert.equal(error.name,'DicomValidationError');
    assert.match(error.message,/série/i);
    assert.equal(error.report.valid,false);
    return true;
  });
});
test('guard returns the accepted series with source files retained', () => {
  const file = {name:'example.dcm'};
  const accepted = metadata.assertValidImport([slice(0,{file})]);
  assert.equal(accepted.sortedItems[0].file,file);
});

test('normalizing twice cannot turn an invalid frame count into a single-frame image', () => {
  const fromReader = metadata.normalize(slice(0,{numberOfFrames:'abc'}));
  assert.equal(metadata.validateImport([fromReader]).valid,false);
});

test('reader maps US dimensions and geometry tags into validator fields', () => {
  const strings={x0020000d:'1.2.1',x0020000e:'1.2.2',x00200052:'1.2.3',x00080018:'1.2.4',
    x00200032:'10\\20\\-2',x00200037:'1\\0\\0\\0\\1\\0',x00280030:'0.3\\0.5',
    x00180050:'1',x00180088:'2',x00200013:'7',x0008103e:'CBCT'};
  const actual=metadata.readDataSet({string:tag=>strings[tag],uint16:tag=>({x00280010:4,x00280011:6})[tag]});
  assert.equal(actual.rows,4);
  assert.equal(actual.columns,6);
  assert.equal(actual.seriesInstanceUID,'1.2.2');
  assert.equal(actual.spacingBetweenSlices,2);
  assert.equal(actual.sliceThickness,1);
  assert.equal(actual.instanceNumber,7);
  assert.equal(actual.seriesDescription,'CBCT');
  assert.deepEqual(actual.imagePosition,[10,20,-2]);
  assert.deepEqual(actual.pixelSpacing,[0.3,0.5]);
  assert.equal(metadata.validateImport([actual]).valid,true);
});
