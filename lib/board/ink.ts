import { drawFullStroke, strokeBox } from "./geometry";
import type { BoardState, Box, Segment, Stroke } from "./types";

export interface InkEnv {
  state: BoardState;
  viewW(): number;
  viewH(): number;
}

/* Pen strokes that still have visible ink (a completely erased stroke is not writing any more). */
export function visiblePenStrokes(env: InkEnv): Stroke[] {
  const { state } = env;
  const pens = state.strokes.filter((s) => s.tool === "pen");
  if (!pens.length) return pens;
  // world space is unbounded (pan/zoom, PDF sheets): replay into a canvas that covers all ink
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of state.strokes) {
    const bb = strokeBox(s);
    minX = Math.min(minX, bb.x0);
    minY = Math.min(minY, bb.y0);
    maxX = Math.max(maxX, bb.x1);
    maxY = Math.max(maxY, bb.y1);
  }
  const pad = 20;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const K = Math.min(0.5, 3000 / Math.max(maxX - minX, maxY - minY, 1)); // half resolution is plenty to tell "something is there" from "erased"
  const w = Math.max(1, Math.ceil((maxX - minX) * K)),
    h = Math.max(1, Math.ceil((maxY - minY) * K));
  try {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    const tf = (p: { x: number; y: number }) => ({ x: (p.x - minX) * K, y: (p.y - minY) * K });
    for (const s of state.strokes) drawFullStroke(g, s, tf, K, "#000");
    const data = g.getImageData(0, 0, w, h).data;
    const alphaAt = (p: { x: number; y: number }) => {
      const x = Math.round((p.x - minX) * K),
        y = Math.round((p.y - minY) * K);
      return x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3];
    };
    return pens.filter((s) => s.pts.some((p) => alphaAt(p) > 24));
  } catch {
    return pens;
  }
}

export interface Analysis {
  visible: Stroke[];
  segments: Segment[];
  refH: number;
}

/* Groups visible writing into rows, then splits rows at big horizontal gaps. Tags L1.. top-to-bottom, left-to-right. */
export function analyzeInk(env: InkEnv): Analysis {
  const { state } = env;
  const visible = visiblePenStrokes(env);
  if (!visible.length) return { visible, segments: [], refH: 30 };

  const items = visible.map((s) => ({ s, ...strokeBox(s) }));
  const heights = items.map((i) => i.y1 - i.y0).sort((a, b) => a - b);
  const refH = Math.min(80, Math.max(18, heights[Math.min(heights.length - 1, Math.floor(0.7 * heights.length))]));
  const gapTol = 0.4 * refH;
  const splitGap = 1.6 * refH;

  items.sort((a, b) => a.y0 - b.y0);
  const rows: { y0: number; y1: number; items: typeof items }[] = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row) {
      const overlap = Math.min(row.y1, it.y1) - it.y0;
      const minH = Math.max(1, Math.min(row.y1 - row.y0, it.y1 - it.y0));
      if (overlap >= 0.3 * minH || -overlap <= gapTol) {
        row.items.push(it);
        row.y0 = Math.min(row.y0, it.y0);
        row.y1 = Math.max(row.y1, it.y1);
        continue;
      }
    }
    rows.push({ y0: it.y0, y1: it.y1, items: [it] });
  }

  interface Cur {
    items: typeof items;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  }
  const groups: Cur[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x0 - b.x0);
    let cur: Cur | null = null;
    for (const it of row.items) {
      if (cur && it.x0 - cur.x1 <= splitGap) {
        cur.items.push(it);
        cur.x1 = Math.max(cur.x1, it.x1);
        cur.y0 = Math.min(cur.y0, it.y0);
        cur.y1 = Math.max(cur.y1, it.y1);
      } else {
        cur = { items: [it], x0: it.x0, x1: it.x1, y0: it.y0, y1: it.y1 };
        groups.push(cur);
      }
    }
  }
  const segments: Segment[] = groups.map((sg, i) => {
    const strokes = sg.items.map((it) => it.s);
    const box: Box = { x0: sg.x0, y0: sg.y0, x1: sg.x1, y1: sg.y1 };
    return {
      tag: i + 1,
      strokes,
      box,
      key: strokes
        .map((s) => s.id)
        .sort((a, b) => a - b)
        .join(","),
      hasNew: strokes.some((s) => !state.checkedIds.has(s.id)),
      refH,
    };
  });
  return { visible, segments, refH };
}

/* Typical handwriting height (median pen-stroke height). */
export function inkMetrics(state: BoardState) {
  const heights: number[] = [];
  let bottom = -Infinity,
    hasUnchecked = false;
  for (const s of state.strokes) {
    if (s.tool !== "pen") continue;
    let lo = Infinity,
      hi = -Infinity;
    for (const p of s.pts) {
      if (p.y < lo) lo = p.y;
      if (p.y > hi) hi = p.y;
    }
    heights.push(hi - lo);
    if (hi > bottom) bottom = hi;
    if (!state.checkedIds.has(s.id)) hasUnchecked = true;
  }
  heights.sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 30;
  return { bottom, lineH: Math.min(90, Math.max(14, median)), hasUnchecked };
}
