import test from 'node:test';
import assert from 'node:assert/strict';

async function loadInference() {
  const mod = await import('./inferLibraryMetadata.js').catch(() => null);
  assert.ok(mod, 'inferLibraryMetadata.js must exist');
  return mod.inferVariantAttributes;
}

test('infers explicit Neodent gingival height and size class', async () => {
  const inferVariantAttributes = await loadInference();
  const result = inferVariantAttributes({
    displayInformation: '[Aberto] Cinta 1.5mm SMALL',
    keyword: 'OutHex',
    filenames: ['interface_small_3_8_cinta_150.stl'],
  });
  assert.equal(result.attributes.heightMm, 1.5);
  assert.equal(result.attributes.sizeClass, 'SMALL');
  assert.equal(result.attributes.design, 'open');
});

test('infers closed design and LARGE only from explicit labels', async () => {
  const inferVariantAttributes = await loadInference();
  const result = inferVariantAttributes({
    displayInformation: '[Fechado] Cinta 3.5mm LARGE',
    keyword: 'FechadoCinta35mmLARGE',
    filenames: [],
  });
  assert.deepEqual(result.attributes, {
    heightMm: 3.5,
    sizeClass: 'LARGE',
    design: 'closed',
  });
});

test('infers Hex and Rot rotation modes from explicit display tokens', async () => {
  const inferVariantAttributes = await loadInference();
  const hex = inferVariantAttributes({ displayInformation: '[3.0] Hex', keyword: 'InHex', filenames: [] });
  const rot = inferVariantAttributes({ displayInformation: '[3.0] Rot', keyword: 'InNoHex', filenames: [] });
  assert.equal(hex.attributes.rotationMode, 'hex');
  assert.equal(rot.attributes.rotationMode, 'rotational');
});

test('keeps SIN explicit dimensional offset distinct from component height', async () => {
  const inferVariantAttributes = await loadInference();
  const result = inferVariantAttributes({ displayInformation: '+0.04mm', keyword: '004mm', filenames: ['G_ICMT_0502+4.stl'] });
  assert.equal(result.attributes.dimensionOffsetMm, 0.04);
  assert.equal(result.attributes.heightMm, undefined);
});

test('uses exact millimeter subtype display for Implacil height and ignores conflicting compact keyword', async () => {
  const inferVariantAttributes = await loadInference();
  const result = inferVariantAttributes({ displayInformation: '1.0mm', keyword: '10mm', filenames: ['Base T 3.8 SF 1.sdfa'] });
  assert.equal(result.attributes.heightMm, 1);
});

test('does not infer clinical dimensions from naked filename numbers', async () => {
  const inferVariantAttributes = await loadInference();
  const result = inferVariantAttributes({
    displayInformation: null,
    keyword: null,
    filenames: ['EFF6805_29A_1_S.stl', 'AD_CMSW_35_11.stl'],
  });
  assert.deepEqual(result.attributes, {});
  assert.ok(result.warnings.some((warning) => warning.code === 'AMBIGUOUS_FILENAME_METADATA'));
});
