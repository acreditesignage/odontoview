import test from 'node:test';
import assert from 'node:assert/strict';

async function loadSchema() {
  return import('./schema.js').catch(() => null);
}

test('implant library schema version is 1', async () => {
  const schema = await loadSchema();
  assert.ok(schema, 'schema.js must exist');
  assert.equal(schema.IMPLANT_LIBRARY_SCHEMA_VERSION, 1);
});

test('createEmptyLibrary applies safe geometry provenance defaults', async () => {
  const schema = await loadSchema();
  assert.ok(schema, 'schema.js must exist');
  const library = schema.createEmptyLibrary();
  assert.equal(library.schemaVersion, 1);
  assert.equal(library.validatedGeometry, false);
  assert.equal(library.redistributionAllowed, 'unknown');
  assert.deepEqual(library.components, []);
});

test('validator rejects missing manufacturer and system', async () => {
  const schema = await loadSchema();
  assert.ok(schema, 'schema.js must exist');
  const result = schema.validateNormalizedLibrary(schema.createEmptyLibrary());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('manufacturer')));
  assert.ok(result.errors.some((error) => error.includes('system')));
});

test('validator accepts a minimal normalized library', async () => {
  const schema = await loadSchema();
  assert.ok(schema, 'schema.js must exist');
  const library = {
    ...schema.createEmptyLibrary(),
    manufacturer: { id: 'neodent', name: 'Neodent' },
    system: { id: 'grand-morse', manufacturerId: 'neodent', name: 'Grand Morse' },
  };
  const result = schema.validateNormalizedLibrary(library);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test('validator rejects component variants when they are not an array', async () => {
  const schema = await loadSchema();
  assert.ok(schema, 'schema.js must exist');
  const library = {
    ...schema.createEmptyLibrary(),
    manufacturer: { id: 'neodent', name: 'Neodent' },
    system: { id: 'grand-morse', manufacturerId: 'neodent', name: 'Grand Morse' },
    components: [
      {
        id: 'grand-morse-component-1-link',
        systemId: 'grand-morse',
        name: 'Link',
        role: 'interface',
        variants: { unexpected: true },
      },
    ],
  };

  const result = schema.validateNormalizedLibrary(library);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('components[0].variants')));
});

test('validator rejects malformed geometry asset safety metadata', async () => {
  const schema = await loadSchema();
  assert.ok(schema, 'schema.js must exist');
  const library = {
    ...schema.createEmptyLibrary(),
    manufacturer: { id: 'neodent', name: 'Neodent' },
    system: { id: 'grand-morse', manufacturerId: 'neodent', name: 'Grand Morse' },
    geometry: {
      implant: {
        role: 'implant',
        filename: 'implant.stl',
        format: 'STL',
        sourceSignature: null,
        validatedGeometry: 'yes',
        redistributionAllowed: 'public',
      },
    },
  };

  const result = schema.validateNormalizedLibrary(library);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('geometry.implant.validatedGeometry')));
  assert.ok(result.errors.some((error) => error.includes('geometry.implant.redistributionAllowed')));
});
