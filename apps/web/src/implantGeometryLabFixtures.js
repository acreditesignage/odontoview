function triangleNormal([a, b, c]) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

const A = [0, 0, 0];
const B = [12, 0, 0];
const C = [0, 12, 0];
const D = [0, 0, 20];
const TETRAHEDRON_FACES = [
  [A, C, B],
  [A, B, D],
  [B, C, D],
  [C, A, D],
];

function makeAsciiMeshBytes(name, faces) {
  const lines = [`solid ${name}`];
  for (const face of faces) {
    const normal = triangleNormal(face);
    lines.push(`  facet normal ${normal.join(' ')}`);
    lines.push('    outer loop');
    for (const vertex of face) lines.push(`      vertex ${vertex.join(' ')}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${name}`);
  lines.push('');
  return new TextEncoder().encode(lines.join('\n'));
}

function makeBinaryMeshBytes(header, faces) {
  const buffer = new ArrayBuffer(84 + faces.length * 50);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  const view = new DataView(buffer);
  view.setUint32(80, faces.length, true);

  let offset = 84;
  for (const face of faces) {
    const normal = triangleNormal(face);
    for (const value of normal) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    for (const vertex of face) {
      for (const value of vertex) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function resolvedAsset({ id, filename, matchedPath }) {
  return {
    id,
    role: 'support',
    filename,
    reference: filename,
    resolution: 'resolved',
    matchedPath,
    validatedGeometry: false,
    redistributionAllowed: 'unknown',
  };
}

const asciiAsset = resolvedAsset({
  id: 'lab-asset-ascii',
  filename: 'synthetic-tetrahedron-ascii.stl',
  matchedPath: 'synthetic/geometry-lab/synthetic-tetrahedron-ascii.stl',
});

const binaryAsset = resolvedAsset({
  id: 'lab-asset-binary',
  filename: 'synthetic-tetrahedron-binary.stl',
  matchedPath: 'synthetic/geometry-lab/synthetic-tetrahedron-binary.stl',
});

export const implantGeometryLabCatalog = {
  catalogSchemaVersion: 1,
  source: { kind: 'synthetic-geometry-lab', name: 'OdontoView Geometry Lab' },
  summary: {
    totalEntries: 1,
    importedEntries: 1,
    unsupportedEntries: 0,
    invalidEntries: 0,
    geometryReferences: 2,
    resolvedGeometryFiles: 2,
    missingGeometryFiles: 0,
    ambiguousGeometryFiles: 0,
  },
  libraries: [
    {
      id: 'lab-library-synthetic',
      sourcePath: 'synthetic/geometry-lab/config.xml',
      manufacturer: { id: 'lab-manufacturer', name: 'OdontoView Synthetic' },
      system: { id: 'lab-system', name: 'Geometry Lab' },
      geometry: {},
      components: [
        {
          id: 'lab-component',
          name: 'Synthetic implant body',
          displayName: 'Synthetic implant body',
          geometry: {},
          variants: [
            {
              id: 'lab-variant-ascii',
              name: 'ASCII tetrahedron',
              displayName: 'ASCII tetrahedron',
              geometry: { support: asciiAsset },
            },
            {
              id: 'lab-variant-binary',
              name: 'Binary tetrahedron',
              displayName: 'Binary tetrahedron',
              geometry: { support: binaryAsset },
            },
          ],
        },
      ],
      warnings: [],
      provenance: { sourcePath: 'synthetic/geometry-lab/config.xml' },
    },
  ],
  diagnostics: {
    unsupportedEntries: [],
    invalidEntries: [],
    warnings: [],
  },
};

export const implantGeometryLabBytes = new Map([
  [asciiAsset.matchedPath, makeAsciiMeshBytes('odontoview-geometry-lab-ascii', TETRAHEDRON_FACES)],
  [binaryAsset.matchedPath, makeBinaryMeshBytes('OdontoView geometry lab binary STL', TETRAHEDRON_FACES)],
]);
