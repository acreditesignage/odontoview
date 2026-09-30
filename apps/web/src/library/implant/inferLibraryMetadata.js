function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseNumber(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function filenameHasUnlabeledNumbers(filename) {
  return typeof filename === 'string' && /\d/.test(filename);
}

export function inferVariantAttributes({ displayInformation = null, keyword = null, filenames = [] } = {}) {
  const attributes = {};
  const warnings = [];
  const display = cleanText(displayInformation);
  const key = cleanText(keyword);
  const combinedExplicit = `${display} ${key}`.trim();

  const explicitOffset = display.match(/^\s*\+\s*(\d+(?:[.,]\d+)?)\s*mm\b/i);
  if (explicitOffset) {
    const value = parseNumber(explicitOffset[1]);
    if (value !== null) attributes.dimensionOffsetMm = value;
  }

  if (attributes.dimensionOffsetMm === undefined) {
    const cinta = display.match(/\bcinta\s+(\d+(?:[.,]\d+)?)\s*mm\b/i);
    const exactMm = display.match(/^\s*(\d+(?:[.,]\d+)?)\s*mm\s*$/i);
    const heightMatch = cinta || exactMm;
    if (heightMatch) {
      const value = parseNumber(heightMatch[1]);
      if (value !== null) attributes.heightMm = value;
    }
  }

  if (/\bSMALL\b/i.test(combinedExplicit)) attributes.sizeClass = 'SMALL';
  else if (/\bLARGE\b/i.test(combinedExplicit)) attributes.sizeClass = 'LARGE';

  if (/\[(?:aberto|open)\]/i.test(display) || /\b(?:aberto|open)\b/i.test(display)) {
    attributes.design = 'open';
  } else if (/\[(?:fechado|closed)\]/i.test(display) || /\b(?:fechado|closed)\b/i.test(display)) {
    attributes.design = 'closed';
  }

  if (/\bHex\b/i.test(display)) {
    attributes.rotationMode = 'hex';
  } else if (/\bRot\b/i.test(display) || /\brotacional\b/i.test(display)) {
    attributes.rotationMode = 'rotational';
  }

  const fileList = Array.isArray(filenames) ? filenames.filter(Boolean) : [];
  if (
    Object.keys(attributes).length === 0 &&
    fileList.some(filenameHasUnlabeledNumbers)
  ) {
    warnings.push({
      code: 'AMBIGUOUS_FILENAME_METADATA',
      message: 'Filename contains numeric tokens without an explicit semantic label; no clinical dimension was inferred.',
      filenames: fileList,
    });
  }

  return { attributes, warnings };
}
