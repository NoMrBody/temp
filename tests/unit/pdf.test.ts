import { describe, expect, it } from "vitest";
import { buildPdf } from "../../lib/board/pdf";

const page = (n: number) => ({ jpeg: new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]), width: 10, height: 20, pageWidth: 800, pageHeight: 600 });

describe("buildPdf", () => {
  it("writes a structurally valid PDF with one page object per page and correct xref offsets", () => {
    const bytes = buildPdf([page(1), page(2), page(3)]);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 3");
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(3);
    expect(text).toContain("/MediaBox [0 0 600 450]");
    expect(text).toContain("/Filter /DCTDecode");
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(3 + 3 * 3 - 1);
    entries.forEach((off, i) => expect(text.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it("embeds the JPEG bytes untouched", () => {
    const bytes = buildPdf([page(7)]);
    const hay = Array.from(bytes).join(",");
    expect(hay).toContain("255,216,7,255,217");
  });
});
