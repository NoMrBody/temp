import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { captureChecks, drawLine, manualCheck, openBoard, resetMock, scenario, ticks } from "./helpers";

const L = (tag: number, status: "ok" | "error" | "skip") => ({ tag, text: `line ${tag}`, status });
const label = (page: import("@playwright/test").Page) => page.locator("#pageLabel");
const strokes = (page: import("@playwright/test").Page) => page.locator("#board");

test.beforeEach(async () => {
  await resetMock();
});

test("pages: add, move between them, ink stays on its own page", async ({ page }) => {
  await openBoard(page, { manual: true });
  await expect(label(page)).toHaveText("Page 1 / 1");
  await expect(page.locator("#pagePrev")).toBeDisabled();
  await expect(page.locator("#pageNext")).toBeDisabled();
  await drawLine(page, 200);
  await expect(strokes(page)).toHaveAttribute("data-strokes", "6");

  await page.locator("#pageAdd").click();
  await expect(label(page)).toHaveText("Page 2 / 2");
  await expect(strokes(page)).toHaveAttribute("data-strokes", "0");
  await expect(page.locator("#hint")).not.toHaveClass(/gone/);
  await drawLine(page, 300);
  await drawLine(page, 400);
  await expect(strokes(page)).toHaveAttribute("data-strokes", "12");

  await page.locator("#pagePrev").click();
  await expect(label(page)).toHaveText("Page 1 / 2");
  await expect(strokes(page)).toHaveAttribute("data-strokes", "6");
  await expect(page.locator("#pageNext")).toBeEnabled();
  await page.locator("#pageNext").click();
  await expect(strokes(page)).toHaveAttribute("data-strokes", "12");

  // undo / clear only touch the current page
  await page.locator("#clearBtn").click();
  await expect(strokes(page)).toHaveAttribute("data-strokes", "0");
  await page.locator("#pagePrev").click();
  await expect(strokes(page)).toHaveAttribute("data-strokes", "6");
});

test("each page is checked on its own: separate segments, memory and ticks", async ({ page }) => {
  await scenario({ judge: { lines: [L(1, "ok")], stage: "in_progress", feedback: "" } });
  await openBoard(page, { manual: true });
  const reqs = captureChecks(page);
  await drawLine(page, 200);
  await manualCheck(page);
  await expect(ticks(page)).toHaveCount(1);

  await page.locator("#pageAdd").click();
  await expect(ticks(page)).toHaveCount(0); // page 1's tick does not leak onto page 2
  await drawLine(page, 300);
  await manualCheck(page);
  await expect(ticks(page)).toHaveCount(1);
  expect(reqs).toHaveLength(2);
  expect(reqs[1].segments).toHaveLength(1);
  expect(reqs[1].segments[0].hasNew).toBe(true);

  // going back: page 1 is already checked, so a Manual check finds nothing new
  await page.locator("#pagePrev").click();
  await manualCheck(page);
  await expect(page.locator("#statusText")).toHaveText("Nothing new to check");
  expect(reqs).toHaveLength(2);
});

test("switching pages never lets a running check land on the wrong page", async ({ page }) => {
  await scenario({ judge: { lines: [L(1, "ok")], stage: "in_progress", feedback: "" }, delayMs: 1500 });
  await openBoard(page, { manual: true });
  await drawLine(page, 200);
  await manualCheck(page);
  await page.locator("#pageAdd").click();
  await page.waitForTimeout(2500);
  await expect(ticks(page)).toHaveCount(0);
  await page.locator("#pagePrev").click();
  // the cancelled check left page 1 unchecked: it is still new ink there
  await manualCheck(page);
  await expect(ticks(page)).toHaveCount(1);
});

test("export PDF downloads every page that has writing", async ({ page }) => {
  await openBoard(page, { manual: true });
  await page.locator("#exportPdf").click();
  await expect(page.locator("#statusText")).toContainText("Nothing to export");

  await drawLine(page, 200);
  await page.locator("#pageAdd").click();
  await page.locator("#pageAdd").click(); // page 3, left empty on purpose
  await page.locator("#pagePrev").click();
  await drawLine(page, 300);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportPdf").click()]);
  expect(download.suggestedFilename()).toBe("iterraai.pdf");
  const path = await download.path();
  const bytes = readFileSync(path!);
  const text = bytes.toString("latin1");
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  expect(text).toContain("/Count 2"); // pages 1 and 2 have ink; the empty page 3 is skipped
  expect(bytes.length).toBeGreaterThan(5000);
  await expect(page.locator("#statusText")).toContainText("Exported 2 pages");
});
