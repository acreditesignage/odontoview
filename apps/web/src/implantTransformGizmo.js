const AXES = new Set(['x','y','z']);

export function normalizeImplantAngle(value) {
  if (!Number.isFinite(value)) return 0;
  let normalized = ((value + 180) % 360 + 360) % 360 - 180;
  if (normalized === -180 && value > 0) normalized = 180;
  return normalized;
}

export function applyImplantGizmoDelta(implant, action = {}) {
  const next = { ...implant };
  const { mode, axis, delta } = action;
  if (!implant || !AXES.has(axis) || !Number.isFinite(delta) || !['translate','rotate'].includes(mode)) return next;
  if (mode === 'translate') {
    const current = Number(implant[axis]);
    if (!Number.isFinite(current)) return next;
    next[axis] = current + delta;
    return next;
  }
  const key = `r${axis}`;
  const current = Number(implant[key] ?? 0);
  if (!Number.isFinite(current)) return next;
  next[key] = normalizeImplantAngle(current + delta);
  return next;
}
