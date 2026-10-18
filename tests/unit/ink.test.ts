import { createCanvas } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeInk, type InkEnv } from "../../lib/board/ink";
import { exportImage } from "../../lib/board/export";
import type { BoardState, Stroke } from "../../lib/board/types";

beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => createCanvas(1, 1),
  };
});

function mkEnv(): InkEnv & { state: BoardState } {
  const state: BoardState = {
    strokes: [],
    notes: [],
    lastCleared: null,
    current: null,
    activePointer: null,
    tool: "pen",
    penSeen: false,
    strokeSeq: 0,
    checkedIds: new Set(),
    lineMemory: new Map(),
    version: 0,
    destructiveVersion: 0,
    penWidth: 2.6,
  };
  return { state, viewW: () => 1917, viewH: () => 793 };
}

function piece(env: InkEnv, x0: number, x1: number, yTop: number, yBottom: number) {
  const s: Stroke = {
    id: ++env.state.strokeSeq,
    tool: "pen",
    width: 2.6,
    pts: [
      { x: x0, y: yTop },
      { x: (x0 + x1) / 2, y: yBottom },
      { x: x1, y: yBottom },
    ],
    final: true,
  };
  env.state.strokes.push(s);
  return s;
}

describe("segmentation", () => {
  it("keeps side-by-side equations and their derivatives as four lines", () => {
    const env = mkEnv();
    const rows: [number, number, [number, number][]][] = [
      [270, 370, [[600, 650], [690, 760], [815, 860], [870, 915], [925, 955]]],
      [250, 390, [[1280, 1330], [1355, 1410], [1435, 1480], [1495, 1565], [1575, 1650], [1670, 1720], [1765, 1815]]],
      [435, 560, [[650, 690], [705, 715], [725, 785], [850, 875], [915, 960], [995, 1050], [1060, 1130]]],
      [470, 590, [[1335, 1395], [1405, 1415], [1435, 1525], [1580, 1630], [1640, 1730]]],
    ];
    for (const [top, bottom, xs] of rows) for (const [a, b] of xs) piece(env, a, b, top, bottom);
    const an = analyzeInk(env);
    expect(an.segments.map((s) => [s.tag, s.box.x0, s.box.x1, s.box.y0])).toEqual([
      [1, 600, 955, 270],
      [2, 1280, 1815, 250],
      [3, 650, 1130, 435],
      [4, 1335, 1730, 470],
    ]);
  });

  it("ignores pen strokes that are completely erased", () => {
    const env = mkEnv();
    piece(env, 100, 200, 100, 160);
    const gone = piece(env, 100, 200, 400, 460);
    env.state.strokes.push({
      id: ++env.state.strokeSeq,
      tool: "eraser",
      width: 24,
      pts: [
        { x: 90, y: 400 },
        { x: 150, y: 430 },
        { x: 210, y: 460 },
        { x: 215, y: 460 },
      ],
      final: true,
    });
    const an = analyzeInk(env);
    expect(an.segments).toHaveLength(1);
    expect(an.segments[0].strokes.some((s) => s.id === gone.id)).toBe(false);
  });

  it("keeps a fraction (numerator, bar, denominator) in one segment", () => {
    const env = mkEnv();
    piece(env, 300, 330, 200, 240); // numerator
    piece(env, 290, 345, 250, 252); // bar
    piece(env, 300, 330, 262, 302); // denominator
    expect(analyzeInk(env).segments).toHaveLength(1);
  });

  it("marks only unchecked strokes as new and exports tagged lines", () => {
    const env = mkEnv();
    const a = piece(env, 100, 200, 100, 160);
    piece(env, 100, 200, 300, 360);
    env.state.checkedIds.add(a.id);
    const exp = exportImage(env);
    expect(exp).not.toBeNull();
    expect(exp!.segments.map((s) => s.hasNew)).toEqual([false, true]);
    expect(exp!.image.length).toBeGreaterThan(100);
  });

  it("returns null for tiny or missing ink", () => {
    const env = mkEnv();
    expect(exportImage(env)).toBeNull();
    env.state.strokes.push({ id: 1, tool: "pen", width: 2.6, pts: [{ x: 5, y: 5 }], final: true });
    expect(exportImage(env)).toBeNull();
  });

  it("squeezes empty bands in a very tall canvas so lines stay readable (and leaves normal canvases alone)", () => {
    const tall = mkEnv();
    for (let i = 0; i < 10; i++) piece(tall, 100, 300, 500 + i * 700, 540 + i * 700);
    const squeezed = exportImage(tall)!;
    const wOf = (b64: string) => Buffer.from(b64, "base64").readUInt32BE(16);
    const hOf = (b64: string) => Buffer.from(b64, "base64").readUInt32BE(20);
    // 10 lines spread over ~6300 px: unsqueezed they would be scaled by ~0.16 (a 56 + 32 px wide image)
    expect(wOf(squeezed.image)).toBeGreaterThan(150);
    expect(hOf(squeezed.image)).toBeLessThanOrEqual(1024);

    const normal = mkEnv();
    piece(normal, 100, 300, 100, 140);
    piece(normal, 100, 300, 400, 440);
    const plain = exportImage(normal)!;
    // gaps between ordinary lines are kept exactly (scale 1.5 for a small canvas)
    expect(hOf(plain.image)).toBe(Math.round((440 - 100 + 56) * 1.5));
  });
});
