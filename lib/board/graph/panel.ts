import type { Ctx, GraphApi } from "../types";
import { compileExpr, fitView, pointsOfInterest, type Series, type View } from "./expr";

const COLORS = ["#7cb7ff", "#f59e0b", "#4ade80", "#f472b6", "#a78bfa", "#22d3ee"];

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}
const fmt = (v: number) => {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1);
  return String(Math.round(v * 1000) / 1000);
};

export function createGraph(ctx: Ctx): GraphApi {
  const panel = ctx.$("graph");
  const cv = ctx.$("gcanvas") as HTMLCanvasElement;
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  const series: Series[] = [];
  let view: View = { x0: -6, x1: 6, y0: -6, y1: 6 };
  let hover: { px: number; py: number } | null = null;
  let raf = 0;
  let poi: { x: number; y: number }[] = [];
  let poiKey = "";
  const sig = { signal: ctx.signal };

  const size = () => {
    const r = cv.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };
  function fit() {
    view = fitView(series);
  }
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }
  ctx.signal.addEventListener("abort", () => cancelAnimationFrame(raf));

  const toPx = (x: number, y: number, w: number, h: number) => ({
    px: ((x - view.x0) / (view.x1 - view.x0)) * w,
    py: h - ((y - view.y0) / (view.y1 - view.y0)) * h,
  });
  const toVal = (px: number, py: number, w: number, h: number) => ({
    x: view.x0 + (px / w) * (view.x1 - view.x0),
    y: view.y0 + ((h - py) / h) * (view.y1 - view.y0),
  });

  function chips() {
    const box = ctx.$("gSeries");
    box.innerHTML = "";
    series.forEach((s, i) => {
      const c = document.createElement("span");
      c.className = "g-chip";
      c.dataset.expr = s.expr;
      const dot = document.createElement("i");
      dot.style.background = s.color;
      const t = document.createElement("span");
      t.textContent = s.label;
      const x = document.createElement("button");
      x.textContent = "×";
      x.title = "Remove";
      x.setAttribute("aria-label", "Remove " + s.label);
      x.addEventListener(
        "click",
        () => {
          series.splice(i, 1);
          if (!series.length) panel.classList.remove("open");
          else {
            poiKey = "";
            chips();
            schedule();
          }
        },
        sig,
      );
      c.append(dot, t, x);
      box.appendChild(c);
    });
  }

  function draw() {
    if (!panel.classList.contains("open")) return;
    const { w, h } = size();
    const dpr = ctx.dpr;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const light = ctx.theme() === "light";
    const pal = light
      ? { bg: "#fbfcff", grid: "rgba(60,85,130,.16)", label: "rgba(70,84,110,.95)", axis: "rgba(30,45,80,.55)", cross: "rgba(30,45,80,.35)", text: "#1b2433" }
      : { bg: "#0f131b", grid: "rgba(130,155,200,.12)", label: "rgba(133,144,166,.9)", axis: "rgba(200,215,240,.45)", cross: "rgba(230,235,245,.35)", text: "#e6ebf5" };
    g.fillStyle = pal.bg;
    g.fillRect(0, 0, w, h);
    g.font = '10px "JetBrains Mono", monospace';

    // grid
    const sx = niceStep(view.x1 - view.x0, w / 70),
      sy = niceStep(view.y1 - view.y0, h / 50);
    g.lineWidth = 1;
    g.strokeStyle = pal.grid;
    g.fillStyle = pal.label;
    const ax = Math.min(Math.max(toPx(0, 0, w, h).px, 0), w);
    const ay = Math.min(Math.max(toPx(0, 0, w, h).py, 0), h);
    for (let x = Math.ceil(view.x0 / sx) * sx; x <= view.x1; x += sx) {
      const p = toPx(x, 0, w, h).px;
      g.beginPath();
      g.moveTo(Math.round(p) + 0.5, 0);
      g.lineTo(Math.round(p) + 0.5, h);
      g.stroke();
      if (Math.abs(x) > sx / 2) g.fillText(fmt(x), p + 3, Math.min(h - 3, ay + 11));
    }
    for (let y = Math.ceil(view.y0 / sy) * sy; y <= view.y1; y += sy) {
      const p = toPx(0, y, w, h).py;
      g.beginPath();
      g.moveTo(0, Math.round(p) + 0.5);
      g.lineTo(w, Math.round(p) + 0.5);
      g.stroke();
      if (Math.abs(y) > sy / 2) g.fillText(fmt(y), Math.min(w - 30, ax + 4), p - 3);
    }
    g.strokeStyle = pal.axis;
    g.beginPath();
    g.moveTo(0, Math.round(ay) + 0.5);
    g.lineTo(w, Math.round(ay) + 0.5);
    g.moveTo(Math.round(ax) + 0.5, 0);
    g.lineTo(Math.round(ax) + 0.5, h);
    g.stroke();

    // curves
    const jump = (view.y1 - view.y0) * 1.5;
    for (const s of series) {
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.beginPath();
      let prev: number | null = null;
      for (let px = 0; px <= w; px++) {
        const x = view.x0 + (px / w) * (view.x1 - view.x0);
        const y = s.f(x);
        if (!Number.isFinite(y) || Math.abs(y) > 1e9) {
          prev = null;
          continue;
        }
        const py = h - ((y - view.y0) / (view.y1 - view.y0)) * h;
        if (prev === null || Math.abs(y - prev) > jump) g.moveTo(px, py);
        else g.lineTo(px, py);
        prev = y;
      }
      g.stroke();
    }

    // points of interest for the newest series only
    const newest = series[series.length - 1];
    if (newest) {
      const key = `${newest.expr}|${view.x0.toFixed(3)}|${view.x1.toFixed(3)}|${view.y0.toFixed(3)}|${view.y1.toFixed(3)}`;
      if (key !== poiKey) {
        poi = pointsOfInterest(newest, view);
        poiKey = key;
      }
      for (const p of poi) {
        const q = toPx(p.x, p.y, w, h);
        g.fillStyle = newest.color;
        g.beginPath();
        g.arc(q.px, q.py, 3.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = pal.text;
        g.fillText(`(${fmt(p.x)}, ${fmt(p.y)})`, Math.min(w - 70, q.px + 6), Math.max(10, q.py - 6));
      }
    }

    // hover crosshair
    const read = ctx.$("gRead");
    if (hover) {
      const v = toVal(hover.px, hover.py, w, h);
      g.strokeStyle = pal.cross;
      g.beginPath();
      g.moveTo(hover.px, 0);
      g.lineTo(hover.px, h);
      g.stroke();
      const parts = series.map((s) => {
        const y = s.f(v.x);
        return `${s.label}: ${Number.isFinite(y) ? fmt(y) : "undefined"}`;
      });
      read.textContent = `x = ${fmt(v.x)}  ·  ${parts.join("  ·  ")}`;
    } else read.textContent = "drag to pan · scroll to zoom";
  }

  function zoom(axis: "x" | "y", k: number, cx?: number, cy?: number) {
    if (axis === "x") {
      const c = cx ?? (view.x0 + view.x1) / 2;
      view = { ...view, x0: c + (view.x0 - c) * k, x1: c + (view.x1 - c) * k };
    } else {
      const c = cy ?? (view.y0 + view.y1) / 2;
      view = { ...view, y0: c + (view.y0 - c) * k, y1: c + (view.y1 - c) * k };
    }
  }

  // toolbar buttons
  for (const b of Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-z]"))) {
    b.addEventListener(
      "click",
      () => {
        const z = b.dataset.z as string;
        zoom(z[0] as "x" | "y", z[1] === "+" ? 1 / 1.35 : 1.35);
        schedule();
      },
      sig,
    );
  }
  ctx.$("gReset").addEventListener(
    "click",
    () => {
      fit();
      schedule();
    },
    sig,
  );
  ctx.$("gClose").addEventListener("click", () => panel.classList.remove("open"), sig);

  // pan / hover / wheel
  let drag: { px: number; py: number; v: View } | null = null;
  cv.addEventListener(
    "pointerdown",
    (e) => {
      const r = cv.getBoundingClientRect();
      drag = { px: e.clientX - r.left, py: e.clientY - r.top, v: { ...view } };
      cv.setPointerCapture(e.pointerId);
    },
    sig,
  );
  cv.addEventListener(
    "pointermove",
    (e) => {
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left,
        py = e.clientY - r.top;
      hover = { px, py };
      if (drag) {
        const { w, h } = size();
        const dx = ((px - drag.px) / w) * (drag.v.x1 - drag.v.x0);
        const dy = ((py - drag.py) / h) * (drag.v.y1 - drag.v.y0);
        view = { x0: drag.v.x0 - dx, x1: drag.v.x1 - dx, y0: drag.v.y0 + dy, y1: drag.v.y1 + dy };
      }
      schedule();
    },
    sig,
  );
  const endDrag = () => {
    drag = null;
  };
  cv.addEventListener("pointerup", endDrag, sig);
  cv.addEventListener("pointercancel", endDrag, sig);
  cv.addEventListener(
    "pointerleave",
    () => {
      hover = null;
      schedule();
    },
    sig,
  );
  cv.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const { w, h } = size();
      const v = toVal(e.clientX - r.left, e.clientY - r.top, w, h);
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      zoom("x", k, v.x);
      zoom("y", k, v.y);
      schedule();
    },
    { signal: ctx.signal, passive: false },
  );

  // draggable header
  const head = panel.querySelector(".g-head") as HTMLElement;
  let hd: { dx: number; dy: number } | null = null;
  head.addEventListener(
    "pointerdown",
    (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const r = panel.getBoundingClientRect();
      hd = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      head.setPointerCapture(e.pointerId);
    },
    sig,
  );
  head.addEventListener(
    "pointermove",
    (e) => {
      if (!hd) return;
      panel.style.left = Math.max(0, Math.min(ctx.viewW() - 60, e.clientX - hd.dx)) + "px";
      panel.style.top = Math.max(0, Math.min(ctx.viewH() - 40, e.clientY - hd.dy)) + "px";
      panel.style.bottom = "auto";
    },
    sig,
  );
  head.addEventListener("pointerup", () => (hd = null), sig);
  head.style.cursor = "move";
  window.addEventListener("resize", schedule, sig);
  window.addEventListener("mathboard:theme", schedule, sig);

  return {
    addSeries(expr: string, label: string) {
      const norm = expr.replace(/\s+/g, "").toLowerCase();
      const dup = series.find((s) => s.expr.replace(/\s+/g, "").toLowerCase() === norm);
      if (!dup) {
        let f;
        try {
          f = compileExpr(expr);
        } catch {
          return;
        }
        series.push({
          expr,
          label: label && label.length < 40 ? label : "y = " + expr,
          f,
          color: COLORS[series.length % COLORS.length],
        });
        fit();
        poiKey = "";
      }
      chips();
      panel.classList.add("open");
      schedule();
    },
  };
}
