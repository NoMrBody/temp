import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { calls, captureChecks, drawLine, makeWorksheet, manualCheck, openBoard, resetMock, scenario, ticks, view } from "./helpers";

const pdfPath = join(__dirname, ".worksheet.pdf");
test.beforeAll(async () => {
  await makeWorksheet(pdfPath, 3);
});
test.beforeEach(async () => {
  await resetMock();
});

async function openWorksheet(page: Page) {
  await openBoard(page, { manual: true });
  await page.locator("#chatFile").setInputFiles(pdfPath);
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "3");
  await expect(page.locator("#sheets")).not.toHaveAttribute("data-rendered", "0");
}
const say = async (page: Page, text: string) => {
  await page.locator("#chatInput").fill(text);
  await page.locator("#chatSend").click();
};
/** how many pixels of the given canvas inside the rect are non-transparent and (optionally) satisfy `pred` */
const px = (page: Page, canvas: string, rect: [number, number, number, number], mode: "opaque" | "dark" | "light" = "opaque") =>
  page.locator(canvas).evaluate(
    (c, a) => {
      const [x, y, w, h, m] = a as [number, number, number, number, string];
      const g = (c as HTMLCanvasElement).getContext("2d")!;
      const d = g.getImageData(Math.round(x), Math.round(y), w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, gg, b, al] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
        if (al < 40) continue;
        if (m === "opaque" || (m === "dark" && r < 90 && gg < 90 && b < 130) || (m === "light" && b > 190)) n++;
      }
      return n;
    },
    [...rect, mode] as [number, number, number, number, string],
  );

test("the PDF's pages float on the canvas, rendered and fitted to the screen", async ({ page }) => {
  await openWorksheet(page);
  await expect(page.locator("#chat")).toHaveClass(/open/);
  await expect(page.locator("#chatPdfName")).toHaveText(".worksheet.pdf · 3 pages");
  const v = await view(page);
  expect(v.scale).toBeCloseTo((1100 - 60) / 820, 2);
  // the first sheet starts near the top and its printed text is really there (dark pixels on white)
  const sheetLeft = v.tx,
    sheetTop = v.ty;
  expect(await px(page, "#sheets", [sheetLeft + 10, sheetTop + 10, 300, 200], "dark")).toBeGreaterThan(200);
  await expect(page.locator("#hint")).toHaveClass(/gone/);
  await page.screenshot({ path: "test-results/screenshots/worksheet-fit.png" });
});

test("pan with the wheel, zoom with ctrl+wheel and the buttons; 0 refits", async ({ page }) => {
  await openWorksheet(page);
  const v0 = await view(page);
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await view(page)).ty).toBe(v0.ty - 300);
  await page.mouse.wheel(100, 0);
  await expect.poll(async () => (await view(page)).tx).toBe(v0.tx - 100);

  const v1 = await view(page);
  const worldBefore = { x: (500 - v1.tx) / v1.scale, y: (350 - v1.ty) / v1.scale };
  await page.mouse.move(500, 350);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await view(page)).scale).toBeGreaterThan(v1.scale * 1.2);
  const v2 = await view(page);
  expect((500 - v2.tx) / v2.scale).toBeCloseTo(worldBefore.x, 0); // the point under the cursor did not move
  expect((350 - v2.ty) / v2.scale).toBeCloseTo(worldBefore.y, 0);

  await page.locator("#zoomOut").click();
  await expect.poll(async () => (await view(page)).scale).toBeLessThan(v2.scale);
  await page.locator("#zoomLabel").click();
  await expect.poll(async () => (await view(page)).scale).toBe(1);
  await expect(page.locator("#zoomLabel")).toHaveText("100%");
  await page.keyboard.press("0");
  await expect.poll(async () => (await view(page)).scale).toBeCloseTo(1040 / 820, 2);
  for (let i = 0; i < 12; i++) await page.locator("#zoomIn").click();
  await expect.poll(async () => (await view(page)).scale).toBe(4);
  for (let i = 0; i < 30; i++) await page.locator("#zoomOut").click();
  await expect.poll(async () => (await view(page)).scale).toBe(0.25);
});

