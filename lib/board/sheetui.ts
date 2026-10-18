import { strokeBox } from "./geometry";
import type { Ctx, Pt, SheetUiApi, Stroke } from "./types";

/**
 * Handle above the worksheet: ✥ drags all its pages (the ink written on them travels along, so answers stay
 * next to their problems), × removes the worksheet (two clicks, the ink stays).
 */
export function createSheetUi(ctx: Ctx): SheetUiApi {
  const host = ctx.$("sheetctl");
  const sig = { signal: ctx.signal };
  const el = document.createElement("div");
  el.className = "sheet-ctl";
  const grip = document.createElement("button");
  grip.className = "grip";
  grip.textContent = "✥";
  grip.title = "Drag to move the worksheet (your writing on it moves too)";
  grip.setAttribute("aria-label", "Move the worksheet");
  const name = document.createElement("span");
  name.className = "name";
  const del = document.createElement("button");
  del.className = "del";
  del.textContent = "×";
  del.title = "Remove the worksheet";
  del.setAttribute("aria-label", "Remove the worksheet");
  el.append(grip, name, del);
  host.appendChild(el);
  let armed: ReturnType<typeof setTimeout> | undefined;
  ctx.signal.addEventListener("abort", () => clearTimeout(armed));

  function disarm() {
    clearTimeout(armed);
    del.textContent = "×";
    del.classList.remove("armed");
  }
  del.addEventListener(
    "click",
    () => {
      if (!del.classList.contains("armed")) {
        del.textContent = "Delete?";
        del.classList.add("armed");
        armed = setTimeout(disarm, 3000);
        return;
      }
      disarm();
      ctx.sheets.clear();
    },
    sig,
  );

  let drag: { px: number; py: number; last: Pt; moved: Stroke[] } | null = null;
  grip.addEventListener(
    "pointerdown",
    (e) => {
      const w = ctx.worksheet;
      if (!w) return;
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      // ink that sits on the sheets travels with them
      const moved = ctx.state.strokes.filter((s) => {
        const b = strokeBox(s);
        const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
        return w.sheets.some((sh) => c.x >= sh.x && c.x <= sh.x + sh.w && c.y >= sh.y && c.y <= sh.y + sh.h);
      });
      drag = { px: e.clientX, py: e.clientY, last: { x: e.clientX, y: e.clientY }, moved };
      el.classList.add("dragging");
      ctx.glow.stop();
    },
    sig,
  );
  grip.addEventListener(
    "pointermove",
    (e) => {
      const w = ctx.worksheet;
      if (!drag || !w) return;
      const dx = (e.clientX - drag.last.x) / ctx.view.scale,
        dy = (e.clientY - drag.last.y) / ctx.view.scale;
      drag.last = { x: e.clientX, y: e.clientY };
      for (const sh of w.sheets) {
        sh.x += dx;
        sh.y += dy;
      }
      const set = new Set(drag.moved);
      for (const s of drag.moved) {
        for (const p of s.pts) {
          p.x += dx;
          p.y += dy;
        }
        delete s.bb;
      }
      for (const m of ctx.marks.marks) {
        if (m.strokes.length && m.strokes.every((s) => set.has(s))) {
          m.box = { x0: m.box.x0 + dx, y0: m.box.y0 + dy, x1: m.box.x1 + dx, y1: m.box.y1 + dy };
          m.anchor = { x: m.anchor.x + dx, y: m.anchor.y + dy };
        }
      }
      ctx.canvas.redrawAll();
      ctx.sheets.draw();
      ctx.marks.reposition();
    },
    sig,
  );
  const end = () => {
    drag = null;
    el.classList.remove("dragging");
  };
  grip.addEventListener("pointerup", end, sig);
  grip.addEventListener("pointercancel", end, sig);

  function sync() {
    const w = ctx.worksheet;
    if (!w || !w.sheets.length) {
      el.style.display = "none";
      disarm();
      return;
    }
    const first = w.sheets[0];
    const p = ctx.toScreen({ x: first.x, y: first.y });
    name.textContent = w.name;
    el.style.left = Math.round(Math.max(8, Math.min(ctx.viewW() - 200, p.x))) + "px";
    el.style.top = Math.round(Math.max(8, p.y - 36)) + "px";
    el.style.display = p.y - 36 > ctx.viewH() - 20 ? "none" : "";
  }
  return { sync };
}
