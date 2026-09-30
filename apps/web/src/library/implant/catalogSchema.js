export const IMPLANT_CATALOG_SCHEMA_VERSION = 1;

const SUMMARY_FIELDS = [
  'totalEntries',
  'importedEntries',
  'unsupportedEntries',
  'invalidEntries',
  'geometryReferences',
  'resolvedGeometryFiles',
  'missingGeometryFiles',
  'ambiguousGeometryFiles',
];

const RESOLUTION_VALUES = ['resolved', 'missing', 'ambiguous'];

export class ImplantCatalogValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ImplantCatalogValidationError';
    this.code = 'INVALID_IMPLANT_CATALOG';
    this.details = details;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateGeometryMap(geometry, path, errors, stats) {
  if (geometry == null) return;
  if (!isObject(geometry)) {
    errors.push(`${path} must be an object`);
    return;
  }

  for (const [role, asset] of Object.entries(geometry)) {
    if (asset == null) continue;
    const assetPath = `${path}.${role}`;
    if (!isObject(asset)) {
      errors.push(`${assetPath} must be an object or null`);
      continue;
    }

    if (!isNonEmptyString(asset.filename)) {
      errors.push(`${assetPath}.filename must be a non-empty string`);
    }
    if (!isNonEmptyString(asset.reference)) {
      errors.push(`${assetPath}.reference must be a non-empty string`);
    }

    if (!RESOLUTION_VALUES.includes(asset.resolution)) {
      errors.push(`${assetPath}.resolution must be resolved, missing, or ambiguous`);
      continue;
    }

    stats.references += 1;
    stats[asset.resolution] += 1;

    if (asset.resolution === 'resolved' && !isNonEmptyString(asset.matchedPath)) {
      errors.push(`${assetPath}.matchedPath is required for resolved geometry`);
    }

    if (
      asset.resolution === 'ambiguous'
      && (!Array.isArray(asset.candidates)
        || asset.candidates.length < 2
        || asset.candidates.some((candidate) => !isNonEmptyString(candidate)))
    ) {
      errors.push(`${assetPath}.candidates must contain at least two non-empty paths for ambiguous geometry`);
    }
  }
}

function validateLibrary(library, libraryIndex, errors, stats) {
  const path = `libraries[${libraryIndex}]`;
  if (!isObject(library)) {
    errors.push(`${path} must be an object`);
    return;
  }

  if (!isNonEmptyString(library.id)) errors.push(`${path}.id must be a non-empty string`);
  if (!isNonEmptyString(library.sourcePath)) errors.push(`${path}.sourcePath must be a non-empty string`);

  if (!Array.isArray(library.components)) {
    errors.push(`${path}.components must be an array`);
    return;
  }

  const componentIds = new Set();
  const variantIds = new Set();

  validateGeometryMap(library.geometry, `${path}.geometry`, errors, stats);

  library.components.forEach((component, componentIndex) => {
    const componentPath = `${path}.components[${componentIndex}]`;
    if (!isObject(component)) {
      errors.push(`${componentPath} must be an object`);
      return;
    }

    if (isNonEmptyString(component.id)) {
      if (componentIds.has(component.id)) errors.push(`duplicate component id: ${component.id}`);
      else componentIds.add(component.id);
    } else {
      errors.push(`${componentPath}.id must be a non-empty string`);
    }

    validateGeometryMap(component.geometry, `${componentPath}.geometry`, errors, stats);

    if (!Array.isArray(component.variants)) {
      errors.push(`${componentPath}.variants must be an array`);
      return;
    }

    component.variants.forEach((variant, variantIndex) => {
      const variantPath = `${componentPath}.variants[${variantIndex}]`;
      if (!isObject(variant)) {
        errors.push(`${variantPath} must be an object`);
        return;
      }

      if (isNonEmptyString(variant.id)) {
        if (variantIds.has(variant.id)) errors.push(`duplicate variant id: ${variant.id}`);
        else variantIds.add(variant.id);
      } else {
        errors.push(`${variantPath}.id must be a non-empty string`);
      }

      validateGeometryMap(variant.geometry, `${variantPath}.geometry`, errors, stats);
    });
  });
}

