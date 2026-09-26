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
