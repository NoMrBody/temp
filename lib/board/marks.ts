import { boxesOverlap, centerOf, eraserTouches, growBox, inBox, rectsOverlap, strokeBox } from "./geometry";
import type { Box, Ctx, Mark, MarksApi, Pt, Segment, Stroke } from "./types";

const TICK = 22;

export function createMarks(ctx: Ctx): MarksApi {
  const { state } = ctx;
  const marks: Mark[] = [];

  function inkHitsRect(r: Box): boolean {
    const test = (s: Stroke) => {
      const b = strokeBox(s);
      if (b.x1 < r.x0 || b.x0 > r.x1 || b.y1 < r.y0 || b.y0 > r.y1) return false;
      const p = s.pts;
      for (let i = 0; i < p.length; i++) {
        if (p[i].x >= r.x0 && p[i].x <= r.x1 && p[i].y >= r.y0 && p[i].y <= r.y1) return true;
        if (i) {
          const dx = p[i].x - p[i - 1].x,
            dy = p[i].y - p[i - 1].y;
          const n = Math.floor(Math.hypot(dx, dy) / 6);
          for (let k = 1; k <= n; k++) {
            const x = p[i - 1].x + (dx * k) / (n + 1),
              y = p[i - 1].y + (dy * k) / (n + 1);
            if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
          }
        }
      }
      return false;
    };
    for (const s of state.strokes) if (s.tool === "pen" && test(s)) return true;
    return !!(state.current && state.current.tool === "pen" && test(state.current));
  }

  function uiRects(): Box[] {
    const out: Box[] = [];
    for (const q of [".toolbar", ".pages", ".status", ".hintbox.open", ".chat.open", ".card.show", ".graph.open", ".trace.open"]) {
      const el = ctx.root.querySelector(q);
      if (el) {
        const r = el.getBoundingClientRect();
        out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
      }
    }
    return out;
  }

  const markRect = (m: Mark): Box => {
    const c = ctx.toScreen(m.anchor);
    const r = TICK / 2 + 4;
    return { x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r };
  };
  const worldBoxOf = (r: Box): Box => {
    const a = ctx.toWorld({ x: r.x0, y: r.y0 }),
      b = ctx.toWorld({ x: r.x1, y: r.y1 });
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  };

  function placeBadge(seg: Segment, preferRight: boolean) {
    const G = 10;
    const a = ctx.toScreen({ x: seg.box.x0, y: seg.box.y0 }),
      b = ctx.toScreen({ x: seg.box.x1, y: seg.box.y1 });
    const y = (a.y + b.y) / 2 - TICK / 2;
    const left = { x: a.x - TICK - G, y },
      right = { x: b.x + G, y };
    const candidates = preferRight ? [right, left, { x: 10, y }] : [left, right, { x: 10, y }];
    const ui = uiRects();
    for (const c of candidates) {
      if (c.x < 4 || c.x + TICK > ctx.viewW() - 4 || c.y < 4 || c.y + TICK > ctx.viewH() - 4) continue;
      const r = { x0: c.x - 4, y0: c.y - 4, x1: c.x + TICK + 4, y1: c.y + TICK + 4 };
      if (ui.some((u) => rectsOverlap(u, r))) continue;
      if (marks.some((m) => rectsOverlap(markRect(m), r))) continue;
      if (inkHitsRect(worldBoxOf(r))) continue;
      const anchor: Pt = ctx.toWorld({ x: c.x + TICK / 2, y: c.y + TICK / 2 });
      return { x: c.x, y: c.y, anchor };
    }
    return null;
  }

  function reposition() {
    for (const m of marks) {
      const c = ctx.toScreen(m.anchor);
      m.el.style.left = c.x - TICK / 2 + "px";
      m.el.style.top = c.y - TICK / 2 + "px";
      const off = c.x < -TICK || c.y < -TICK || c.x > ctx.viewW() + TICK || c.y > ctx.viewH() + TICK;
      m.el.style.display = off ? "none" : "";
    }
  }

  function removeMarks(pred: (m: Mark) => boolean) {
    for (let i = marks.length - 1; i >= 0; i--) {
      if (!pred(marks[i])) continue;
      const m = marks.splice(i, 1)[0];
      m.el.classList.add("out");
      setTimeout(() => m.el.remove(), 280);
    }
  }

  function addTick(seg: Segment) {
    removeMarks((m) => m.kind === "tick" && boxesOverlap(m.box, seg.box));
    const pos = placeBadge(seg, false);
    if (!pos) return;
    const el = document.createElement("div");
    el.className = "tick";
    el.dataset.kind = "tick";
    el.dataset.tag = String(seg.tag);
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    ctx.$("marks").appendChild(el);
    marks.push({ kind: "tick", el, box: { ...seg.box }, anchor: pos.anchor, refH: seg.refH, strokes: seg.strokes });
  }

  function addPlotButton(seg: Segment, expr: string, label: string) {
    removeMarks((m) => m.kind === "plot" && boxesOverlap(m.box, seg.box));
    const pos = placeBadge(seg, true);
    if (!pos) return;
    const el = document.createElement("button");
    el.className = "tick gbtn";
    el.dataset.kind = "plot";
    el.title = "Plot this function";
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v16h16"/><path d="M7 16c3-9 6-9 9-1l2 3"/></svg>';
    el.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        ctx.graph.addSeries(expr, label);
      },
      { signal: ctx.signal },
    );
    ctx.$("marks").appendChild(el);
    marks.push({ kind: "plot", el, box: { ...seg.box }, anchor: pos.anchor, refH: seg.refH, strokes: seg.strokes });
  }

  return {
    marks,
    addTick,
    addPlotButton,
    removeMarks,
    reposition,
    onInkErased(eraser) {
      const hit = state.strokes.filter((p) => p.tool === "pen" && eraserTouches(eraser, p));
      const ids = new Set(hit.map((p) => p.id));
      for (const id of ids) state.checkedIds.delete(id);
      removeMarks((m) => m.strokes.some((p) => ids.has(p.id)));
      ctx.glow.stop();
    },
    onInkAdded(pen) {
      const c = centerOf(strokeBox(pen));
      removeMarks((m) => inBox(c, growBox(m.box, 0.5 * m.refH, 0.25 * m.refH, 2 * m.refH, 0.25 * m.refH)));
    },
    touchedSince(seg, captured) {
      const b = growBox(seg.box, 0.5 * seg.refH, 0.25 * seg.refH, 2 * seg.refH, 0.25 * seg.refH);
      const all = state.current ? state.strokes.concat([state.current]) : state.strokes;
      return all.some((s) => s.tool === "pen" && !captured.has(s.id) && inBox(centerOf(strokeBox(s)), b));
    },
  };
}
