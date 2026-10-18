import { clampScale, MAX_SCALE, MIN_SCALE, panToReveal, zoomAround, type View } from "./viewmath";
import type { Box, Ctx, ViewApi } from "./types";

export function createView(ctx: Ctx): ViewApi {
  const sig = { signal: ctx.signal };
  const v = ctx.view;
  let raf = 0;
  ctx.signal.addEventListener("abort", () => cancelAnimationFrame(raf));

  function label() {
    ctx.$("zoomLabel").textContent = Math.round(v.scale * 100) + "%";
    ctx.board.dataset.view = `${v.scale.toFixed(3)},${Math.round(v.tx)},${Math.round(v.ty)}`;
  }
  function refreshNow() {
    raf = 0;
    ctx.glow.stop();
    ctx.canvas.redrawAll();
    ctx.sheets.draw();
    ctx.marks.reposition();
    ctx.notesUi.sync();
    label();
  }
  function schedule() {
    label();
    if (!raf) raf = requestAnimationFrame(refreshNow);
  }
  function set(n: View) {
    v.scale = clampScale(n.scale);
    v.tx = n.tx;
    v.ty = n.ty;
    schedule();
  }
  function zoomAt(f: number, cx: number, cy: number) {
    set(zoomAround(v, f, cx, cy));
  }
  function fit() {
    const b = ctx.sheets.bounds();
    if (!b) {
      set({ scale: 1, tx: 0, ty: 0 });
      return;
    }
    const scale = clampScale((ctx.viewW() - 60) / (b.x1 - b.x0));
    const first = ctx.worksheet?.sheets[0];
    set({ scale, tx: (ctx.viewW() - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale, ty: 70 - (first ? first.y : b.y0) * scale });
  }
  function reveal(box: Box) {
    // keep clear of the chat panel when it is open
    const chat = ctx.$("chat");
    const left = chat.classList.contains("open") ? chat.getBoundingClientRect().left - 8 : ctx.viewW();
    set(panToReveal(v, box, Math.min(ctx.viewW(), left), ctx.viewH()));
  }

  ctx.board.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // pinch on a trackpad arrives as ctrl+wheel
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      } else {
        const unit = e.deltaMode === 1 ? 16 : 1;
        set({ ...v, tx: v.tx - (e.shiftKey ? e.deltaY : e.deltaX) * unit, ty: v.ty - (e.shiftKey ? 0 : e.deltaY) * unit });
      }
    },
    { signal: ctx.signal, passive: false },
  );
  const step = (f: number) => zoomAt(f, ctx.viewW() / 2, ctx.viewH() / 2);
  ctx.$("zoomIn").addEventListener("click", () => step(1.25), sig);
  ctx.$("zoomOut").addEventListener("click", () => step(1 / 1.25), sig);
  ctx.$("zoomLabel").addEventListener("click", () => set({ ...v, scale: 1 }), sig);
  ctx.$("zoomFit").addEventListener("click", () => fit(), sig);
  window.addEventListener("resize", () => schedule(), sig);
  ctx.$("zoomIn").title = `Zoom in (max ${MAX_SCALE * 100}%)`;
  ctx.$("zoomOut").title = `Zoom out (min ${MIN_SCALE * 100}%)`;
  label();

  return { set, panBy: (dx, dy) => set({ ...v, tx: v.tx + dx, ty: v.ty + dy }), zoomAt, fit, reveal, refreshNow };
}
