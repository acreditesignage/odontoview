import { createEmptyLibrary } from './schema.js';
import { inferVariantAttributes } from './inferLibraryMetadata.js';

function slugify(value, fallback = 'unknown') {
  const slug = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function fallbackManufacturerName(displayInformation) {
  const cleaned = String(displayInformation ?? '')
    .replace(/^\s*\[[^\]]+\]\s*/, '')
    .trim();
  if (!cleaned) return 'Unknown manufacturer';
  return cleaned.split(/[\s|\-]+/).filter(Boolean)[0] || 'Unknown manufacturer';
}

function inferFamilyRole(type) {
  const text = `${type?.displayInformation ?? ''} ${type?.keyword ?? ''}`.toLowerCase();
  if (/\bimplante?\b|\bimplant\b/.test(text)) return 'implant';
  if (/\binterface\b|\blink\b/.test(text)) return 'interface';
  if (/\bscan\b|\bmarker\b|\btransfer\b/.test(text)) return 'scanbody';
  if (/\banalog|an[aá]logo/.test(text)) return 'analog';
  if (/\bparafuso\b|\bscrew\b/.test(text)) return 'screw';
  if (/\bpilar\b|\babutment\b/.test(text)) return 'abutment';
  if (/\bconversor\b|\bconverter\b/.test(text)) return 'converter';
  return 'unknown';
}

function extensionFormat(filename) {
  const match = String(filename ?? '').match(/\.([^.]+)$/);
  return match ? match[1].toUpperCase() : 'OTHER';
}

function signatureFor(filename, signatures, warnings) {
  const matchingSignatures = signatures
    .filter((entry) => entry?.filename === filename)
    .map((entry) => entry?.signature)
    .filter((signature) => signature != null);
  const uniqueSignatures = [...new Set(matchingSignatures)];

  if (uniqueSignatures.length > 1) {
    const warning = {
      code: 'CONFLICTING_GEOMETRY_SIGNATURES',
      message: 'Multiple different signatures reference the same geometry file; signature was left unresolved.',
      filename,
      signatures: uniqueSignatures,
    };
    if (!warnings.some((entry) => entry?.code === warning.code && entry?.filename === filename)) {
      warnings.push(warning);
    }
    return null;
  }

  return uniqueSignatures[0] ?? null;
}

function createGeometryAsset(role, filename, signatures, warnings) {
  if (!filename) return null;
  return {
    role,
    filename,
    format: extensionFormat(filename),
    sourceSignature: signatureFor(filename, signatures, warnings),
    validatedGeometry: false,
    redistributionAllowed: 'unknown',
  };
}

function normalizeGeometry(geometry, signatures, warnings) {
  return {
    implant: createGeometryAsset('implant', geometry?.implant, signatures, warnings),
    marker: createGeometryAsset('marker', geometry?.marker, signatures, warnings),
    screw: createGeometryAsset('screw', geometry?.screw, signatures, warnings),
    support: createGeometryAsset('support', geometry?.support, signatures, warnings),
    interface: createGeometryAsset('interface', geometry?.interface, signatures, warnings),
  };
}

function compactCoordinateFrame(frame) {
  return {
    registrationClickCenter: frame?.registrationClickCenter ?? null,
    axisAsymmetric: frame?.axisAsymmetric ?? null,
    axisOcclusal: frame?.axisOcclusal ?? null,
    axisScrewChannel: frame?.axisScrewChannel ?? null,
    supportOrientation: frame?.supportOrientation ?? null,
    referenceHeightOffset: frame?.referenceHeightOffset ?? null,
    referenceRotationOffset: frame?.referenceRotationOffset ?? null,
  };
}

function compatibilityFrom(node) {
  return {
    rotationLockEnabled: node?.isWithRotationLock ?? null,
    rotationLockCount: node?.rotationLockCount ?? null,
    maxScrewChannelAngleDeg: node?.constraints?.maxScrewChannelAngleDeg ?? null,
    maxScrewChannelAngleIsDesignConstraint:
      node?.constraints?.maxScrewChannelAngleIsDesignConstraint ?? null,
  };
}

