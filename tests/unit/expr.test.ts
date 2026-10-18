import { describe, expect, it } from "vitest";
import { compileExpr } from "../../lib/board/graph/expr";

const r = (v: number) => Math.round(v * 1000) / 1000;
const table: [string, number, number, number][] = [
  ["2x^2", 2, 8, 0.5],
  ["(2/5)*x^5+1", 1.4, 13.8, 1.013],
  ["-x^2", -1, -4, -0.25],
  ["x^-2", 1, 0.25, 4],
  ["2(x+1)(x-1)", 0, 6, -1.5],
  ["sin(x)", 0.841, 0.909, 0.479],
  ["sinx", 0.841, 0.909, 0.479],
  ["3x²", 3, 12, 0.75],
  ["2^x", 2, 4, 1.414],
  ["sqrt(x)", 1, 1.414, 0.707],
  ["1/2x", 0.5, 1, 0.25],
  ["e^x", 2.718, 7.389, 1.649],
  ["y=x+1", 2, 3, 1.5],
  ["pi*x", 3.142, 6.283, 1.571],
  ["4x", 4, 8, 2],
];

describe("compileExpr", () => {
  it.each(table)("%s", (src, a, b, c) => {
    const f = compileExpr(src);
    expect(r(f(1))).toBe(a);
    expect(r(f(2))).toBe(b);
    expect(r(f(0.5))).toBe(c);
  });

  it.each([["|x|"], ["2x+"], ["abc"], [""], ["x".repeat(121)]])("throws on %j", (src) => {
    expect(() => compileExpr(src)).toThrow();
  });

  it("does not use eval or Function", () => {
    expect(() => compileExpr("constructor")).toThrow();
    expect(() => compileExpr("alert(1)")).toThrow();
  });
});
