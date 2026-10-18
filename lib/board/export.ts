import { CLIENT_CONFIG } from "../../shared/config";
import { drawFullStroke, rrect } from "./geometry";
import { analyzeInk, type Analysis, type InkEnv } from "./ink";
import type { Segment } from "./types";

export interface ExportOpts {
  onlyTags?: number[];
  allBlack?: boolean;
}
export interface ExportResult {
  image: string;
  segments: Segment[];
  hasNew: boolean;
}

export function exportImage(env: InkEnv, opts: ExportOpts = {}, analysis?: Analysis): ExportResult | null {
  const { state } = env;
  const an = analysis ?? analyzeInk(env);
  if (!an.segments.length) return null;
  const only = opts.onlyTags ? new Set(opts.onlyTags) : null;
  const shown = only ? an.segments.filter((sg) => only.has(sg.tag)) : an.segments;
  if (!shown.length) return null;
  const shownIds = new Set(shown.flatMap((sg) => sg.strokes.map((st) => st.id)));

  let inkLen = 0;
  for (const s of an.visible) {
    if (only && !shownIds.has(s.id)) continue;
    for (let i = 1; i < s.pts.length; i++) inkLen += Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y);
  }
  if (inkLen < CLIENT_CONFIG.MIN_INK_LENGTH) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const sg of shown) {
    minX = Math.min(minX, sg.box.x0);
    minY = Math.min(minY, sg.box.y0);
    maxX = Math.max(maxX, sg.box.x1);
    maxY = Math.max(maxY, sg.box.y1);
  }
  const pad = 28;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  // A tall canvas (a worksheet with writing spread over several pages) would be shrunk until it is unreadable.
  // Then the empty vertical bands between lines are squeezed, which does not change what any line looks like.
  const naive = Math.min(CLIENT_CONFIG.EXPORT_MAX_SIDE / Math.max(maxX - minX, maxY - minY), 1.5);
  const squeeze = naive < 0.8;
  const gaps: { from: number; to: number; cut: number }[] = [];
  if (squeeze) {
    const spans = shown.map((sg) => [sg.box.y0 - pad, sg.box.y1 + pad] as const).sort((a, b) => a[0] - b[0]);
    let end = spans[0][1];
    for (const [y0, y1] of spans.slice(1)) {
      if (y0 - end > 100) gaps.push({ from: end, to: y0, cut: y0 - end - 60 });
      end = Math.max(end, y1);
    }
  }
  const my = (y: number) => {
    let cut = 0;
    for (const g of gaps) {
      if (y >= g.to) cut += g.cut;
      else if (y > g.from) cut += (g.cut * (y - g.from)) / (g.to - g.from);
    }
    return y - cut;
  };
  const w = maxX - minX,
    h = my(maxY) - my(minY);
  const scale = Math.min(CLIENT_CONFIG.EXPORT_MAX_SIDE / Math.max(w, h), 1.5);
  const GUTTER = 56;
  const W = Math.max(64, Math.round(w * scale)) + GUTTER,
    H = Math.max(64, Math.round(h * scale));

  const ink = document.createElement("canvas");
  ink.width = W;
  ink.height = H;
  const ic = ink.getContext("2d") as CanvasRenderingContext2D;
  const tf = (p: { x: number; y: number }) => ({ x: GUTTER + (p.x - minX) * scale, y: (my(p.y) - my(minY)) * scale });
  for (const s of state.strokes) {
    if (only && s.tool === "pen" && !shownIds.has(s.id)) continue;
    const color =
      opts.allBlack || !state.checkedIds.has(s.id) ? CLIENT_CONFIG.NEW_INK_COLOR : CLIENT_CONFIG.OLD_INK_COLOR;
    drawFullStroke(ic, s, tf, scale, color);
  }

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const oc = out.getContext("2d") as CanvasRenderingContext2D;
  oc.fillStyle = "#ffffff";
  oc.fillRect(0, 0, W, H);
  oc.drawImage(ink, 0, 0);

  oc.font = "bold 15px Arial, Helvetica, sans-serif";
  oc.textAlign = "center";
  oc.textBaseline = "middle";
  for (const sg of shown) {
    const label = "L" + sg.tag;
    const tw = Math.ceil(oc.measureText(label).width) + 14,
      th = 22;
    const left = GUTTER + (sg.box.x0 - minX) * scale;
    const mid = (my((sg.box.y0 + sg.box.y1) / 2) - my(minY)) * scale;
    const tx = Math.max(2, left - tw - 6);
    const ty = Math.min(H - th - 2, Math.max(2, mid - th / 2));
    oc.fillStyle = "#2563eb";
    rrect(oc, tx, ty, tw, th, 6);
    oc.fill();
    oc.fillStyle = "#ffffff";
    oc.fillText(label, tx + tw / 2, ty + th / 2 + 0.5);
  }
  return {
    image: out.toDataURL("image/png").split(",")[1],
    segments: an.segments,
    hasNew: an.segments.some((sg) => sg.hasNew),
  };
}