function geometryFilenames(geometry) {
  return Object.values(geometry ?? {}).filter((value) => typeof value === 'string' && value.length > 0);
}

function normalizeVariant(subtype, familyId, variantIndex, signatures, warnings) {
  const inferred = inferVariantAttributes({
    displayInformation: subtype?.displayInformation,
    keyword: subtype?.keyword,
    filenames: geometryFilenames(subtype?.geometry),
  });
  warnings.push(...inferred.warnings);

  const display = subtype?.displayInformation ?? subtype?.keyword ?? `Variant ${variantIndex + 1}`;
  return {
    id: `${familyId}-variant-${variantIndex + 1}-${slugify(display, 'variant')}`,
    name: display,
    displayInformation: subtype?.displayInformation ?? null,
    keyword: subtype?.keyword ?? null,
    attributes: inferred.attributes,
    geometry: normalizeGeometry(subtype?.geometry, signatures, warnings),
    coordinateFrame: compactCoordinateFrame(subtype?.coordinateFrame),
    compatibility: compatibilityFrom(subtype),
    sourceAttributes: {
      ...(subtype?.sourceAttributes ?? {}),
      keyword: subtype?.keyword ?? null,
    },
  };
}

function normalizeFamily(type, systemId, familyIndex, signatures, warnings) {
  const label = type?.displayInformation ?? type?.keyword ?? `Component ${familyIndex + 1}`;
  const familyId = `${systemId}-component-${familyIndex + 1}-${slugify(label, 'component')}`;
  return {
    id: familyId,
    systemId,
    name: label,
    role: inferFamilyRole(type),
    keyword: type?.keyword ?? null,
    displayInformation: type?.displayInformation ?? null,
    geometry: normalizeGeometry(type?.geometry, signatures, warnings),
    coordinateFrame: compactCoordinateFrame(type?.coordinateFrame),
    compatibility: compatibilityFrom(type),
    variants: (type?.subtypes ?? []).map((subtype, variantIndex) =>
      normalizeVariant(subtype, familyId, variantIndex, signatures, warnings),
    ),
    sourceAttributes: {
      ...(type?.sourceAttributes ?? {}),
      keyword: type?.keyword ?? null,
    },
  };
}

export function normalizeImplantLibrary(parsed) {
  const source = parsed?.source;
  if (!source || typeof source !== 'object') {
    throw new TypeError('normalizeImplantLibrary requires parsed source data');
  }

  const warnings = [...(Array.isArray(parsed?.warnings) ? parsed.warnings : [])];
  const signatures = Array.isArray(source.signatures) ? source.signatures : [];
  const manufacturerName = source?.supplier?.name || fallbackManufacturerName(source.displayInformation);
  const systemName = source.displayInformation || 'Unknown implant system';
  const manufacturerId = slugify(manufacturerName, 'unknown-manufacturer');
  const systemId = `${manufacturerId}-${slugify(systemName, 'unknown-system')}`;

  const library = {
    ...createEmptyLibrary(),
    manufacturer: {
      id: manufacturerId,
      name: manufacturerName,
      supplierName: source?.supplier?.name ?? null,
      supplierUrl: source?.supplier?.url ?? null,
      source: source.sourceFormat ?? null,
    },
    system: {
      id: systemId,
      manufacturerId,
      name: systemName,
      displayName: systemName,
      sourceDisplayInformation: source.displayInformation ?? null,
    },
    geometry: normalizeGeometry(source.geometry, signatures, warnings),
    coordinateFrame: compactCoordinateFrame(source.coordinateFrame),
    compatibility: compatibilityFrom(source),
    components: (source.types ?? []).map((type, familyIndex) =>
      normalizeFamily(type, systemId, familyIndex, signatures, warnings),
    ),
    source: {
      format: source.sourceFormat ?? null,
      displayInformation: source.displayInformation ?? null,
      supplierName: source?.supplier?.name ?? null,
      supplierUrl: source?.supplier?.url ?? null,
      signatures: signatures.map((entry) => ({ ...entry })),
      sourceAttributes: { ...(source.sourceAttributes ?? {}) },
    },
  };

  return { library, warnings };
}