test("ink stays on the sheet while panning; it is dark on the sheet and light on the grid", async ({ page }) => {
  await openWorksheet(page);
  const v = await view(page);
  // write on the sheet
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(260, 340, { steps: 4 });
  await page.mouse.move(320, 300, { steps: 4 });
  await page.mouse.up();
  expect(await px(page, "#board", [195, 295, 130, 50], "dark")).toBeGreaterThan(20);
  expect(await px(page, "#board", [195, 295, 130, 50], "light")).toBe(0);
  // scroll down 200 px: the ink moved up with the sheet
  await page.mouse.move(600, 500);
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await view(page)).ty).toBe(v.ty - 200);
  await expect.poll(() => px(page, "#board", [195, 95, 130, 50], "dark")).toBeGreaterThan(20);
  expect(await px(page, "#board", [195, 295, 130, 50])).toBe(0);
  // write on the empty grid beside the sheet (to the right, after scrolling right): light ink
  await page.mouse.wheel(0, -200);
  await page.keyboard.press("0");
  await page.locator("#chatClose").click();
  await page.locator("#zoomOut").click();
  await page.locator("#zoomOut").click();
  const vv = await view(page);
  const gridX = vv.tx + 820 * vv.scale + 80; // clearly right of the sheet
  await page.mouse.move(gridX, 300);
  await page.mouse.down();
  await page.mouse.move(gridX + 40, 340, { steps: 4 });
  await page.mouse.move(gridX + 80, 300, { steps: 4 });
  await page.mouse.up();
  expect(await px(page, "#board", [gridX - 6, 290, 100, 60], "light")).toBeGreaterThan(10);
});

test("lines written on the sheet are checked as usual; ticks follow panning and hide off screen", async ({ page }) => {
  await scenario({ judge: { lines: [{ tag: 1, text: "a", status: "ok" }, { tag: 2, text: "b", status: "ok" }], stage: "in_progress", feedback: "" } });
  await openWorksheet(page);
  await page.locator("#chatClose").click();
  const reqs = captureChecks(page);
  await drawLine(page, 250, 120);
  await drawLine(page, 360, 120);
  await manualCheck(page);
  await expect(ticks(page)).toHaveCount(2);
  expect(reqs).toHaveLength(1);
  expect(reqs[0].segments).toHaveLength(2);
  const top = () => ticks(page).first().evaluate((el) => parseFloat((el as HTMLElement).style.top));
  const t0 = await top();
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 120);
  await expect.poll(top).toBeCloseTo(t0 - 120, 0);
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => ticks(page).first().evaluate((el) => (el as HTMLElement).style.display)).toBe("none");
});

test("the tutor gets the whole PDF and knows which page you are looking at", async ({ page }) => {
  await scenario({ chat: { intent: "hint", message: "Problem 2a: isolate x.", solution_lines: [] } });
  await openWorksheet(page);
  await say(page, "help me with problem 2a");
  await expect(page.locator("#hintbox")).toHaveClass(/open/);
  let c = (await calls()).filter((x) => x.kind === "chat");
  expect(c[0].hasPdf).toBe(true);
  expect(c[0].focusPage).toBe(1);
  // scroll to page 3
  await page.mouse.move(500, 400);
  const v = await view(page);
  const sheet3Mid = (2 * (1093 + 28) + 546) * v.scale; // sheet height = 820 * 800/600 = 1093 world units
  await page.mouse.wheel(0, sheet3Mid - 300);
  await expect.poll(async () => (await view(page)).ty).toBeLessThan(v.ty - 2000);
  await say(page, "and what about 3b?");
  await expect.poll(async () => (await calls()).filter((x) => x.kind === "chat").length).toBe(2);
  c = (await calls()).filter((x) => x.kind === "chat");
  expect(c[1].focusPage).toBe(3);
  expect(c[1].hasPdf).toBe(true);
});

test("a requested solution is written beside the worksheet and the view pans to it", async ({ page }) => {
  await scenario({ chat: { intent: "solution", message: "Writing it.", solution_lines: ["2x + 3 = 11", "2x = 8", "x = 4"] } });
  await openWorksheet(page);
  const before = await view(page);
  await say(page, "write the solution of 1a on the canvas");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "1");
  await expect(page.locator(".msg.assistant.i-solution")).toContainText("written next to the worksheet");
  await expect.poll(async () => (await view(page)).tx).toBeLessThan(before.tx);
  // the green handwriting is on screen and is not on the sheet
  const v = await view(page);
  const noteX = (820 + 48) * v.scale + v.tx;
  const chatLeft = (await page.locator("#chat").boundingBox())!.x;
  expect(noteX).toBeLessThan(chatLeft - 40); // not hidden behind the chat panel
  await expect.poll(() => px(page, "#notes", [noteX, 70, chatLeft - noteX, 300])).toBeGreaterThan(50);
  await page.screenshot({ path: "test-results/screenshots/worksheet-solution.png" });
  // a second solution does not overwrite the first
  await say(page, "now write the solution of 1b too");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "2");
});

