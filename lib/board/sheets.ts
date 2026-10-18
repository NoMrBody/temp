import { noteBox } from "./notes";
import { toScreenPt } from "./viewmath";
import type { Box, Ctx, Pt, Sheet, SheetsApi, Worksheet } from "./types";

export const SHEET_W = 820;
const GAP = 28;
const BITMAP_W = 1400;
const MAX_PAGES = 30;
const KEEP_BITMAPS = 8;

type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { width: number; height: number };
    render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: HTMLCanvasElement }): { promise: Promise<void> };
  }>;
  loadingTask?: { destroy(): Promise<void> };
};

function destroyDoc(doc: unknown): void {
  try {
    void (doc as PdfDoc).loadingTask?.destroy().catch(() => undefined);
  } catch {
    /* already gone */
  }
}

export function createSheets(ctx: Ctx): SheetsApi {
  let pdfjs: typeof import("pdfjs-dist") | null = null;

  async function lib() {
    if (!pdfjs) {
      pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    }
    return pdfjs;
  }

  const ws = () => ctx.worksheet;

  async function renderBitmap(sheet: Sheet, from?: Worksheet): Promise<HTMLCanvasElement | null> {
    const w = from ?? ws();
    if (!w) return null;
    if (sheet.bitmap) return sheet.bitmap;
    if (!sheet.rendering) {
      const doc = w.doc as PdfDoc;
      sheet.rendering = (async () => {
        try {
          const page = await doc.getPage(sheet.index + 1);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: BITMAP_W / base.width });
          const c = document.createElement("canvas");
          c.width = Math.round(viewport.width);
          c.height = Math.round(viewport.height);
          const g = c.getContext("2d") as CanvasRenderingContext2D;
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: g, viewport, canvas: c }).promise;
          sheet.bitmap = c;
        } catch {
          /* leave the sheet white */
        } finally {
          sheet.rendering = null;
          draw();
        }
      })();
    }
    await sheet.rendering;
    return sheet.bitmap;
  }

  function visible(sheet: Sheet): boolean {
    const a = toScreenPt(ctx.view, { x: sheet.x, y: sheet.y });
    const b = toScreenPt(ctx.view, { x: sheet.x + sheet.w, y: sheet.y + sheet.h });
    return b.x > 0 && a.x < ctx.viewW() && b.y > 0 && a.y < ctx.viewH();
  }

  function draw() {
    const g = ctx.sctx;
    const c = ctx.sheetsCanvas;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const w = ws();
    c.dataset.sheets = String(w ? w.sheets.length : 0);
    if (!w) return;
    g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
    let rendered = 0;
    for (const sh of w.sheets) {
      if (!visible(sh)) continue;
      const a = toScreenPt(ctx.view, { x: sh.x, y: sh.y });
      const sw = sh.w * ctx.view.scale;
      const shh = sh.h * ctx.view.scale;
      g.save();
      g.shadowColor = ctx.theme() === "light" ? "rgba(30,50,100,.3)" : "rgba(0,0,0,.55)";
      g.shadowBlur = 22;
      g.shadowOffsetY = 6;
      g.fillStyle = "#ffffff";
      g.fillRect(a.x, a.y, sw, shh);
      g.restore();
      if (sh.bitmap) {
        g.drawImage(sh.bitmap, a.x, a.y, sw, shh);
        rendered++;
      } else void renderBitmap(sh);
    }
    // keep memory bounded: drop bitmaps that are off screen once too many are cached
    const have = w.sheets.filter((s) => s.bitmap);
    if (have.length > KEEP_BITMAPS) {
      for (const s of have.filter((x) => !visible(x)).slice(0, have.length - KEEP_BITMAPS)) s.bitmap = null;
    }
    c.dataset.rendered = String(rendered);
  }

  function clear() {
    const w = ws();
    if (w) destroyDoc(w.doc);
    ctx.worksheet = null;
    draw();
    ctx.canvas.updateHint();
    ctx.chat.refresh();
  }

  async function load(bytes: Uint8Array, name: string, data: string): Promise<number> {
    const { getDocument } = await lib();
    const doc = (await getDocument({ data: bytes.slice() }).promise) as unknown as PdfDoc;
    if (doc.numPages > MAX_PAGES) {
      destroyDoc(doc);
      throw new Error(`That PDF has ${doc.numPages} pages; the limit is ${MAX_PAGES}.`);
    }
    // below whatever is already on this page
    let top = 0;
    for (const s of ctx.state.strokes) for (const p of s.pts) top = Math.max(top, p.y + 160);
    for (const n of ctx.state.notes) top = Math.max(top, noteBox(n).y1 + 160);
    const sheets: Sheet[] = [];
    let y = top;
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const h = Math.round((vp.height * SHEET_W) / vp.width);
      sheets.push({ index: i, x: 0, y, w: SHEET_W, h, bitmap: null, rendering: null });
      y += h + GAP;
    }
    const old = ws();
    if (old) destroyDoc(old.doc);
    const worksheet: Worksheet = { name, data, doc, sheets };
    ctx.worksheet = worksheet;
    ctx.viewApi.fit();
    draw();
    ctx.canvas.updateHint();
    ctx.chat.refresh();
    return doc.numPages;
  }

  const contains = (p: Pt) => !!ws()?.sheets.some((s) => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h);

  function focusIndex(): number {
    const w = ws();
    if (!w || !w.sheets.length) return -1;
    const mid = { x: (ctx.viewW() / 2 - ctx.view.tx) / ctx.view.scale, y: (ctx.viewH() / 2 - ctx.view.ty) / ctx.view.scale };
    let best = 0,
      bestD = Infinity;
    for (const s of w.sheets) {
      const d = mid.y < s.y ? s.y - mid.y : mid.y > s.y + s.h ? mid.y - (s.y + s.h) : 0;
      if (d < bestD) {
        bestD = d;
        best = s.index;
      }
    }
    return best;
  }

  function bounds(): Box | null {
    const w = ws();
    if (!w || !w.sheets.length) return null;
    const last = w.sheets[w.sheets.length - 1];
    return { x0: 0, y0: w.sheets[0].y, x1: SHEET_W, y1: last.y + last.h };
  }

  return { load, clear, draw, contains, focusIndex, bounds, renderBitmap };
}
