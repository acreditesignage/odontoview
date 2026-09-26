export const IMPLANT_LIBRARY_SCHEMA_VERSION = 1;

const REDISTRIBUTION_VALUES = ['unknown', 'allowed', 'not-allowed'];

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

function validateGeometryMap(geometry, path, errors) {
  if (geometry == null) return;
  if (typeof geometry !== 'object' || Array.isArray(geometry)) {
    errors.push(`${path} must be an object`);
    return;
  }

  for (const [role, asset] of Object.entries(geometry)) {
    if (asset == null) continue;
    if (typeof asset !== 'object' || Array.isArray(asset)) {
      errors.push(`${path}.${role} must be an object or null`);
      continue;
    }

    if (typeof asset.filename !== 'string' || asset.filename.trim().length === 0) {
      errors.push(`${path}.${role}.filename must be a non-empty string`);
    }

    if (asset.validatedGeometry !== false && asset.validatedGeometry !== true) {
      errors.push(`${path}.${role}.validatedGeometry must be boolean`);
    }

    if (!REDISTRIBUTION_VALUES.includes(asset.redistributionAllowed)) {
      errors.push(
        `${path}.${role}.redistributionAllowed must be unknown, allowed, or not-allowed`,
      );
    }
  }
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
  } else {
    const componentIds = new Set();
    const variantIds = new Set();

    library.components.forEach((component, componentIndex) => {
      if (!component || typeof component !== 'object' || Array.isArray(component)) {
        errors.push(`components[${componentIndex}] must be an object`);
        return;
      }

      if (typeof component.id === 'string' && component.id.length > 0) {
        if (componentIds.has(component.id)) {
          errors.push(`duplicate component id: ${component.id}`);
        } else {
          componentIds.add(component.id);
        }
      }

      if (!Array.isArray(component.variants)) {
        errors.push(`components[${componentIndex}].variants must be an array`);
      } else {
        component.variants.forEach((variant, variantIndex) => {
          if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
            errors.push(`components[${componentIndex}].variants[${variantIndex}] must be an object`);
            return;
          }

          if (typeof variant.id === 'string' && variant.id.length > 0) {
            if (variantIds.has(variant.id)) {
              errors.push(`duplicate variant id: ${variant.id}`);
            } else {
              variantIds.add(variant.id);
            }
          }

          validateGeometryMap(
            variant.geometry,
            `components[${componentIndex}].variants[${variantIndex}].geometry`,
            errors,
          );
        });
      }

      validateGeometryMap(component.geometry, `components[${componentIndex}].geometry`, errors);
    });
  }

  if (library.validatedGeometry !== false && library.validatedGeometry !== true) {
    errors.push('validatedGeometry must be boolean');
  }

  if (!REDISTRIBUTION_VALUES.includes(library.redistributionAllowed)) {
    errors.push('redistributionAllowed must be unknown, allowed, or not-allowed');
  }

  validateGeometryMap(library.geometry, 'geometry', errors);

  return { valid: errors.length === 0, errors };
}
