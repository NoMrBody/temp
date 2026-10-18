import { EX_PER_EM, peekImage, peekSize, renderTex } from "./latex";
import type { Box, Note } from "./types";

export const NOTE_COLOR = "#8be0a0";
export const NOTE_COLOR_LIGHT = "#15803d";
export const noteColor = (theme: "dark" | "light") => (theme === "light" ? NOTE_COLOR_LIGHT : NOTE_COLOR);
export const NOTE_PDF_COLOR = "#1a7f37";
export const NOTE_FONT = (size: number) => `${size}px Caveat, "Segoe Print", "Comic Sans MS", cursive`;

const GAP = 0.35; // between lines, in em

/** Size of one line in world units: real typeset size when known, an estimate otherwise. */
export function lineSize(tex: string, fontSize: number): { w: number; h: number } {
  const s = peekSize(tex);
  if (s) return { w: s.wEx * EX_PER_EM * fontSize, h: Math.max(s.hEx * EX_PER_EM * fontSize, fontSize) };
  return { w: tex.length * fontSize * 0.5, h: fontSize * 1.2 };
}

export function noteBox(n: Note): Box {
  let w = 0,
    h = 0;
  for (const l of n.lines) {
    const s = lineSize(l, n.fontSize);
    w = Math.max(w, s.w);
    h += s.h + GAP * n.fontSize;
  }
  return { x0: n.x, y0: n.y, x1: n.x + w, y1: n.y + h };
}

/** Typesets every line (resolves when all are ready). */
export const prepareNotes = (notes: Note[], color: string) =>
  Promise.all(notes.flatMap((n) => n.lines.map((l) => renderTex(l, color)))).then(() => undefined);

/** Largest font size (world units, within [min, max]) at which the widest line fits `maxWidth`. */
export function fitFontSize(lines: string[], maxWidth: number, max: number, min: number): number {
  let widest = 0;
  for (const l of lines) widest = Math.max(widest, lineSize(l, 1).w);
  return Math.max(min, Math.min(max, Math.floor((maxWidth / Math.max(widest, 0.01)) * 10) / 10));
}

/** Draws tex notes; lines that are still being typeset are requested and `onReady` is called when they arrive. */
export function drawNotes(
  g: CanvasRenderingContext2D,
  notes: Note[],
  tf: (p: { x: number; y: number }) => { x: number; y: number },
  scale: number,
  color: string,
  onReady?: () => void,
): void {
  g.save();
  g.fillStyle = color;
  g.textBaseline = "top";
  for (const n of notes) {
    let y = n.y;
    for (const line of n.lines) {
      const { h } = lineSize(line, n.fontSize);
      const p = tf({ x: n.x, y });
      const size = peekSize(line);
      const img = peekImage(line, color);
      if (size && img) {
        const iw = size.wEx * EX_PER_EM * n.fontSize,
          ih = size.hEx * EX_PER_EM * n.fontSize;
        g.drawImage(img, p.x, p.y + ((h - ih) / 2) * scale, iw * scale, ih * scale);
      } else if (size === null) {
        g.font = NOTE_FONT(n.fontSize * scale); // LaTeX error: show the raw text
        g.fillText(line, p.x, p.y);
      } else if (onReady) {
        void renderTex(line, color).then(onReady); // not typeset yet (or only in another colour)
      }
      y += h + GAP * n.fontSize;
    }
  }
  g.restore();
}
