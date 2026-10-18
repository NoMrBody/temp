import { drawFullStroke, strokeBox } from "./geometry";
import { inkMetrics } from "./ink";
import { buildPdf, type PdfPage } from "./pdf";
import { drawNotes, noteBox, NOTE_PDF_COLOR, prepareNotes } from "./notes";
import type { Box, Ctx, Note, OpenIssue, PagesApi, Stroke, Worksheet } from "./types";
import type { View } from "./viewmath";

const MAX_PAGES = 50;

interface PageData {
  strokes: Stroke[];
  notes: Note[];
  lastCleared: Stroke[] | null;
  checkedIds: Set<number>;
  lineMemory: Map<string, string>;
  announced: Set<string>;
  vetoed: Set<string>;
  openIssues: Map<string, OpenIssue>;
  lastIssue: string;
  issueIds: Set<number> | null;
  acked: boolean;
  upToDate: boolean;
  worksheet: Worksheet | null;
  view: View;
}

const blank = (): PageData => ({
  strokes: [],
  notes: [],
  lastCleared: null,
  checkedIds: new Set(),
  lineMemory: new Map(),
  announced: new Set(),
  vetoed: new Set(),
  openIssues: new Map(),
  lastIssue: "",
  issueIds: null,
  acked: false,
  upToDate: true,
  worksheet: null,
  view: { scale: 1, tx: 0, ty: 0 },
});

