import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEWER_WORKSPACE_SLOTS,
  isWorkspacePaneId,
  resetWorkspaceSlots,
  swapWorkspacePanes
} from './viewerWorkspaceLayout.js';

test('default workspace matches approved five-pane planning layout', () => {
  assert.deepEqual(DEFAULT_VIEWER_WORKSPACE_SLOTS, {
    topLeft: 'tangential',
    topCenter: 'axial',
    topRight: 'orthogonal',
    bottomLeft: '3d',
    bottomRight: 'panoramic'
  });
});

test('swapWorkspacePanes deterministically swaps pane slots without mutating input', () => {
  const original = resetWorkspaceSlots();
  const next = swapWorkspacePanes(original, 'axial', '3d');
  assert.notStrictEqual(next, original);
  assert.equal(original.topCenter, 'axial');
  assert.equal(original.bottomLeft, '3d');
  assert.equal(next.topCenter, '3d');
  assert.equal(next.bottomLeft, 'axial');
});

test('unknown pane ids are rejected as a no-op copy', () => {
  const original = resetWorkspaceSlots();
  const next = swapWorkspacePanes(original, 'axial', 'unknown-pane');
  assert.deepEqual(next, original);
  assert.notStrictEqual(next, original);
  assert.equal(isWorkspacePaneId('orthogonal'), true);
  assert.equal(isWorkspacePaneId('coronal'), false);
});

test('resetWorkspaceSlots returns a fresh approved layout', () => {
  const a = resetWorkspaceSlots();
  const b = resetWorkspaceSlots();
  assert.deepEqual(a, DEFAULT_VIEWER_WORKSPACE_SLOTS);
  assert.deepEqual(b, DEFAULT_VIEWER_WORKSPACE_SLOTS);
  assert.notStrictEqual(a, b);
});