test("worksheets belong to their canvas page; the chip follows and ✕ removes the sheets (ink stays)", async ({ page }) => {
  await openWorksheet(page);
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(340, 340, { steps: 3 });
  await page.mouse.up();
  await page.locator("#pageAdd").click();
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "0");
  await expect(page.locator("#chatPdf")).toBeHidden();
  expect(await view(page)).toEqual({ scale: 1, tx: 0, ty: 0 });
  await page.locator("#pagePrev").click();
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "3");
  await expect(page.locator("#chatPdf")).toBeVisible();
  expect((await view(page)).scale).toBeCloseTo(1040 / 820, 2);
  await page.locator("#chatPdfRemove").click();
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "0");
  await expect(page.locator("#chatPdf")).toBeHidden();
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "1");
});

test("export PDF: one page per worksheet page with the writing and the tutor's notes on it", async ({ page }) => {
  await scenario({ chat: { intent: "solution", message: "ok", solution_lines: ["x = 4"] } });
  await openWorksheet(page);
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(340, 340, { steps: 3 });
  await page.mouse.up();
  await say(page, "write the solution");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "1");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportPdf").click()]);
  const bytes = readFileSync((await download.path())!);
  const text = bytes.toString("latin1");
  expect(text).toContain("/Count 3");
  expect(bytes.length).toBeGreaterThan(30_000);
  await expect(page.locator("#statusText")).toContainText("Exported 3 pages");
});

test("hand tool, Space and middle button move the view without drawing", async ({ page }) => {
  await openBoard(page, { manual: true });
  await page.keyboard.press("h");
  await expect(page.locator("#handBtn")).toHaveClass(/active/);
  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(460, 440, { steps: 4 });
  await page.mouse.up();
  expect(await view(page)).toMatchObject({ tx: 60, ty: 40 });
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "0");
  await page.keyboard.press("p");
  await page.keyboard.down("Space");
  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(380, 400, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  expect(await view(page)).toMatchObject({ tx: 40, ty: 40 });
  await page.mouse.move(400, 400);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(400, 450, { steps: 3 });
  await page.mouse.up({ button: "middle" });
  expect(await view(page)).toMatchObject({ tx: 40, ty: 90 });
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "0");
  // drawing still works afterwards, in world coordinates (the view is offset)
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(340, 320, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "1");
});

test("touch: two fingers pinch-zoom and pan; with a pen in use one finger pans", async ({ page }) => {
  await openBoard(page, { manual: true });
  const fire = (type: string, id: number, x: number, y: number, kind = "touch") =>
    page.locator("#board").evaluate(
      (c, a) => {
        const o = a as { type: string; id: number; x: number; y: number; kind: string };
        c.dispatchEvent(new PointerEvent(o.type, { bubbles: true, cancelable: true, pointerId: o.id, pointerType: o.kind, clientX: o.x, clientY: o.y, width: 10, height: 10, isPrimary: o.id === 1, button: 0, buttons: 1 }));
      },
      { type, id, x, y, kind },
    );
  await fire("pointerdown", 1, 400, 400);
  await fire("pointerdown", 2, 500, 400);
  await fire("pointermove", 1, 350, 400);
  await fire("pointermove", 2, 550, 400); // fingers moved apart: 100 → 200
  await fire("pointerup", 1, 350, 400);
  await fire("pointerup", 2, 550, 400);
  const v = await view(page);
  expect(v.scale).toBeCloseTo(2, 1);
  expect(v.tx).toBeLessThan(-300); // zoomed around the fingers, not around the corner
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "0");
  // the stylus draws; afterwards a single finger scrolls instead of drawing
  await fire("pointerdown", 7, 300, 300, "pen");
  await fire("pointermove", 7, 330, 320, "pen");
  await fire("pointerup", 7, 330, 320, "pen");
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "1");
  await page.waitForTimeout(1700); // the palm-guard window after the pen
  const t0 = await view(page);
  await fire("pointerdown", 9, 400, 400);
  await fire("pointermove", 9, 400, 300);
  await fire("pointerup", 9, 400, 300);
  expect((await view(page)).ty).toBe(t0.ty - 100);
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "1");
});

test("a bad PDF is reported and leaves the canvas alone", async ({ page }) => {
  await openBoard(page, { manual: true });
  await page.locator("#chatFile").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 this is not really a pdf") });
  await expect(page.locator(".msg.system.error")).toContainText("Could not open that PDF");
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "0");
  await expect(page.locator("#chatPdf")).toBeHidden();
});

const rectOf = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