export function createPages(ctx: Ctx): PagesApi {
  const { state, tutor, timers } = ctx;
  const sig = { signal: ctx.signal };
  const pages: PageData[] = [blank()];
  let cur = 0;

  function save() {
    pages[cur] = {
      strokes: state.strokes,
      notes: state.notes,
      lastCleared: state.lastCleared,
      checkedIds: state.checkedIds,
      lineMemory: state.lineMemory,
      announced: tutor.announced,
      vetoed: tutor.vetoed,
      openIssues: tutor.openIssues,
      lastIssue: tutor.lastIssue,
      issueIds: tutor.issueIds,
      acked: tutor.acked,
      upToDate: tutor.lastCheckedVersion === state.version,
      worksheet: ctx.worksheet,
      view: { ...ctx.view },
    };
  }

  function load(p: PageData) {
    state.strokes = p.strokes;
    state.notes = p.notes;
    state.lastCleared = p.lastCleared;
    state.checkedIds = p.checkedIds;
    state.lineMemory = p.lineMemory;
    tutor.announced = p.announced;
    tutor.vetoed = p.vetoed;
    tutor.openIssues = p.openIssues;
    tutor.lastIssue = p.lastIssue;
    tutor.issueIds = p.issueIds;
    tutor.acked = p.acked;
    tutor.issueDismissed = false;
    ctx.worksheet = p.worksheet;
    Object.assign(ctx.view, p.view);
  }

  function refreshUi() {
    ctx.$("pageLabel").textContent = `Page ${cur + 1} / ${pages.length}`;
    (ctx.$("pagePrev") as HTMLButtonElement).disabled = cur === 0;
    (ctx.$("pageNext") as HTMLButtonElement).disabled = cur === pages.length - 1;
    (ctx.$("pageAdd") as HTMLButtonElement).disabled = pages.length >= MAX_PAGES;
    ctx.$("pageLabel").dataset.page = String(cur + 1);
  }

  function goTo(i: number, insertBlank = false) {
    if (state.activePointer !== null) return;
    if (!insertBlank && (i < 0 || i >= pages.length || i === cur)) return;
    // whatever was running belongs to the page we are leaving
    ctx.tutorApi.cancelInflight();
    clearTimeout(timers.check);
    clearTimeout(timers.retry);
    clearTimeout(timers.nudge);
    tutor.captionSeq++;
    ctx.voice.stop();
    ctx.voice.hideCard();
    ctx.glow.stop();
    ctx.marks.removeMarks(() => true);
    save();
    if (insertBlank) {
      pages.push(blank());
      i = pages.length - 1;
    }
    cur = i;
    load(pages[cur]);
    // invalidate anything captured on the previous page
    state.version++;
    state.destructiveVersion = state.version;
    tutor.lastCheckedVersion = pages[cur].upToDate ? state.version : state.version - 1;
    tutor.retries = 0;
    ctx.viewApi.refreshNow();
    ctx.canvas.updateHint();
    ctx.chat.refresh();
    ctx.tutorApi.setStatus("idle");
    refreshUi();
    const m = inkMetrics(state);
    if (tutor.mode === "auto" && m.hasUnchecked) timers.check = setTimeout(() => void ctx.tutorApi.runCheck(), 2000);
  }

  const boxOfStroke = (s: Stroke): Box => strokeBox(s);

  /**
   * Renders a world-space region to a JPEG: the given sheets underneath, then only the given ink and notes.
   * (Everything is drawn in full: callers choose a region that contains all of it.)
   */
  async function renderRegion(
    region: Box,
    p: PageData,
    sheets: Worksheet["sheets"],
    strokes: Stroke[],
    notes: Note[],
  ): Promise<PdfPage | null> {
    const w = region.x1 - region.x0,
      h = region.y1 - region.y0;
    if (w < 4 || h < 4) return null;
    const scale = Math.min(p.worksheet ? 1.5 : 2, 4000 / Math.max(w, h));
    const out = document.createElement("canvas");
    out.width = Math.round(w * scale);
    out.height = Math.round(h * scale);
    const oc = out.getContext("2d") as CanvasRenderingContext2D;
    oc.fillStyle = "#ffffff";
    oc.fillRect(0, 0, out.width, out.height);
    const tf = (q: { x: number; y: number }) => ({ x: (q.x - region.x0) * scale, y: (q.y - region.y0) * scale });
    for (const sh of sheets) {
      const bmp = p.worksheet ? await ctx.sheets.renderBitmap(sh, p.worksheet) : null;
      const a = tf({ x: sh.x, y: sh.y });
      if (bmp) oc.drawImage(bmp, a.x, a.y, sh.w * scale, sh.h * scale);
      else {
        oc.strokeStyle = "#cccccc";
        oc.strokeRect(a.x, a.y, sh.w * scale, sh.h * scale);
      }
    }
    await prepareNotes(notes, NOTE_PDF_COLOR);
    const ink = document.createElement("canvas");
    ink.width = out.width;
    ink.height = out.height;
    const ic = ink.getContext("2d") as CanvasRenderingContext2D;
    for (const s of strokes) drawFullStroke(ic, s, tf, scale, "#111111");
    drawNotes(ic, notes, tf, scale, NOTE_PDF_COLOR);
    oc.drawImage(ink, 0, 0);
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return null;
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: out.width, height: out.height, pageWidth: w, pageHeight: h };
  }

  /**
   * PDF pages for one canvas page. Plain canvas: one page. With a worksheet: one page per sheet; every piece of
   * writing and every tutor note belongs to the sheet it is closest to, and that page is made large enough to
   * hold it completely (nothing is cropped, nothing is drawn twice).
   */
  async function pagesOf(p: PageData): Promise<PdfPage[]> {
    await prepareNotes(p.notes, NOTE_PDF_COLOR); // real sizes before any layout decision
    const pens = p.strokes.filter((s) => s.tool === "pen");
    const out: PdfPage[] = [];
    const grow = (r: Box, b: Box, m = 24) => {
      r.x0 = Math.min(r.x0, b.x0 - m);
      r.y0 = Math.min(r.y0, b.y0 - m);
      r.x1 = Math.max(r.x1, b.x1 + m);
      r.y1 = Math.max(r.y1, b.y1 + m);
    };
    if (!p.worksheet) {
      if (!pens.length && !p.notes.length) return out;
      const r: Box = { x0: 0, y0: 0, x1: ctx.viewW(), y1: ctx.viewH() };
      for (const s of pens) grow(r, boxOfStroke(s), 20);
      for (const n of p.notes) grow(r, noteBox(n), 20);
      const pg = await renderRegion(r, p, [], p.strokes, p.notes);
      if (pg) out.push(pg);
      return out;
    }
    const sheets = p.worksheet.sheets;
    const nearest = (b: Box) => {
      const cy = (b.y0 + b.y1) / 2;
      let best = sheets[0],
        bestD = Infinity;
      for (const sh of sheets) {
        const d = cy < sh.y ? sh.y - cy : cy > sh.y + sh.h ? cy - (sh.y + sh.h) : 0;
        if (d < bestD) {
          bestD = d;
          best = sh;
        }
      }
      return best;
    };
    const mine = new Map(sheets.map((sh) => [sh, { strokes: [] as Stroke[], notes: [] as Note[], r: { x0: sh.x - 12, y0: sh.y - 12, x1: sh.x + sh.w + 12, y1: sh.y + sh.h + 12 } as Box }]));
    for (const s of p.strokes) {
      const own = mine.get(nearest(boxOfStroke(s)))!;
      own.strokes.push(s);
      if (s.tool === "pen") grow(own.r, boxOfStroke(s), 20);
    }
    for (const n of p.notes) {
      const own = mine.get(nearest(noteBox(n)))!;
      own.notes.push(n);
      grow(own.r, noteBox(n), 24);
    }
    for (const sh of sheets) {
      const own = mine.get(sh)!;
      const pg = await renderRegion(own.r, p, [sh], own.strokes, own.notes);
      if (pg) out.push(pg);
    }
    return out;
  }

  async function exportPdf() {
    save();
    const rendered: PdfPage[] = [];
    for (const p of pages) rendered.push(...(await pagesOf(p)));
    if (!rendered.length) {
      ctx.tutorApi.setStatus("idle", "Nothing to export yet — write something first");
      return;
    }
    const bytes = buildPdf(rendered);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "mathboard.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    ctx.tutorApi.setStatus("idle", `Exported ${rendered.length} page${rendered.length > 1 ? "s" : ""} to mathboard.pdf`);
  }

  ctx.$("pagePrev").addEventListener("click", () => goTo(cur - 1), sig);
  ctx.$("pageNext").addEventListener("click", () => goTo(cur + 1), sig);
  ctx.$("pageAdd").addEventListener("click", () => pages.length < MAX_PAGES && goTo(0, true), sig);
  ctx.$("exportPdf").addEventListener("click", () => void exportPdf(), sig);
  refreshUi();

  return { goTo, addPage: () => goTo(0, true), exportPdf, count: () => pages.length, index: () => cur };
}
