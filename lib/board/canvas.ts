import { CLIENT_CONFIG } from "../../shared/config";
import { drawFullStroke } from "./geometry";
import { peekImage, peekSize } from "./latex";
import { drawNotes, noteColor } from "./notes";
import { store } from "./state";
import type { CanvasApi, Ctx, Pt, Stroke } from "./types";

const INK_ON_SHEET = "#1e2a44";

export function createCanvas(ctx: Ctx): CanvasApi {
  const { state, board } = ctx;
  const sig = { signal: ctx.signal };

  function resize() {
    const w = ctx.viewW(),
      h = ctx.viewH();
    ctx.dpr = Math.max(1, window.devicePixelRatio || 1);
    for (const c of [board, ctx.glowCanvas, ctx.notesCanvas, ctx.sheetsCanvas]) {
      // CSS size = the visible window (iOS Safari's 100vh is taller than what is visible)
      c.style.width = w + "px";
      c.style.height = h + "px";
      c.width = Math.round(w * ctx.dpr);
      c.height = Math.round(h * ctx.dpr);
    }
    ctx.glow.stop();
    api.redrawAll();
    ctx.sheets.draw();
    ctx.marks.reposition();
    ctx.notesUi.sync();
  }
  window.addEventListener("iterraai:theme", () => { ctx.glow.stop(); redrawAll(); ctx.sheets.draw(); }, sig);
  window.visualViewport?.addEventListener("resize", () => resize(), sig);
  window.addEventListener("orientationchange", () => setTimeout(resize, 150), sig);

  const screenTf = (p: Pt) => ctx.toScreen(p);
  const inkColor = (s: Stroke) => (s.sheet || ctx.theme() === "light" ? INK_ON_SHEET : CLIENT_CONFIG.INK_COLOR);

  function redrawNotes() {
    const g = ctx.nctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ctx.notesCanvas.width, ctx.notesCanvas.height);
    g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
    drawNotes(g, state.notes, screenTf, ctx.view.scale, noteColor(ctx.theme()), () => {
      redrawNotes();
      ctx.notesUi.sync();
    });
    ctx.notesCanvas.dataset.notes = String(state.notes.length);
    const all = state.notes.flatMap((n) => n.lines);
    ctx.notesCanvas.dataset.typeset = String(all.filter((l) => peekImage(l, noteColor(ctx.theme()))).length);
    ctx.notesCanvas.dataset.raw = String(all.filter((l) => peekSize(l) === null).length);
  }

  function redrawAll() {
    redrawNotes();
    const g = ctx.bctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, board.width, board.height);
    g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
    for (const s of state.strokes) drawFullStroke(g, s, screenTf, ctx.view.scale, inkColor(s));
    if (state.current) drawFullStroke(g, state.current, screenTf, ctx.view.scale, inkColor(state.current));
  }

  function styleFor(s: Stroke) {
    const g = ctx.bctx;
    const eraser = s.tool === "eraser";
    g.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    g.strokeStyle = g.fillStyle = eraser ? "#000" : inkColor(s);
    g.lineCap = g.lineJoin = "round";
    g.lineWidth = Math.max(eraser ? 4 : 1.6, s.width * ctx.view.scale);
  }

  function drawIncrement(s: Stroke) {
    const g = ctx.bctx;
    const n = s.pts.length;
    const p = s.pts.map(screenTf);
    g.save();
    g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
    styleFor(s);
    if (n === 1) {
      g.beginPath();
      g.arc(p[0].x, p[0].y, g.lineWidth / 2, 0, Math.PI * 2);
      g.fill();
    } else if (n >= 3) {
      const i = n - 2;
      const start = i === 1 ? p[0] : { x: (p[i - 1].x + p[i].x) / 2, y: (p[i - 1].y + p[i].y) / 2 };
      g.beginPath();
      g.moveTo(start.x, start.y);
      g.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
      g.stroke();
    }
    g.restore();
  }

  function drawStrokeEnd(s: Stroke) {
    const g = ctx.bctx;
    const n = s.pts.length;
    if (n < 2) return;
    const p = s.pts.map(screenTf);
    g.save();
    g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
    styleFor(s);
    const from = n === 2 ? p[0] : { x: (p[n - 2].x + p[n - 1].x) / 2, y: (p[n - 2].y + p[n - 1].y) / 2 };
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(p[n - 1].x, p[n - 1].y);
    g.stroke();
    g.restore();
  }

  function markChanged(destructive: boolean) {
    state.version++;
    if (destructive) state.destructiveVersion = state.version;
  }

  function updateHint() {
    ctx.$("hint").classList.toggle(
      "gone",
      state.strokes.length > 0 || state.notes.length > 0 || !!state.current || !!ctx.worksheet,
    );
    board.dataset.strokes = String(state.strokes.length);
  }

  function endStroke(e: PointerEvent) {
    if (e.pointerId !== state.activePointer) return;
    state.activePointer = null;
    const s = state.current;
    state.current = null;
    if (!s) return;
    drawStrokeEnd(s);
    s.final = true;
    state.strokes.push(s);
    state.lastCleared = null;
    if (s.tool === "eraser") ctx.marks.onInkErased(s);
    else ctx.marks.onInkAdded(s);
    markChanged(s.tool === "eraser");
    updateHint();
    ctx.tutorApi.onStrokeEnd();
  }

  // ---- panning / pinching -------------------------------------------------------------
  const touches = new Map<number, Pt>();
  let gesture: { dist: number; cx: number; cy: number } | null = null;
  let pan: { id: number; x: number; y: number } | null = null;
  let spaceDown = false;
  let penLastSeen = 0;

  const syncCursor = () => document.body.classList.toggle("hand", state.tool === "hand" || spaceDown);
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code === "Space" && !spaceDown && !/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? "")) {
        spaceDown = true;
        syncCursor();
        e.preventDefault();
      }
    },
    sig,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (e.code === "Space") {
        spaceDown = false;
        syncCursor();
      }
    },
    sig,
  );
  const gestureOf = () => {
    const [a, b] = [...touches.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  function abortStroke() {
    if (state.current) {
      state.current = null;
      state.activePointer = null;
      redrawAll();
    }
  }

  board.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "pen") {
        state.penSeen = true;
        store.set("iterraai.penSeen", "1");
      }
      // --- touch: palms are ignored, two fingers pinch/pan, one finger draws (or pans when a pen/hand tool is in use)
      if (e.pointerType === "touch") {
        if (Math.max(e.width, e.height) >= 36) return; // a palm
        if (Date.now() - penLastSeen < 1500) return; // a hand resting next to the pen
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) {
          abortStroke();
          pan = null;
          gesture = gestureOf();
          return;
        }
        if (state.penSeen || state.tool === "hand") {
          pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
          board.setPointerCapture?.(e.pointerId);
          e.preventDefault();
          return;
        }
      }
      if (state.activePointer !== null || gesture) return;
      // --- mouse: left draws; middle button, Space or the hand tool pans
      if (e.pointerType === "mouse" && (e.button === 1 || (e.button === 0 && (state.tool === "hand" || spaceDown)))) {
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
        board.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (state.tool === "hand" && e.pointerType === "pen") {
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }
      e.preventDefault();
      ctx.voice.unlock();
      try {
        board.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers may not be capturable */
      }
      const tool: "pen" | "eraser" = e.pointerType === "pen" && e.buttons & 32 ? "eraser" : state.tool === "eraser" ? "eraser" : "pen";
      const p = ctx.toWorld({ x: e.clientX, y: e.clientY });
      const s: Stroke = {
        id: ++state.strokeSeq,
        tool,
        width: tool === "eraser" ? CLIENT_CONFIG.ERASER_WIDTH : state.penWidth,
        pts: [p],
        ...(ctx.sheets.contains(p) ? { sheet: true as const } : {}),
      };
      state.current = s;
      state.activePointer = e.pointerId;
      ctx.tutorApi.onStrokeStart(tool, p.y);
      drawIncrement(s);
      updateHint();
    },
    sig,
  );

  board.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "pen") penLastSeen = Date.now();
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (gesture && touches.size >= 2) {
          const g2 = gestureOf();
          ctx.viewApi.zoomAt(g2.dist / gesture.dist, g2.cx, g2.cy);
          ctx.viewApi.panBy(g2.cx - gesture.cx, g2.cy - gesture.cy);
          gesture = g2;
          return;
        }
      }
      if (pan && pan.id === e.pointerId) {
        ctx.viewApi.panBy(e.clientX - pan.x, e.clientY - pan.y);
        pan = { id: pan.id, x: e.clientX, y: e.clientY };
        return;
      }
      if (e.pointerId !== state.activePointer || !state.current) return;
      const s = state.current;
      const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e]) {
        const p = ctx.toWorld({ x: ev.clientX, y: ev.clientY });
        const last = s.pts[s.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * ctx.view.scale < 0.8) continue;
        s.pts.push(p);
        drawIncrement(s);
      }
    },
    sig,
  );

  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) gesture = null;
    if (pan && pan.id === e.pointerId) pan = null;
    endStroke(e);
  };
  board.addEventListener("pointerup", up, sig);
  board.addEventListener("pointercancel", up, sig);
  board.addEventListener("contextmenu", (e) => e.preventDefault(), sig);

  function undo() {
    let removed: Stroke | null = null;
    if (state.strokes.length) removed = state.strokes.pop() ?? null;
    else if (state.lastCleared) {
      state.strokes = state.lastCleared;
      state.lastCleared = null;
    } else return;
    if (removed) {
      if (removed.tool === "eraser") ctx.marks.onInkErased(removed);
      else ctx.marks.onInkAdded(removed);
    }
    ctx.glow.stop();
    markChanged(true);
    redrawAll();
    updateHint();
    ctx.tutorApi.onStrokeEnd();
  }

  function clearCanvas() {
    if (!state.strokes.length && !state.notes.length) return;
    if (state.strokes.length) state.lastCleared = state.strokes;
    state.strokes = [];
    state.notes = [];
    markChanged(true);
    redrawAll();
    ctx.tutorApi.resetSession();
    updateHint();
  }

  const api: CanvasApi = { redrawAll, redrawNotes, undo, clearCanvas, markChanged, resize, updateHint, syncCursor };
  return api;
}
