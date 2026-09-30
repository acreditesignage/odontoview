import test from 'node:test';
import assert from 'node:assert/strict';

import {
  importImplantArchiveFiles,
  listRenderableImplantGeometry,
  readArchiveGeometryBytes,
} from './importImplantArchiveFiles.js';

function file(name, content) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    name,
    async text() { return new TextDecoder().decode(bytes); },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

const XML = `<?xml version="1.0" encoding="utf-8"?>
<ImplantLibraryEntry>
  <DisplayInformation>Archive Test System</DisplayInformation>
  <Supplier Name="Archive Test Manufacturer" />
  <ImplantFilename>analog.sdfa</ImplantFilename>
  <TypeConfig>
    <ImplantTypeConfig>
      <DisplayInformation>Component A</DisplayInformation>
      <Keyword>component-a</Keyword>
      <InterfaceFilename>interface.stl</InterfaceFilename>
      <SubtypeConfig>
        <ImplantSubtypeConfig>
          <DisplayInformation>Variant 1</DisplayInformation>
          <Keyword>variant-1</Keyword>
          <SupportFilename>variant.STL</SupportFilename>
        </ImplantSubtypeConfig>
      </SubtypeConfig>
    </ImplantTypeConfig>
  </TypeConfig>
</ImplantLibraryEntry>`;

test('imports an extracted implant-library archive as one catalog bundle', async () => {
  const files = [
    file('Vendor/System/config.xml', XML),
    file('Vendor/System/interface.stl', new Uint8Array([1, 2, 3])),
    file('Vendor/System/variant.STL', new Uint8Array([4, 5, 6, 7])),
    file('Vendor/System/analog.sdfa', new Uint8Array([8, 9])),
  ];

  const imported = await importImplantArchiveFiles(files, { sourceName: 'vendor-system.rar' });

  assert.equal(imported.audit.summary.totalEntries, 1);
  assert.equal(imported.audit.summary.importedEntries, 1);
  assert.equal(imported.audit.summary.missingGeometryFiles, 0);
  assert.equal(imported.catalog.source.name, 'vendor-system.rar');
  assert.equal(imported.catalog.libraries.length, 1);
  assert.equal(imported.filesByPath.size, 4);
});

test('lists resolved STL geometry without pretending SDFA is renderable', async () => {
  const imported = await importImplantArchiveFiles([
    file('Vendor/System/config.xml', XML),
    file('Vendor/System/interface.stl', new Uint8Array([1])),
    file('Vendor/System/variant.STL', new Uint8Array([2])),
    file('Vendor/System/analog.sdfa', new Uint8Array([3])),
  ]);

  const options = listRenderableImplantGeometry(imported.catalog);
  assert.equal(options.length, 2);
  assert.deepEqual(options.map((item) => item.matchedPath).sort(), [
    'Vendor/System/interface.stl',
    'Vendor/System/variant.STL',
  ]);
  assert.ok(options.every((item) => item.format === 'stl'));
  assert.ok(options.some((item) => item.componentLabel === 'Component A'));
  assert.ok(options.some((item) => item.variantLabel === 'Variant 1'));
});

test('returns exact bytes for a case-insensitively resolved archive path', async () => {
  const imported = await importImplantArchiveFiles([
    file('Vendor/System/config.xml', XML),
    file('Vendor/System/interface.stl', new Uint8Array([10, 20, 30])),
    file('Vendor/System/variant.STL', new Uint8Array([40])),
    file('Vendor/System/analog.sdfa', new Uint8Array([50])),
  ]);

  const bytes = await readArchiveGeometryBytes(imported.filesByPath, 'vendor/system/INTERFACE.STL');
  assert.deepEqual([...new Uint8Array(bytes)], [10, 20, 30]);
});

test('rejects an archive that has no config.xml', async () => {
  await assert.rejects(
    () => importImplantArchiveFiles([file('Vendor/System/mesh.stl', new Uint8Array([1]))]),
    (error) => error?.code === 'NO_IMPLANT_LIBRARY_CONFIG',
  );
});
