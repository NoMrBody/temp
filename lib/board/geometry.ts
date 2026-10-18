import type { Box, Pt, Stroke } from "./types";

export function strokeBox(s: Stroke): Box {
  if (s.final && s.bb) return s.bb;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of s.pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const b = { x0, y0, x1, y1 };
  if (s.final) s.bb = b;
  return b;
}

export const boxesOverlap = (a: Box, b: Box) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
export const rectsOverlap = boxesOverlap;
export const growBox = (b: Box, l: number, t: number, r: number, bt: number): Box => ({
  x0: b.x0 - l,
  y0: b.y0 - t,
  x1: b.x1 + r,
  y1: b.y1 + bt,
});
export const centerOf = (b: Box): Pt => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
export const inBox = (p: Pt, b: Box) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function eraserTouches(eraser: Stroke, pen: Stroke): boolean {
  const rad = eraser.width / 2 + 2;
  if (!boxesOverlap(growBox(strokeBox(eraser), rad, rad, rad, rad), strokeBox(pen))) return false;
  const e = eraser.pts;
  for (const p of pen.pts) {
    for (let i = 0; i < e.length; i++) {
      if (distToSeg(p, e[i], e[i + 1] || e[i]) <= rad) return true;
    }
  }
  return false;
}

/** Draws one stroke through transform `tf` at width scale `scale`. Erasers use destination-out. */
export function drawFullStroke(
  g: CanvasRenderingContext2D,
  s: Stroke,
  tf: (p: Pt) => Pt,
  scale: number,
  color: string,
): void {
  const pts = s.pts.map(tf);
  if (!pts.length) return;
  const eraser = s.tool === "eraser";
  const w = Math.max(eraser ? 4 : 1.6, s.width * scale);
  g.save();
  g.globalCompositeOperation = eraser ? "destination-out" : "source-over";
  g.strokeStyle = eraser ? "#000" : color;
  g.fillStyle = eraser ? "#000" : color;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = w;
  if (pts.length === 1) {
    g.beginPath();
    g.arc(pts[0].x, pts[0].y, w / 2, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2,
        my = (pts[i].y + pts[i + 1].y) / 2;
      g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    g.lineTo(last.x, last.y);
    g.stroke();
  }
  g.restore();
}

export function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
