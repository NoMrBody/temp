/** LaTeX → SVG (MathJax, loaded on first use) → cached images that are drawn onto canvases. */
export interface TexSize {
  /** width/height of the typeset line in ex units; 1 ex = EX_PER_EM · font size */
  wEx: number;
  hEx: number;
}
export const EX_PER_EM = 0.442;

type Engine = { convert(tex: string): string };
let engine: Promise<Engine> | null = null;

type MJ = {
  startup: { promise: Promise<void> };
  tex2svg(tex: string, o?: { display?: boolean }): { querySelector(s: string): { outerHTML: string } | null };
};

function getEngine(): Promise<Engine> {
  if (!engine) {
    engine = (async () => {
      // The prebuilt browser bundle (the modular CommonJS build needs `require`, which bundlers do not provide).
      const w = window as unknown as { MathJax?: unknown };
      w.MathJax = {
        startup: { typeset: false },
        tex: { packages: ["base", "ams"] },
        svg: { fontCache: "none" },
      };
      await import("mathjax-full/es5/tex-svg.js");
      const mj = (window as unknown as { MathJax: MJ }).MathJax;
      await mj.startup.promise;
      return {
        convert: (tex: string) => mj.tex2svg(`\\displaystyle ${tex}`, { display: false }).querySelector("svg")?.outerHTML ?? "",
      };
    })();
  }
  return engine;
}

const sizes = new Map<string, TexSize | null>(); // by tex: null = cannot be typeset
const images = new Map<string, HTMLImageElement>(); // by color|tex
const jobs = new Map<string, Promise<void>>();

/** Typeset one line (cached). Resolves when `peekSize`/`peekImage` can answer. */
export function renderTex(tex: string, color: string): Promise<void> {
  const key = color + "|" + tex;
  const hit = jobs.get(key);
  if (hit) return hit;
  const job = (async () => {
    try {
      const svg = (await getEngine()).convert(tex);
      if (svg.includes("data-mjx-error") || svg.includes('data-mml-node="merror"')) {
        sizes.set(tex, null);
        return;
      }
      const w = /width="([\d.]+)ex"/.exec(svg),
        h = /height="([\d.]+)ex"/.exec(svg);
      if (!w || !h) {
        sizes.set(tex, null);
        return;
      }
      const withNs = /xmlns=/.test(svg) ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      const colored = withNs.replace(/^<svg([^>]*?) style="[^"]*"/, `<svg$1 style="color:${color}"`);
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(colored);
      await img.decode();
      sizes.set(tex, { wEx: parseFloat(w[1]), hEx: parseFloat(h[1]) });
      images.set(key, img);
    } catch (err) {
      try {
        console.warn("[latex] could not typeset a line:", err);
      } catch {
        /* console may be missing */
      }
      sizes.set(tex, null);
    }
  })();
  jobs.set(key, job);
  return job;
}

/** undefined = not typeset yet, null = LaTeX error (drawn as plain text), else the size */
export const peekSize = (tex: string): TexSize | null | undefined => sizes.get(tex);
export const peekImage = (tex: string, color: string): HTMLImageElement | undefined => images.get(color + "|" + tex);
