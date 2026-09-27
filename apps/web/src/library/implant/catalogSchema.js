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

export class ImplantCatalogValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ImplantCatalogValidationError';
    this.code = 'INVALID_IMPLANT_CATALOG';
    this.details = details;
  }
}

export function validateImplantCatalog(catalog) {
  const errors = [];

  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { valid: false, errors: ['catalog must be an object'] };
  }

  if (catalog.catalogSchemaVersion !== IMPLANT_CATALOG_SCHEMA_VERSION) {
    errors.push(`catalogSchemaVersion must be ${IMPLANT_CATALOG_SCHEMA_VERSION}`);
  }

  if (!Array.isArray(catalog.libraries)) {
    errors.push('libraries must be an array');
  }

  if (!catalog.diagnostics || typeof catalog.diagnostics !== 'object' || Array.isArray(catalog.diagnostics)) {
    errors.push('diagnostics must be an object');
  }

  if (!catalog.summary || typeof catalog.summary !== 'object' || Array.isArray(catalog.summary)) {
    errors.push('summary must be an object');
  } else {
    for (const field of SUMMARY_FIELDS) {
      if (!Number.isInteger(catalog.summary[field]) || catalog.summary[field] < 0) {
        errors.push(`summary.${field} must be a non-negative integer`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
