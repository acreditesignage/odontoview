const DEFAULT_VERTICES = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

export function makeAsciiStl({
  name = 'odontoview-test',
  normal = [0, 0, 1],
  vertices = DEFAULT_VERTICES,
} = {}) {
  const [a, b, c] = vertices;
  const text = [
    `solid ${name}`,
    `  facet normal ${normal.join(' ')}`,
    '    outer loop',
    `      vertex ${a.join(' ')}`,
    `      vertex ${b.join(' ')}`,
    `      vertex ${c.join(' ')}`,
    '    endloop',
    '  endfacet',
    `endsolid ${name}`,
    '',
  ].join('\n');
  return new TextEncoder().encode(text);
}

export function makeBinaryStl({
  header = 'OdontoView binary STL',
  normal = [0, 0, 1],
  vertices = DEFAULT_VERTICES,
  declaredTriangleCount = 1,
} = {}) {
  const buffer = new ArrayBuffer(84 + 50);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  const view = new DataView(buffer);
  view.setUint32(80, declaredTriangleCount, true);

  let offset = 84;
  for (const value of normal) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  for (const vertex of vertices) {
    for (const value of vertex) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
  }
  view.setUint16(offset, 0, true);
  return new Uint8Array(buffer);
}

export function makeSolidHeaderBinaryStl() {
  return makeBinaryStl({ header: 'solid this is still binary STL' });
}

export function makeTruncatedBinaryStl() {
  const valid = makeBinaryStl();
  return valid.subarray(0, valid.length - 8);
}

export function makeZeroNormalAsciiStl() {
  return makeAsciiStl({ normal: [0, 0, 0] });
}

export function makeDegenerateAsciiStl() {
  return makeAsciiStl({
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ],
  });
}