test("the solution is typeset LaTeX (not plain text); broken LaTeX falls back to plain text", async ({ page }) => {
  await scenario({ chat: { intent: "solution", message: "ok", solution_lines: ["\\frac{x^2 - 4x}{2} = 0", "x(x-4)=0 \\;\\Rightarrow\\; x=0 \\text{ or } x=4", "\\badmacro{"] } });
  await openWorksheet(page);
  await say(page, "write the solution");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "1");
  await expect(page.locator("#notes")).toHaveAttribute("data-typeset", "2");
  await expect(page.locator("#notes")).toHaveAttribute("data-raw", "1");
  await page.screenshot({ path: "test-results/screenshots/worksheet-latex.png" });
});

test("tutor notes can be dragged anywhere, follow the view, and can be removed", async ({ page }) => {
  await scenario({ chat: { intent: "solution", message: "ok", solution_lines: ["2x + 3 = 11", "2x = 8", "x = 4"] } });
  await openWorksheet(page);
  await say(page, "write the solution");
  await expect(page.locator("#notes")).toHaveAttribute("data-typeset", "3");
  await page.locator("#chatClose").click();
  const grip = page.locator(".note-ctl .grip").first();
  await expect(grip).toBeVisible();
  const g0 = (await grip.boundingBox())!;
  // drag it onto the empty area of the first sheet
  await page.mouse.move(g0.x + 13, g0.y + 13);
  await page.mouse.down();
  await page.mouse.move(g0.x - 300, g0.y + 250, { steps: 8 });
  await page.mouse.up();
  const g1 = (await grip.boundingBox())!;
  expect(g1.x).toBeCloseTo(g0.x - 313, 0); // the pointer started at the handle's centre (+13)
  expect(g1.y).toBeCloseTo(g0.y + 237, 0);
  // the typeset lines moved with it
  await expect.poll(() => px(page, "#notes", [g1.x, g1.y + 28, 120, 90])).toBeGreaterThan(50);
  expect(await px(page, "#notes", [g0.x, g0.y + 28, 100, 90])).toBe(0);
  // moving the view moves the handle with the note
  await page.mouse.move(600, 500);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await grip.boundingBox())!.y).toBeCloseTo(g1.y - 100, 0);
  // ✕ removes the note
  await page.locator(".note-ctl .del").first().click();
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "0");
  await expect(page.locator(".note-ctl")).toHaveCount(0);
  expect(await rectOf(page, "#notes").catch(() => null)).not.toBeNull();
});

test("note handles belong to their canvas page", async ({ page }) => {
  await scenario({ chat: { intent: "solution", message: "ok", solution_lines: ["x = 4"] } });
  await openBoard(page, { manual: true });
  await page.keyboard.press("c");
  await say(page, "solve it");
  await expect(page.locator(".note-ctl")).toHaveCount(1);
  await page.locator("#pageAdd").click();
  await expect(page.locator(".note-ctl")).toHaveCount(0);
  await page.locator("#pagePrev").click();
  await expect(page.locator(".note-ctl")).toHaveCount(1);
});

test("PDF export: the sheet keeps its page, the solution beside it is complete (not cropped)", async ({ page }) => {
  test.skip(!(await import("node:child_process")).spawnSync("which", ["pdftoppm"]).stdout.length, "pdftoppm not installed");
  await scenario({ chat: { intent: "solution", message: "ok", solution_lines: Array.from({ length: 10 }, (_, i) => `\\frac{${i + 1}x}{2} + ${i} = 11`) } });
  await openWorksheet(page);
  // scroll a bit so the note's top is above the first sheet's top edge: the old export cropped this
  await page.mouse.move(500, 400);
  await page.mouse.wheel(0, 150);
  await say(page, "write the solution");
  await expect(page.locator("#notes")).toHaveAttribute("data-typeset", "10");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportPdf").click()]);
  const pdf = (await download.path())!;
  const { spawnSync } = await import("node:child_process");
  const outBase = join(__dirname, ".export-page");
  spawnSync("pdftoppm", ["-png", "-r", "30", "-f", "1", "-l", "1", pdf, outBase]);
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const fs = await import("node:fs");
  const file = fs.readdirSync(__dirname).find((f) => f.startsWith(".export-page") && f.endsWith(".png"))!;
  const img = await loadImage(join(__dirname, file));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  let minY = 1e9, maxY = -1, minX = 1e9, maxX = -1, green = 0;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (d[i + 1] > d[i] + 25 && d[i + 1] > d[i + 2] + 25) {
        green++;
        minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      }
    }
  fs.unlinkSync(join(__dirname, file));
  expect(green).toBeGreaterThan(150); // the typeset solution is in the PDF
  expect(minY).toBeGreaterThan(1); // not cut off at the top
  expect(maxY).toBeLessThan(img.height - 2); // nor at the bottom
  expect(maxX).toBeLessThan(img.width - 2); // nor at the right
  expect(img.width / img.height).toBeGreaterThan(0.8); // the page is wider than the sheet alone (3:4 = 0.75) because the note sits beside it
});

