import { XMLParser, XMLValidator } from 'fast-xml-parser';

export class ImplantLibraryParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImplantLibraryParseError';
    this.code = code;
  }
}

const ARRAY_TAGS = new Set(['ImplantTypeConfig', 'ImplantSubtypeConfig', 'FileSignature']);

function textValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, '#text')) {
    return textValue(value['#text']);
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function stringValue(value) {
  const text = textValue(value);
  return text === null || text === '' ? null : text;
}

function booleanValue(value) {
  const text = textValue(value);
  if (text === null || text === '') return null;
  if (text.toLowerCase() === 'true') return true;
  if (text.toLowerCase() === 'false') return false;
  return null;
}

function numberValue(value, path, warnings) {
  if (value === undefined || value === null) return null;
  const text = textValue(value);
  if (text === null || text === '') {
    warnings.push({
      code: 'EMPTY_NUMBER',
      path,
      value: text,
      message: `Empty numeric value at ${path}`,
    });
    return null;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    warnings.push({
      code: 'MALFORMED_NUMBER',
      path,
      value: text,
      message: `Malformed numeric value at ${path}`,
    });
    return null;
  }
  return parsed;
}

function vectorValue(node, key, path, warnings) {
  if (!node || node[key] === undefined || node[key] === null) return null;
  const vector = node[key];
  if (typeof vector !== 'object' || Array.isArray(vector)) {
    warnings.push({
      code: 'MALFORMED_VECTOR',
      path,
      value: vector,
      message: `Malformed vector at ${path}`,
    });
    return { x: null, y: null, z: null };
  }
  return {
    x: numberValue(vector.x, `${path}.x`, warnings),
    y: numberValue(vector.y, `${path}.y`, warnings),
    z: numberValue(vector.z, `${path}.z`, warnings),
  };
}

function geometryValue(node) {
  return {
    implant: stringValue(node?.ImplantFilename),
    marker: stringValue(node?.MarkerFilename),
    screw: stringValue(node?.ScrewFilename),
    support: stringValue(node?.SupportFilename),
    interface: stringValue(node?.InterfaceFilename),
  };
}

function coordinateFrameValue(node, path, warnings) {
  return {
    registrationClickCenter: vectorValue(node, 'RegistrationClickCenter', `${path}.RegistrationClickCenter`, warnings),
    axisAsymmetric: vectorValue(node, 'AxisAsymmetric', `${path}.AxisAsymmetric`, warnings),
    axisOcclusal: vectorValue(node, 'AxisOcclusal', `${path}.AxisOcclusal`, warnings),
    axisScrewChannel: vectorValue(node, 'AxisScrewChannel', `${path}.AxisScrewChannel`, warnings),
    supportOrientation: numberValue(node?.SupportOrientation, `${path}.SupportOrientation`, warnings),
    referenceHeightOffset: numberValue(node?.ReferenceHeightOffset, `${path}.ReferenceHeightOffset`, warnings),
    referenceRotationOffset: numberValue(node?.ReferenceRotationOffset, `${path}.ReferenceRotationOffset`, warnings),
  };
}

function constraintsValue(node, path, warnings) {
  const rawMaxAngle = node?.AxisScrewChannelMaxUserAngle;
  return {
    maxScrewChannelAngleDeg: numberValue(rawMaxAngle, `${path}.AxisScrewChannelMaxUserAngle`, warnings),
    maxScrewChannelAngleIsDesignConstraint:
      rawMaxAngle && typeof rawMaxAngle === 'object'
        ? booleanValue(rawMaxAngle['@_IsDesignConstraint'])
        : null,
  };
}

function parseSubtype(node, typeIndex, subtypeIndex, warnings) {
  const path = `ImplantLibraryEntry.TypeConfig.ImplantTypeConfig[${typeIndex}].SubtypeConfig.ImplantSubtypeConfig[${subtypeIndex}]`;
  return {
    displayInformation: stringValue(node?.DisplayInformation),
    keyword: stringValue(node?.Keyword),
    geometry: geometryValue(node),
    coordinateFrame: coordinateFrameValue(node, path, warnings),
    constraints: constraintsValue(node, path, warnings),
    isWithInterface: booleanValue(node?.IsWithInterface),
    isWithRotationLock: booleanValue(node?.IsWithRotationLock),
    rotationLockCount: numberValue(node?.RotationLockCount, `${path}.RotationLockCount`, warnings),
    sourceAttributes: {},
  };
}

function parseType(node, typeIndex, warnings) {
  const path = `ImplantLibraryEntry.TypeConfig.ImplantTypeConfig[${typeIndex}]`;
  const subtypes = node?.SubtypeConfig?.ImplantSubtypeConfig ?? [];
  return {
    displayInformation: stringValue(node?.DisplayInformation),
    keyword: stringValue(node?.Keyword),
    geometry: geometryValue(node),
    coordinateFrame: coordinateFrameValue(node, path, warnings),
    constraints: constraintsValue(node, path, warnings),
    isWithInterface: booleanValue(node?.IsWithInterface),
    isWithRotationLock: booleanValue(node?.IsWithRotationLock),
    rotationLockCount: numberValue(node?.RotationLockCount, `${path}.RotationLockCount`, warnings),
    subtypes: subtypes.map((subtype, subtypeIndex) => parseSubtype(subtype, typeIndex, subtypeIndex, warnings)),
    sourceAttributes: {},
  };
}

function parseSignatures(root) {
  const entries = root?.FileSignatures?.FileSignature ?? [];
  return entries.map((entry) => ({
    filename: stringValue(entry?.Filename),
    signature: stringValue(entry?.Signature),
  }));
}

export function parseExocadLibrary(xmlText) {
  if (typeof xmlText !== 'string' || xmlText.trim() === '') {
    throw new ImplantLibraryParseError('INVALID_XML', 'Implant library XML must be a non-empty string');
  }

  const validation = XMLValidator.validate(xmlText);
  if (validation !== true) {
    const detail = validation?.err?.msg ? `: ${validation.err.msg}` : '';
    throw new ImplantLibraryParseError('INVALID_XML', `Invalid implant library XML${detail}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => ARRAY_TAGS.has(name),
  });

  const parsed = parser.parse(xmlText);
  const root = parsed?.ImplantLibraryEntry;
  if (!root || typeof root !== 'object') {
    throw new ImplantLibraryParseError('UNSUPPORTED_ROOT', 'Expected ImplantLibraryEntry as XML root');
  }

  const warnings = [];
  const types = root?.TypeConfig?.ImplantTypeConfig ?? [];
  const path = 'ImplantLibraryEntry';
  const maxAngle = root?.AxisScrewChannelMaxUserAngle;

  const source = {
    sourceFormat: 'exocad-implant-library',
    displayInformation: stringValue(root.DisplayInformation),
    supplier: {
      name: stringValue(root.Supplier),
      url: stringValue(root.SupplierLink),
    },
    geometry: geometryValue(root),
    coordinateFrame: coordinateFrameValue(root, path, warnings),
    constraints: constraintsValue(root, path, warnings),
    isWithInterface: booleanValue(root.IsWithInterface),
    isWithRotationLock: booleanValue(root.IsWithRotationLock),
    rotationLockCount: numberValue(root.RotationLockCount, `${path}.RotationLockCount`, warnings),
    types: types.map((type, typeIndex) => parseType(type, typeIndex, warnings)),
    signatures: parseSignatures(root),
    sourceAttributes: {
      maxScrewChannelAngleRaw: stringValue(maxAngle),
    },
  };

  return { source, warnings };
}
