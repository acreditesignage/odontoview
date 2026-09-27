import {
  IMPLANT_GEOMETRY_SCHEMA_VERSION,
  ImplantGeometryError,
  validateNeutralGeometry,
} from './geometrySchema.js';

const EPSILON = 1e-12;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactBytes(sourceBytes) {
  if (sourceBytes instanceof ArrayBuffer) return new Uint8Array(sourceBytes);
  if (ArrayBuffer.isView(sourceBytes)) {
    return new Uint8Array(sourceBytes.buffer, sourceBytes.byteOffset, sourceBytes.byteLength);
  }
  return null;
}

function parseFiniteTriple(tokens, label) {
  const values = tokens.map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new ImplantGeometryError(
      'INVALID_GEOMETRY_VALUE',
      `${label} must contain exactly three finite numbers.`,
      tokens,
    );
  }
  return values;
}

function triangleNormal(vertices) {
  const [a, b, c] = vertices;
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
  if (!Number.isFinite(length) || length <= EPSILON) {
    throw new ImplantGeometryError(
      'DEGENERATE_GEOMETRY',
      'STL triangle is degenerate and cannot produce a usable normal.',
    );
  }
  return [x / length, y / length, z / length];
}

function normalizeFacetNormal(normal, fallback) {
  const length = Math.hypot(...normal);
  if (!Number.isFinite(length)) {
    throw new ImplantGeometryError('INVALID_GEOMETRY_VALUE', 'STL facet normal contains invalid values.');
  }
  if (length <= EPSILON) return fallback;
  return normal.map((value) => value / length);
}

function parseAsciiStl(bytes) {
  const text = new TextDecoder().decode(bytes);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 9 || !/^solid(?:\s|$)/i.test(lines[0]) || !/^endsolid(?:\s|$)/i.test(lines.at(-1))) {
    throw new ImplantGeometryError('INVALID_STL', 'ASCII STL must contain solid and endsolid boundaries.');
  }

  const positions = [];
  const normals = [];
  let index = 1;
  let triangleCount = 0;

  while (index < lines.length - 1) {
    const facetMatch = lines[index].match(/^facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)$/i);
    if (!facetMatch) throw new ImplantGeometryError('INVALID_STL', 'ASCII STL facet normal is malformed.');
    const suppliedNormal = parseFiniteTriple(facetMatch.slice(1), 'facet normal');
    index += 1;

    if (!/^outer\s+loop$/i.test(lines[index] ?? '')) {
      throw new ImplantGeometryError('INVALID_STL', 'ASCII STL facet must contain an outer loop.');
    }
    index += 1;

    const vertices = [];
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
      const vertexMatch = (lines[index] ?? '').match(/^vertex\s+(\S+)\s+(\S+)\s+(\S+)$/i);
      if (!vertexMatch) {
        throw new ImplantGeometryError('INVALID_STL', 'ASCII STL facet must contain exactly three vertices.');
      }
      vertices.push(parseFiniteTriple(vertexMatch.slice(1), 'vertex'));
      index += 1;
    }

    if (!/^endloop$/i.test(lines[index] ?? '')) {
      throw new ImplantGeometryError('INVALID_STL', 'ASCII STL outer loop is not closed.');
    }
    index += 1;
    if (!/^endfacet$/i.test(lines[index] ?? '')) {
      throw new ImplantGeometryError('INVALID_STL', 'ASCII STL facet is not closed.');
    }
    index += 1;

    const geometricNormal = triangleNormal(vertices);
    const facetNormal = normalizeFacetNormal(suppliedNormal, geometricNormal);
    for (const vertex of vertices) {
      positions.push(...vertex);
      normals.push(...facetNormal);
    }
    triangleCount += 1;
  }

  if (triangleCount === 0 || index !== lines.length - 1) {
    throw new ImplantGeometryError('INVALID_STL', 'ASCII STL does not contain a complete triangle mesh.');
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(Array.from({ length: triangleCount * 3 }, (_, value) => value)),
    triangleCount,
  };
}

function computeBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

export function loadStlGeometry(asset, sourceBytes) {
  if (
    !asset
    || typeof asset !== 'object'
    || asset.resolution !== 'resolved'
    || !isNonEmptyString(asset.matchedPath)
  ) {
    throw new ImplantGeometryError(
      'UNRESOLVED_GEOMETRY',
      'Geometry asset must be resolved to one package path before loading.',
    );
  }

  const path = asset.matchedPath.trim();
  if (!path.toLowerCase().endsWith('.stl')) {
    throw new ImplantGeometryError(
      'UNSUPPORTED_GEOMETRY_FORMAT',
      'Milestone 3 supports STL geometry only.',
      [path],
    );
  }

  const bytes = exactBytes(sourceBytes);
  if (!bytes || bytes.byteLength === 0) {
    throw new ImplantGeometryError('INVALID_STL', 'STL source bytes are empty or invalid.');
  }

  const parsed = parseAsciiStl(bytes);
  const mesh = {
    geometrySchemaVersion: IMPLANT_GEOMETRY_SCHEMA_VERSION,
    source: {
      assetId: asset.id,
      sourcePath: path,
      filename: asset.filename,
      format: 'stl-ascii',
    },
    positions: parsed.positions,
    normals: parsed.normals,
    indices: parsed.indices,
    vertexCount: parsed.positions.length / 3,
    triangleCount: parsed.triangleCount,
    bounds: computeBounds(parsed.positions),
    safety: {
      validatedGeometry: asset.validatedGeometry,
      redistributionAllowed: asset.redistributionAllowed,
    },
  };

  const validation = validateNeutralGeometry(mesh);
  if (!validation.valid) {
    throw new ImplantGeometryError(
      'INVALID_STL',
      'Parsed STL does not satisfy OdontoView neutral geometry schema.',
      validation.errors,
    );
  }

  return mesh;
}
