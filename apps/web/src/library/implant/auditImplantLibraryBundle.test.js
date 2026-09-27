import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function loadAudit() {
  const mod = await import('./auditImplantLibraryBundle.js').catch(() => null);
  assert.ok(mod, 'auditImplantLibraryBundle.js must exist');
  return mod.auditImplantLibraryBundle;
}

test('audits a mixed implant bundle without forcing unsupported library roots into schema v1', async () => {
  const auditImplantLibraryBundle = await loadAudit();
  const report = auditImplantLibraryBundle({
    entries: [
      { path: 'implant/SIN_CM_SW/config.xml', xmlText: await fixture('sin-minimal.xml') },
      { path: 'modelcreator/Implants/SIN_Implantes_Digital/config.xml', xmlText: '<?xml version="1.0"?><ModelLabAnalogEntries />' },
    ],
    availableFiles: [
      'implant/SIN_CM_SW/J_CMSW.stl',
      'implant/SIN_CM_SW/160323_PT 16 - Parafuso de retencao.sdfa',
      'implant/SIN_CM_SW/ICMT 0502.stl',
    ],
  });

  assert.equal(report.summary.totalEntries, 2);
  assert.equal(report.summary.importedEntries, 1);
  assert.equal(report.summary.unsupportedEntries, 1);
  assert.equal(report.summary.invalidEntries, 0);

  assert.equal(report.entries[0].status, 'imported');
  assert.equal(report.entries[0].library.system.name, 'SIN | CM 16° (STRONG SW)');
  assert.equal(report.entries[1].status, 'unsupported');
  assert.equal(report.entries[1].error.code, 'UNSUPPORTED_ROOT');
});

test('reports geometry references as resolved, missing or ambiguous using bundle file paths', async () => {
  const auditImplantLibraryBundle = await loadAudit();
  const report = auditImplantLibraryBundle({
    entries: [
      { path: 'implant/SIN_CM_SW/config.xml', xmlText: await fixture('sin-minimal.xml') },
    ],
    availableFiles: [
      'implant/SIN_CM_SW/J_CMSW.stl',
      'implant/SIN_CM_SW/160323_PT 16 - Parafuso de retencao.sdfa',
      'other/ICMT 0502.stl',
      'duplicate/ICMT 0502.stl',
    ],
  });

  const entry = report.entries[0];
  assert.ok(entry.geometry.resolved.some((item) => item.reference === 'J_CMSW.stl'));
  assert.ok(entry.geometry.ambiguous.some((item) => item.reference === 'ICMT 0502.stl'));
  assert.ok(entry.geometry.missing.length > 0);
  assert.equal(report.summary.ambiguousGeometryFiles, entry.geometry.ambiguous.length);
  assert.equal(report.summary.missingGeometryFiles, entry.geometry.missing.length);
});
