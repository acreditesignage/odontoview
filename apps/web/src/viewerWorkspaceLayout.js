export const DEFAULT_VIEWER_WORKSPACE_SLOTS = Object.freeze({
  topLeft: 'tangential',
  topCenter: 'axial',
  topRight: 'orthogonal',
  bottomLeft: '3d',
  bottomRight: 'panoramic'
});

const PANE_IDS = Object.freeze(Object.values(DEFAULT_VIEWER_WORKSPACE_SLOTS));

export function isWorkspacePaneId(value) {
  return PANE_IDS.includes(value);
}

export function resetWorkspaceSlots() {
  return { ...DEFAULT_VIEWER_WORKSPACE_SLOTS };
}

export function swapWorkspacePanes(slots, paneA, paneB) {
  const next = { ...slots };
  if (!isWorkspacePaneId(paneA) || !isWorkspacePaneId(paneB) || paneA === paneB) return next;
  const slotA = Object.keys(next).find(key => next[key] === paneA);
  const slotB = Object.keys(next).find(key => next[key] === paneB);
  if (!slotA || !slotB) return next;
  next[slotA] = paneB;
  next[slotB] = paneA;
  return next;
}
