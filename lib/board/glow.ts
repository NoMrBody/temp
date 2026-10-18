import { CLIENT_CONFIG } from "../../shared/config";
import { drawFullStroke, strokeBox } from "./geometry";
import type { Box, Ctx, GlowApi, Segment } from "./types";

export function createGlow(ctx: Ctx): GlowApi {
  const g = { raf: 0, sprite: null as HTMLCanvasElement | null, x: 0, y: 0, w: 0, h: 0, t0: 0 };

  function stop() {
    cancelAnimationFrame(g.raf);
    g.raf = 0;
    g.sprite = null;
    delete ctx.glowCanvas.dataset.glow;
    const { gctx, glowCanvas } = ctx;
    gctx.save();
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    gctx.restore();
  }

  function start(seg: Segment) {
    stop();
    const strokes = seg.strokes.filter((s) => ctx.state.strokes.includes(s));
    if (!strokes.length) return;
    let b: Box | null = null;
    for (const s of strokes) {
      const sb = strokeBox(s);
      b = b
        ? { x0: Math.min(b.x0, sb.x0), y0: Math.min(b.y0, sb.y0), x1: Math.max(b.x1, sb.x1), y1: Math.max(b.y1, sb.y1) }
        : { ...sb };
    }
    if (!b) return;
    const dpr = ctx.dpr;
    const m = 40;
    // the sprite lives in screen space: it is rebuilt on every glow, and a pan/zoom stops it
    const sa = ctx.toScreen({ x: b.x0, y: b.y0 }),
      sb = ctx.toScreen({ x: b.x1, y: b.y1 });
    const bx = Math.floor(sa.x - m),
      by = Math.floor(sa.y - m);
    const bw = Math.ceil(sb.x - sa.x + 2 * m),
      bh = Math.ceil(sb.y - sa.y + 2 * m);
    const sp = document.createElement("canvas");
    sp.width = Math.ceil(bw * dpr);
    sp.height = Math.ceil(bh * dpr);
    const c = sp.getContext("2d") as CanvasRenderingContext2D;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tf = (p: { x: number; y: number }) => {
      const q = ctx.toScreen(p);
      return { x: q.x - bx, y: q.y - by };
    };
    const k = ctx.view.scale;
    const light = ctx.theme() === "light";
    c.shadowColor = "rgba(255,80,80,0.95)";
    c.shadowBlur = 26 * dpr;
    for (const s of strokes) drawFullStroke(c, s, tf, 3.2 * k, light ? "rgba(255,70,70,0.5)" : "rgba(255,95,95,0.55)");
    c.shadowBlur = 10 * dpr;
    for (const s of strokes) drawFullStroke(c, s, tf, 1.5 * k, light ? "rgba(185,28,28,1)" : "rgba(255,236,236,1)");
    g.sprite = sp;
    g.x = bx;
    g.y = by;
    g.w = bw;
    g.h = bh;
    g.t0 = performance.now();
    ctx.glowCanvas.dataset.glow = "active";
    ctx.glowCanvas.dataset.glowCount = String(Number(ctx.glowCanvas.dataset.glowCount ?? "0") + 1);

    const smooth = (a: number, cc: number, x: number) => {
      const k = Math.min(1, Math.max(0, (x - a) / (cc - a)));
      return k * k * (3 - 2 * k);
    };
    const frame = (now: number) => {
      if (!g.sprite) return;
      const { gctx, glowCanvas } = ctx;
      const t = (now - g.t0) / CLIENT_CONFIG.GLOW_MS;
      gctx.save();
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
      gctx.restore();
      if (t >= 1) {
        stop();
        return;
      }
      const env = smooth(0, 0.12, t) * (1 - smooth(0.72, 1, t));
      const pulse = ctx.reduceMotion ? 1 : 0.8 + 0.2 * Math.sin(t * Math.PI * 4);
      gctx.globalAlpha = env * pulse;
      gctx.drawImage(g.sprite, g.x, g.y, g.w, g.h);
      gctx.globalAlpha = 1;
      g.raf = requestAnimationFrame(frame);
    };
    g.raf = requestAnimationFrame(frame);
  }

  return { start, stop };
}
