export interface View {
  scale: number;
  tx: number;
  ty: number;
}
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
export const toScreenPt = (v: View, p: { x: number; y: number }) => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });
export const toWorldPt = (v: View, p: { x: number; y: number }) => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale });

/** New view after zooming by `factor` so that the world point under screen (cx, cy) stays put. */
export function zoomAround(v: View, factor: number, cx: number, cy: number): View {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
}

/** Smallest pan that brings the world box fully on screen (as far as it fits), with a margin. */
export function panToReveal(
  v: View,
  box: { x0: number; y0: number; x1: number; y1: number },
  viewW: number,
  viewH: number,
  margin = 24,
  topInset = 70,
  bottomInset = 90,
): View {
  const sx0 = box.x0 * v.scale + v.tx,
    sx1 = box.x1 * v.scale + v.tx,
    sy0 = box.y0 * v.scale + v.ty,
    sy1 = box.y1 * v.scale + v.ty;
  let { tx, ty } = v;
  if (sx1 > viewW - margin) tx -= sx1 - (viewW - margin);
  if (sx0 < margin) tx += margin - sx0;
  if (sy1 > viewH - bottomInset) ty -= sy1 - (viewH - bottomInset);
  if (sy0 < topInset) ty += topInset - sy0;
  return { ...v, tx, ty };
}
