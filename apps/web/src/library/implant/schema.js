export const IMPLANT_LIBRARY_SCHEMA_VERSION = 1;

export function createEmptyLibrary() {
  return {
    schemaVersion: IMPLANT_LIBRARY_SCHEMA_VERSION,
    manufacturer: null,
    system: null,
    components: [],
    source: {},
    validatedGeometry: false,
    redistributionAllowed: 'unknown',
  };
}

export function validateNormalizedLibrary(library) {
  const errors = [];

  if (!library || typeof library !== 'object') {
    return { valid: false, errors: ['library must be an object'] };
  }

  if (library.schemaVersion !== IMPLANT_LIBRARY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${IMPLANT_LIBRARY_SCHEMA_VERSION}`);
  }

  if (!library.manufacturer || typeof library.manufacturer !== 'object' || !library.manufacturer.name) {
    errors.push('manufacturer.name is required');
  }

  if (!library.system || typeof library.system !== 'object' || !library.system.name) {
    errors.push('system.name is required');
  }

  if (!Array.isArray(library.components)) {
    errors.push('components must be an array');
  }

  if (library.validatedGeometry !== false && library.validatedGeometry !== true) {
    errors.push('validatedGeometry must be boolean');
  }

  if (!['unknown', 'allowed', 'not-allowed'].includes(library.redistributionAllowed)) {
    errors.push('redistributionAllowed must be unknown, allowed, or not-allowed');
  }

  return { valid: errors.length === 0, errors };
}
