import { parseExocadLibrary, ImplantLibraryParseError } from './parseExocadLibrary.js';
import { normalizeImplantLibrary } from './normalizeImplantLibrary.js';
import {
  IMPLANT_LIBRARY_SCHEMA_VERSION,
  validateNormalizedLibrary,
} from './schema.js';

export class ImplantLibraryImportError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'ImplantLibraryImportError';
    this.code = code;
    this.details = details;
  }
}

export function importImplantLibraryXml(xmlText) {
  const parsed = parseExocadLibrary(xmlText);
  const result = normalizeImplantLibrary(parsed);
  const validation = validateNormalizedLibrary(result.library);

  if (!validation.valid) {
    throw new ImplantLibraryImportError(
      'INVALID_NORMALIZED_LIBRARY',
      'Imported implant library does not satisfy OdontoView schema v1',
      validation.errors,
    );
  }

  return result;
}

export {
  IMPLANT_LIBRARY_SCHEMA_VERSION,
  ImplantLibraryParseError,
};

export {
  IMPLANT_CATALOG_SCHEMA_VERSION,
  ImplantCatalogValidationError,
  validateImplantCatalog,
} from './catalogSchema.js';

export { buildImplantCatalog } from './buildImplantCatalog.js';

export {
  getVariantGeometryAssets,
  listCatalogComponents,
  listCatalogManufacturers,
  listCatalogSystems,
  listCatalogVariants,
} from './catalogSelectors.js';
