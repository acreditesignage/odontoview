/* DICOM single-frame series validation, independent of the renderer.
 * Geometry: DICOM PS3.3 C.7.6.2.1.1. Distances are in millimetres.
 * This validates the input stack; it does not implement patient-space MPR.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OdontoDicomMetadata = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Accommodate rounded DICOM DS values, not materially different geometry.
  const DIRECTION_TOLERANCE = 1e-4;
  const POSITION_TOLERANCE_MM = 1e-3;
  const SPACING_TOLERANCE_MM = 0.01;
  const SPACING_RELATIVE_TOLERANCE = 0.01;

  function text(value) { return String(value == null ? '' : value).replace(/\0/g, '').trim(); }
  function number(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (text(value) === '') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }
  function vector(value, length) {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split('\\') : [];
    const result = values.map(number);
    return result.length === length && result.every(v => v !== null) ? result : null;
  }
  function dot(a, b) { return a.reduce((sum, v, i) => sum + v * b[i], 0); }
  function cross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  }
  function unit(v) { const length = Math.hypot(...v); return v.map(n => n / length); }
  function closeVector(a, b, tolerance) { return a.every((v, i) => Math.abs(v-b[i]) <= tolerance); }
  function spacingTolerance(spacing) {
    return Math.max(SPACING_TOLERANCE_MM, Math.abs(spacing) * SPACING_RELATIVE_TOLERANCE);
  }
  function median(values) {
    const sorted = [...values].sort((a,b) => a-b);
    const middle = Math.floor(sorted.length/2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
  }

  function normalize(raw) {
    const result = { ...raw };
    for (const key of ['studyInstanceUID','seriesInstanceUID','frameOfReferenceUID','sopInstanceUID',
      'studyDescription','seriesDescription','bodyPartExamined','protocolName','patientPosition']) {
      result[key] = text(raw[key]);
    }
    for (const key of ['rows','columns','sliceThickness','spacingBetweenSlices','instanceNumber','sliceLocation']) {
      result[key] = number(raw[key]);
    }
    const frameCount = raw.numberOfFrames == null || text(raw.numberOfFrames) === '' ? 1 : number(raw.numberOfFrames);
    // Keep invalidity through readDataSet -> validateImport normalization.
    result.numberOfFrames = frameCount === null ? 0 : frameCount;
    result.imagePosition = vector(raw.imagePosition,3);
    result.orientation = vector(raw.orientation,6);
    result.pixelSpacing = vector(raw.pixelSpacing,2);
    result.zPos = result.imagePosition ? result.imagePosition[2] : null;
    return result;
  }

  // dicom-parser returns US dimensions as uint16, and DS/IS/UI values as strings.
  function readDataSet(dataSet) {
    return normalize({
      studyInstanceUID: dataSet.string('x0020000d'),
      seriesInstanceUID: dataSet.string('x0020000e'),
      frameOfReferenceUID: dataSet.string('x00200052'),
      sopInstanceUID: dataSet.string('x00080018'),
      imagePosition: dataSet.string('x00200032'),
      orientation: dataSet.string('x00200037'),
      pixelSpacing: dataSet.string('x00280030'),
      sliceThickness: dataSet.string('x00180050'),
      spacingBetweenSlices: dataSet.string('x00180088'),
      rows: dataSet.uint16('x00280010'),
      columns: dataSet.uint16('x00280011'),
      numberOfFrames: dataSet.string('x00280008'),
      instanceNumber: dataSet.string('x00200013'),
      sliceLocation: dataSet.string('x00201041'),
      studyDescription: dataSet.string('x00081030'),
      seriesDescription: dataSet.string('x0008103e'),
      bodyPartExamined: dataSet.string('x00180015'),
      protocolName: dataSet.string('x00181030'),
      patientPosition: dataSet.string('x00185100')
    });
  }

  function orientationValid(o) {
    if (!o) return false;
    const a=o.slice(0,3), b=o.slice(3,6);
    return Math.abs(Math.hypot(...a)-1) <= DIRECTION_TOLERANCE &&
      Math.abs(Math.hypot(...b)-1) <= DIRECTION_TOLERANCE &&
      Math.abs(dot(a,b)) <= DIRECTION_TOLERANCE;
  }

  function validateSeries(items) {
    const errors=[], warnings=[];
    const report = { valid:false, items, sortedItems:[], sliceNormal:null, slicePositions:[],
      spacings:[], nominalSpacing:null, errors, warnings };
    const add = (code, message, indices=[]) => errors.push({code,message,indices});
    const warn = (code, message, indices=[]) => warnings.push({code,message,indices});
    const seenInstances = new Map();

    items.forEach((item,index) => {
      if (item.parseError) add('PARSE_ERROR','Um arquivo não pôde ser lido como DICOM. Selecione apenas imagens DICOM da mesma série.',[index]);
      for (const key of ['studyInstanceUID','seriesInstanceUID','frameOfReferenceUID']) {
        if (!item[key]) add('MISSING_UID','Faltam identificadores de estudo, série ou referência espacial. Não é possível validar este volume.',[index]);
      }
      if (!Number.isInteger(item.rows) || item.rows < 1 || !Number.isInteger(item.columns) || item.columns < 1) {
        add('INVALID_DIMENSIONS','Rows/Columns ausentes ou inválidos.',[index]);
      }
      if (!item.pixelSpacing || item.pixelSpacing.some(v => v <= 0)) {
        add('INVALID_PIXEL_SPACING','Pixel Spacing ausente ou inválido. Não é possível determinar as dimensões físicas.',[index]);
      }
      if (!item.imagePosition) add('INVALID_POSITION','Posição espacial DICOM ausente ou inválida.',[index]);
      if (!orientationValid(item.orientation)) add('INVALID_ORIENTATION','Orientação DICOM ausente ou inválida.',[index]);
      if (item.numberOfFrames !== 1) add('UNSUPPORTED_MULTIFRAME','DICOM multi-frame/Enhanced não é suportado nesta etapa. Exporte uma série de arquivos com uma fatia por arquivo.',[index]);
      if (item.sopInstanceUID) {
        if (seenInstances.has(item.sopInstanceUID)) add('DUPLICATE_INSTANCE','Há arquivos DICOM repetidos. Selecione uma única cópia de cada corte.',[seenInstances.get(item.sopInstanceUID),index]);
        else seenInstances.set(item.sopInstanceUID,index);
      }
      for (const key of ['sliceThickness','spacingBetweenSlices']) {
        if (item[key] !== null && item[key] <= 0) warn('INVALID_OPTIONAL_SPACING','Espessura ou espaçamento declarado inválido; a validação usa as posições espaciais.',[index]);
      }
    });
    if (!items.length || errors.length) return report;

    const first=items[0];
    report.sliceNormal=unit(cross(first.orientation.slice(0,3),first.orientation.slice(3,6)));
    const projected=items.map((item,index) => {
      if (item.rows !== first.rows || item.columns !== first.columns) add('DIMENSIONS_MISMATCH','Os cortes têm Rows/Columns diferentes. Selecione uma série com dimensões consistentes.',[index]);
      if (!closeVector(item.pixelSpacing,first.pixelSpacing,1e-5)) add('PIXEL_SPACING_MISMATCH','O Pixel Spacing muda entre os cortes. Esta série não pode formar um volume uniforme.',[index]);
      if (!closeVector(item.orientation,first.orientation,DIRECTION_TOLERANCE)) add('ORIENTATION_MISMATCH','A orientação muda entre os cortes. Selecione uma série com orientação consistente.',[index]);
      const displacement=item.imagePosition.map((v,i) => v-first.imagePosition[i]);
      const normalDistance=dot(displacement,report.sliceNormal);
      const drift=Math.hypot(...displacement.map((v,i) => v-normalDistance*report.sliceNormal[i]));
      if (drift > SPACING_TOLERANCE_MM) add('IN_PLANE_SHIFT','Os cortes têm deslocamento lateral entre si. Este volume exige reamostragem, ainda não disponível.',[index]);
      return {...item, sliceCoord:dot(item.imagePosition,report.sliceNormal)};
    }).sort((a,b) => a.sliceCoord-b.sliceCoord);
    report.sortedItems=projected;
    report.slicePositions=projected.map(item => item.sliceCoord);
    for (let i=1; i<projected.length; i++) {
      const distance=projected[i].sliceCoord-projected[i-1].sliceCoord;
      report.spacings.push(distance);
      if (distance <= POSITION_TOLERANCE_MM) add('DUPLICATE_POSITION','Há cortes na mesma posição espacial. Remova duplicatas ou separe as aquisições.',[i-1,i]);
    }
    const positive=report.spacings.filter(v => v > POSITION_TOLERANCE_MM);
    if (positive.length) {
      report.nominalSpacing=median(positive);
      if (positive.some(v => Math.abs(v-report.nominalSpacing) > spacingTolerance(report.nominalSpacing))) {
        add('IRREGULAR_SPACING','O espaçamento entre os cortes é irregular. O visualizador atual exige uma série uniforme.');
      }
      // Smallest observed interval detects isolated gaps even in short stacks.
      const minimum=Math.min(...positive);
      const declared=items.map(item => item.spacingBetweenSlices).filter(v => v !== null && v > 0);
      const declaredConsistent=declared.length === items.length && declared.every(v => Math.abs(v-declared[0]) <= spacingTolerance(declared[0]));
      const expected=declaredConsistent ? Math.min(minimum,declared[0]) : minimum;
      if (positive.some(v => v > expected*1.5 + POSITION_TOLERANCE_MM)) {
        add('SLICE_GAP','Há uma possível lacuna entre cortes. Verifique se todos os arquivos da série foram selecionados.');
      }
      if (declared.some(v => Math.abs(v-report.nominalSpacing) > spacingTolerance(report.nominalSpacing))) {
        warn('DECLARED_SPACING_MISMATCH','O espaçamento declarado difere das posições espaciais dos cortes.');
      }
    } else if (items.length === 1) {
      warn('SINGLE_SLICE','Apenas uma fatia: não é possível verificar o espaçamento entre cortes.');
    }
    report.valid=errors.length === 0;
    return report;
  }

  function validateImport(rawItems) {
    const groups=new Map();
    for (const raw of rawItems) {
      const item=normalize(raw);
      const key=JSON.stringify([item.studyInstanceUID,item.seriesInstanceUID,item.frameOfReferenceUID]);
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(item);
    }
    const series=[...groups.values()].map(validateSeries);
    const errors=[], warnings=[];
    if (!series.length) errors.push({code:'NO_FILES',message:'Nenhum arquivo DICOM selecionado.'});
    if (series.length > 1) errors.push({code:'MULTIPLE_SERIES',message:`Foram encontradas ${series.length} séries ou referências espaciais diferentes. Selecione apenas os arquivos de uma única série; nenhum volume foi montado.`});
    series.forEach((report,seriesIndex) => {
      report.errors.forEach(error => errors.push({...error,seriesIndex}));
      report.warnings.forEach(warning => warnings.push({...warning,seriesIndex}));
    });
    return {valid:errors.length === 0,series,errors,warnings};
  }

  function assertValidImport(items) {
    const report=validateImport(items);
    if (!report.valid) {
      const error=new Error([...new Set(report.errors.map(e => e.message))].slice(0,4).join('\n\n'));
      error.name='DicomValidationError';
      error.report=report;
      throw error;
    }
    return report.series[0];
  }

  return {normalize,readDataSet,validateImport,assertValidImport};
});