export function validateImplantCatalog(catalog) {
  const errors = [];

  if (!isObject(catalog)) {
    return { valid: false, errors: ['catalog must be an object'] };
  }

  if (catalog.catalogSchemaVersion !== IMPLANT_CATALOG_SCHEMA_VERSION) {
    errors.push(`catalogSchemaVersion must be ${IMPLANT_CATALOG_SCHEMA_VERSION}`);
  }

  const stats = { references: 0, resolved: 0, missing: 0, ambiguous: 0 };
  const libraryIds = new Set();

  if (!Array.isArray(catalog.libraries)) {
    errors.push('libraries must be an array');
  } else {
    catalog.libraries.forEach((library, libraryIndex) => {
      if (isObject(library) && isNonEmptyString(library.id)) {
        if (libraryIds.has(library.id)) errors.push(`duplicate library id: ${library.id}`);
        else libraryIds.add(library.id);
      }
      validateLibrary(library, libraryIndex, errors, stats);
    });
  }

  let diagnosticsValid = true;
  if (!isObject(catalog.diagnostics)) {
    errors.push('diagnostics must be an object');
    diagnosticsValid = false;
  } else {
    for (const field of ['unsupportedEntries', 'invalidEntries', 'warnings']) {
      if (!Array.isArray(catalog.diagnostics[field])) {
        errors.push(`diagnostics.${field} must be an array`);
        diagnosticsValid = false;
      }
    }
  }

  let summaryValid = true;
  if (!isObject(catalog.summary)) {
    errors.push('summary must be an object');
    summaryValid = false;
  } else {
    for (const field of SUMMARY_FIELDS) {
      if (!Number.isInteger(catalog.summary[field]) || catalog.summary[field] < 0) {
        errors.push(`summary.${field} must be a non-negative integer`);
        summaryValid = false;
      }
    }
  }

  if (summaryValid && Array.isArray(catalog.libraries) && diagnosticsValid) {
    const expectedImported = catalog.libraries.length;
    const expectedUnsupported = catalog.diagnostics.unsupportedEntries.length;
    const expectedInvalid = catalog.diagnostics.invalidEntries.length;
    const expectedTotal = expectedImported + expectedUnsupported + expectedInvalid;

    if (catalog.summary.importedEntries !== expectedImported) {
      errors.push(`summary.importedEntries must equal libraries.length (${expectedImported})`);
    }
    if (catalog.summary.unsupportedEntries !== expectedUnsupported) {
      errors.push(`summary.unsupportedEntries must equal diagnostics.unsupportedEntries.length (${expectedUnsupported})`);
    }
    if (catalog.summary.invalidEntries !== expectedInvalid) {
      errors.push(`summary.invalidEntries must equal diagnostics.invalidEntries.length (${expectedInvalid})`);
    }
    if (catalog.summary.totalEntries !== expectedTotal) {
      errors.push(`summary.totalEntries must equal imported + unsupported + invalid entries (${expectedTotal})`);
    }
    if (catalog.summary.geometryReferences !== stats.references) {
      errors.push(`summary.geometryReferences must equal catalog geometry references (${stats.references})`);
    }
    if (catalog.summary.resolvedGeometryFiles !== stats.resolved) {
      errors.push(`summary.resolvedGeometryFiles must equal resolved catalog geometry (${stats.resolved})`);
    }
    if (catalog.summary.missingGeometryFiles !== stats.missing) {
      errors.push(`summary.missingGeometryFiles must equal missing catalog geometry (${stats.missing})`);
    }
    if (catalog.summary.ambiguousGeometryFiles !== stats.ambiguous) {
      errors.push(`summary.ambiguousGeometryFiles must equal ambiguous catalog geometry (${stats.ambiguous})`);
    }
  }

  return { valid: errors.length === 0, errors };
}