test("the worksheet can be dragged by its handle; the writing on it and its ticks go along", async ({ page }) => {
  await scenario({ judge: { lines: [{ tag: 1, text: "a", status: "ok" }], stage: "in_progress", feedback: "" } });
  await openWorksheet(page);
  await page.locator("#chatClose").click();
  await expect(page.locator(".sheet-ctl")).toBeVisible();
  await expect(page.locator(".sheet-ctl .name")).toHaveText(".worksheet.pdf");
  await drawLine(page, 300, 120);
  await page.locator("#checkBtn").click();
  await expect(ticks(page)).toHaveCount(1);
  const tickTop = () => ticks(page).first().evaluate((el) => parseFloat((el as HTMLElement).style.top));
  const tickLeft = () => ticks(page).first().evaluate((el) => parseFloat((el as HTMLElement).style.left));
  const [t0x, t0y] = [await tickLeft(), await tickTop()];
  const v0 = await view(page);
  const inkRect = (dx: number, dy: number): [number, number, number, number] => [110 + dx, 295 + dy, 260, 55];
  expect(await px(page, "#board", inkRect(0, 0), "dark")).toBeGreaterThan(40);
  const grip = page.locator(".sheet-ctl .grip");
  const g0 = (await grip.boundingBox())!;
  await page.mouse.move(g0.x + 13, g0.y + 13);
  await page.mouse.down();
  await page.mouse.move(g0.x + 13 + 120, g0.y + 13 + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => px(page, "#board", inkRect(120, 60), "dark")).toBeGreaterThan(40); // the ink moved with the sheet
  expect(await px(page, "#board", inkRect(0, 0), "dark")).toBe(0);
  expect(await tickLeft()).toBeCloseTo(t0x + 120, 0);
  expect(await tickTop()).toBeCloseTo(t0y + 60, 0);
  expect((await view(page)).tx).toBe(v0.tx); // the view itself did not move
  const g1 = (await grip.boundingBox())!;
  expect(g1.x).toBeCloseTo(g0.x + 120, 0);
  expect(g1.y).toBeCloseTo(g0.y + 60, 0);
  await page.screenshot({ path: "test-results/screenshots/worksheet-moved.png" });
  // the sheet's paper really is where the handle says (white pixels just right/below of the old top-left corner)
  expect(await px(page, "#sheets", [v0.tx + 130, v0.ty + 70, 40, 40])).toBeGreaterThan(1000);
  expect(await px(page, "#sheets", [v0.tx + 2, v0.ty - 20, 100, 20])).toBe(0); // nothing is left behind above the new top edge
  // ticks still belong to their line: a new check does not treat the moved ink as new
  const reqs = captureChecks(page);
  await page.locator("#checkBtn").click();
  await expect(page.locator("#statusText")).toHaveText("Nothing new to check");
  expect(reqs).toHaveLength(0);
});

test("deleting the worksheet needs a second click; the writing stays; the PDF can be opened again", async ({ page }) => {
  await openWorksheet(page);
  await page.locator("#chatClose").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(340, 340, { steps: 3 });
  await page.mouse.up();
  const del = page.locator(".sheet-ctl .del");
  await del.click();
  await expect(del).toHaveText("Delete?");
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "3"); // not yet
  await page.waitForTimeout(3300); // it disarms itself
  await expect(del).toHaveText("×");
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "3");
  await del.click();
  await del.click();
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "0");
  await expect(page.locator(".sheet-ctl")).toBeHidden();
  await expect(page.locator("#chatPdf")).toBeHidden();
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "1");
  await page.locator("#chatFile").setInputFiles(pdfPath);
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "3");
  await expect(page.locator(".sheet-ctl")).toBeVisible();
});

test("a moved worksheet is where the solution goes beside, and the PDF export follows it", async ({ page }) => {
  await scenario({ chat: { intent: "solution", message: "ok", solution_lines: ["x = 4"] } });
  await openWorksheet(page);
  const grip = page.locator(".sheet-ctl .grip");
  const g0 = (await grip.boundingBox())!;
  await page.mouse.move(g0.x + 13, g0.y + 13);
  await page.mouse.down();
  await page.mouse.move(g0.x + 13 - 20, g0.y + 13 + 40, { steps: 4 });
  await page.mouse.up();
  await say(page, "write the solution");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "1");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportPdf").click()]);
  expect(readFileSync((await download.path())!).toString("latin1")).toContain("/Count 3");
});
