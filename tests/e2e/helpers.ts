import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, type Request } from "@playwright/test";

export type Mode = "main" | "nokey" | "access" | "dev";
export const PORTS: Record<Mode, number> = { main: 3100, nokey: 3101, access: 3102, dev: 3103 };

export function mockUrl(mode: Mode = "main"): string {
  const port = readFileSync(join(__dirname, `.mock-port-${mode}`), "utf8").trim();
  return `http://127.0.0.1:${port}`;
}

export async function scenario(s: object, mode: Mode = "main") {
  await fetch(mockUrl(mode) + "/__scenario", { method: "POST", body: JSON.stringify(s) });
}
export async function resetMock(mode: Mode = "main") {
  await fetch(mockUrl(mode) + "/__reset", { method: "POST" });
}
export interface Call {
  kind: "judge" | "verifier" | "coach" | "chat" | "models";
  hasPdf?: boolean;
  turns?: number;
  focusPage?: number;
  hasCanvas?: boolean;
  message?: string;
  model: string;
  context: string;
  hasImage: boolean;
  key: string;
}
export async function calls(mode: Mode = "main"): Promise<Call[]> {
  return (await fetch(mockUrl(mode) + "/__calls")).json();
}
export async function count(kind: Call["kind"], mode: Mode = "main"): Promise<number> {
  return (await calls(mode)).filter((c) => c.kind === kind).length;
}

/** Fresh page with voice muted (caption appears immediately) and optional extra localStorage values. */
export async function openBoard(page: Page, opts: { manual?: boolean; storage?: Record<string, string>; base?: string; voice?: boolean } = {}) {
  const storage: Record<string, string> = { "iterraai.voice": opts.voice ? "on" : "off", ...(opts.manual ? { "iterraai.mode": "manual" } : { "iterraai.mode": "auto" }), ...opts.storage };
  await page.addInitScript((s) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    const real = Date.now;
    (window as unknown as { __shift: number }).__shift = 0;
    Date.now = () => real() + (window as unknown as { __shift: number }).__shift;
  }, storage);
  await page.goto(opts.base ?? "/");
  await expect(page.locator("#board")).toBeVisible();
}

/** One handwritten "line": 6 zig-zag marks like ∧ starting at x0, vertical position y. */
export async function drawLine(page: Page, y: number, x0 = 200) {
  for (let i = 0; i < 6; i++) {
    const x = x0 + 45 * i;
    await page.mouse.move(x, y + 40);
    await page.mouse.down();
    await page.mouse.move(x + 8, y + 20, { steps: 2 });
    await page.mouse.move(x + 15, y, { steps: 2 });
    await page.mouse.move(x + 23, y + 20, { steps: 2 });
    await page.mouse.move(x + 30, y + 40, { steps: 2 });
    await page.mouse.up();
  }
}

export function captureChecks(page: Page) {
  const reqs: { segments: { tag: number; hasNew: boolean; announced: boolean; vetoed: boolean; key: string; memoryText?: string }[]; image: string; crops: Record<string, string>; reminders?: { tag: number; key: string; previousHints: string[] }[] }[] = [];
  page.on("request", (r: Request) => {
    if (r.method() === "POST" && r.url().endsWith("/api/check")) reqs.push(JSON.parse(r.postData() ?? "{}"));
  });
  return reqs;
}

export const ticks = (page: Page) => page.locator("#marks .tick:not(.gbtn):not(.out)");
export const plotButtons = (page: Page) => page.locator("#marks .gbtn:not(.out)");
export const card = (page: Page) => page.locator("#card");
export const glowCount = async (page: Page) => Number((await page.locator("#glow").getAttribute("data-glow-count")) ?? "0");
export const lastOutcome = (page: Page) => page.locator("#trace").getAttribute("data-last");
export async function manualCheck(page: Page) {
  await page.locator("#checkBtn").click();
}

/** A real, renderable worksheet PDF (one JPEG per page with printed problems), written to `path`. */
export async function makeWorksheet(path: string, pages = 3) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const { writeFileSync } = await import("node:fs");
  const { buildPdf } = await import("../../lib/board/pdf");
  const out = [];
  for (let i = 0; i < pages; i++) {
    const c = createCanvas(600, 800);
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 600, 800);
    g.fillStyle = "#000";
    g.font = "28px Arial";
    g.fillText(`Worksheet page ${i + 1}`, 40, 60);
    g.font = "22px Arial";
    g.fillText(`Problem ${i + 1}a: solve 2x + 3 = 11`, 40, 140);
    g.fillText(`Problem ${i + 1}b: factor x^2 - 4x`, 40, 400);
    const jpeg = c.toBuffer("image/jpeg");
    out.push({ jpeg: new Uint8Array(jpeg), width: 600, height: 800, pageWidth: 600, pageHeight: 800 });
  }
  writeFileSync(path, buildPdf(out));
}
export const view = async (page: Page) => {
  const [scale, tx, ty] = ((await page.locator("#board").getAttribute("data-view")) ?? "1,0,0").split(",").map(Number);
  return { scale, tx, ty };
};
