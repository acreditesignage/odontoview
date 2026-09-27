import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const viewerSource = readFileSync(new URL('./Viewer2.jsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('viewer2 mounts the five-pane 3d-first workspace model', () => {
  assert.match(viewerSource, /resetWorkspaceSlots/);
  assert.match(viewerSource, /swapWorkspacePanes/);
  assert.match(viewerSource, /data-workspace-pane/);
  for (const pane of ['tangential','axial','orthogonal','3d','panoramic']) {
    assert.match(viewerSource, new RegExp(`data-workspace-pane=.*${pane}|${pane}.*data-workspace-pane`));
  }
});

test('viewer2 uses a hidden-by-default revealable tools drawer', () => {
  assert.match(viewerSource, /toolDrawerOpen/);
  assert.match(viewerSource, /viewer2-tools-tab/);
  assert.match(viewerSource, /viewer2-tools-drawer/);
  assert.match(cssSource, /\.viewer2-tools-drawer/);
  assert.match(cssSource, /\.viewer2-tools-drawer\.is-open/);
});

test('workspace styling declares the approved dominant 3d and panoramic slots', () => {
  assert.match(cssSource, /\.viewer2-workstation-grid/);
  assert.match(cssSource, /workspace-slot-bottomLeft/);
  assert.match(cssSource, /workspace-slot-bottomRight/);
  assert.match(cssSource, /viewer2-workspace-pane-3d/);
});
