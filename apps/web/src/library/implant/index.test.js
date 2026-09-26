import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function loadPublicApi() {
  const mod = await import('./index.js').catch(() => null);
  assert.ok(mod, 'index.js must exist');
  return mod;
}

test('public API imports Neodent config.xml into normalized OdontoView schema', async () => {
  const { importImplantLibraryXml, IMPLANT_LIBRARY_SCHEMA_VERSION } = await loadPublicApi();
  const result = importImplantLibraryXml(await fixture('neodent-minimal.xml'));
  assert.equal(IMPLANT_LIBRARY_SCHEMA_VERSION, 1);
  assert.equal(result.library.schemaVersion, 1);
  assert.equal(result.library.manufacturer.name, 'Neodent');
  assert.equal(result.library.components.length, 2);
});

test('public API imports all three reference library styles', async () => {
  const { importImplantLibraryXml } = await loadPublicApi();
  for (const name of ['implacil-minimal.xml', 'sin-minimal.xml', 'neodent-minimal.xml']) {
    const result = importImplantLibraryXml(await fixture(name));
    assert.equal(result.library.schemaVersion, 1, name);
    assert.ok(result.library.manufacturer.name, name);
    assert.ok(result.library.system.name, name);
  }
});

test('public API output is deterministic', async () => {
  const { importImplantLibraryXml } = await loadPublicApi();
  const xml = await fixture('sin-minimal.xml');
  assert.deepEqual(importImplantLibraryXml(xml), importImplantLibraryXml(xml));
});

test('public API exposes stable INVALID_XML error code', async () => {
  const { importImplantLibraryXml, ImplantLibraryParseError } = await loadPublicApi();
  assert.throws(
    () => importImplantLibraryXml('<ImplantLibraryEntry>'),
    (error) => error instanceof ImplantLibraryParseError && error.code === 'INVALID_XML',
  );
});

test('public API exposes stable UNSUPPORTED_ROOT error code', async () => {
  const { importImplantLibraryXml, ImplantLibraryParseError } = await loadPublicApi();
  assert.throws(
    () => importImplantLibraryXml('<?xml version="1.0"?><OtherLibrary/>'),
    (error) => error instanceof ImplantLibraryParseError && error.code === 'UNSUPPORTED_ROOT',
  );
});
