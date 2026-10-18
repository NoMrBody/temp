import { describe, expect, it } from "vitest";
import { clampScale, MAX_SCALE, MIN_SCALE, panToReveal, toScreenPt, toWorldPt, zoomAround } from "../../lib/board/viewmath";

describe("view math", () => {
  const v = { scale: 1.5, tx: 40, ty: -30 };
  it("screen and world are inverse", () => {
    const p = { x: 123, y: -45 };
    const q = toWorldPt(v, toScreenPt(v, p));
    expect(q.x).toBeCloseTo(p.x);
    expect(q.y).toBeCloseTo(p.y);
  });
  it("zoomAround keeps the point under the cursor fixed", () => {
    const before = toWorldPt(v, { x: 300, y: 200 });
    const z = zoomAround(v, 1.7, 300, 200);
    const after = toWorldPt(z, { x: 300, y: 200 });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(z.scale).toBeCloseTo(2.55);
  });
  it("zoom is clamped and stays anchored at the limits", () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    const z = zoomAround({ scale: 3.9, tx: 0, ty: 0 }, 10, 100, 100);
    expect(z.scale).toBe(MAX_SCALE);
    const before = toWorldPt({ scale: 3.9, tx: 0, ty: 0 }, { x: 100, y: 100 });
    const after = toWorldPt(z, { x: 100, y: 100 });
    expect(after.x).toBeCloseTo(before.x);
  });
  it("panToReveal only moves as much as needed", () => {
    const id = { scale: 1, tx: 0, ty: 0 };
    expect(panToReveal(id, { x0: 100, y0: 100, x1: 200, y1: 200 }, 1000, 800)).toEqual(id);
    const r = panToReveal(id, { x0: 1100, y0: 100, x1: 1300, y1: 200 }, 1000, 800);
    expect(r.tx).toBe(-(1300 - (1000 - 24)));
    expect(r.ty).toBe(0);
    const up = panToReveal(id, { x0: 100, y0: -200, x1: 200, y1: -100 }, 1000, 800);
    expect(up.ty).toBe(70 + 200);
  });
});
