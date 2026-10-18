import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { calls, count, drawLine, makeWorksheet, openBoard, resetMock, scenario } from "./helpers";

const pdfPath = join(__dirname, ".sample.pdf");
test.beforeAll(async () => {
  await makeWorksheet(pdfPath, 1);
});
test.beforeEach(async () => {
  await resetMock();
});

const chat = (page: import("@playwright/test").Page) => page.locator("#chat");
const say = async (page: import("@playwright/test").Page, text: string) => {
  await page.locator("#chatInput").fill(text);
  await page.locator("#chatSend").click();
};

test("chat: open with the button or C, attach a PDF, get a hint in the top-left window", async ({ page }) => {
  await scenario({ chat: { intent: "hint", message: "Problem 1a: start by factoring out x, then use the zero-product rule.", solution_lines: [] } });
  await openBoard(page, { manual: true });
  await expect(chat(page)).not.toHaveClass(/open/);
  await page.keyboard.press("c");
  await expect(chat(page)).toHaveClass(/open/);
  await page.locator("#chatFile").setInputFiles(pdfPath);
  await expect(page.locator("#chatPdf")).toBeVisible();
  await expect(page.locator("#chatPdfName")).toHaveText(".sample.pdf · 1 page");
  await say(page, "help me with problem 1a");
  await expect(page.locator("#hintbox")).toHaveClass(/open/);
  await expect(page.locator("#hintBoxText")).toHaveText(/factoring out x/);
  const box = (await page.locator("#hintbox").boundingBox())!;
  expect(box.x).toBeLessThan(40);
  expect(box.y).toBeLessThan(120);
  await expect(page.locator(".msg.assistant.i-hint")).toContainText("factoring out x");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "0"); // a hint writes nothing on the canvas
  const c = (await calls()).filter((x) => x.kind === "chat");
  expect(c).toHaveLength(1);
  expect(c[0].hasPdf).toBe(true);
  expect(c[0].message).toBe("help me with problem 1a");
  await page.screenshot({ path: "test-results/screenshots/chat-hint.png" });
  await page.locator("#hintClose").click();
  await expect(page.locator("#hintbox")).not.toHaveClass(/open/);
});

test("chat: asking for the solution writes it on the canvas; history is sent along; Enter sends", async ({ page }) => {
  await scenario({
    chat: [
      { intent: "hint", message: "Factor first.", solution_lines: [] },
      { intent: "solution", message: "Okay, writing it on your board.", solution_lines: ["x^2 - 4x = 0", "x(x - 4) = 0", "x = 0 \\text{ or } x = 4"] },
    ],
  });
  await openBoard(page, { manual: true });
  await page.keyboard.press("c");
  await say(page, "help me with 1a");
  await expect(page.locator(".msg.assistant.i-hint")).toBeVisible();
  await page.locator("#chatInput").fill("that is not enough, write the solution on the canvas");
  await page.locator("#chatInput").press("Enter");
  await expect(page.locator(".msg.assistant.i-solution")).toContainText("written on page 1");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "1");
  await expect(page.locator("#hint")).toHaveClass(/gone/);
  await expect(page.locator("#hintbox")).not.toHaveClass(/open/); // the full solution replaces the hint window
  const c = (await calls()).filter((x) => x.kind === "chat");
  expect(c[1].turns).toBe(3); // earlier user + assistant turn + the new message
  expect(c[0].hasPdf).toBe(false);
  await page.screenshot({ path: "test-results/screenshots/chat-solution.png" });
});

test("solution goes below the student's ink and the view follows it; no extra page is needed", async ({ page }) => {
  await scenario({ chat: { intent: "solution", message: "Here.", solution_lines: Array.from({ length: 12 }, (_, i) => `2x + ${i} = 11`) } });
  await openBoard(page, { manual: true });
  await drawLine(page, 200);
  await drawLine(page, 300);
  await drawLine(page, 400);
  await page.keyboard.press("c");
  await say(page, "write the whole solution");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "1");
  await expect(page.locator("#pageLabel")).toHaveText("Page 1 / 1");
  await expect(page.locator(".msg.assistant.i-solution")).toContainText("written on page 1");
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "18");
});

test("tutor notes are never sent to the Judge as the student's work, but are exported to the PDF", async ({ page }) => {
  await scenario({ chat: { intent: "solution", message: "Here.", solution_lines: ["x = 4"] } });
  await openBoard(page, { manual: true });
  await page.keyboard.press("c");
  await say(page, "solve it");
  await expect(page.locator("#notes")).toHaveAttribute("data-notes", "1");
  await page.locator("#checkBtn").click();
  await expect(page.locator("#statusText")).toHaveText("Write something first");
  expect(await count("judge")).toBe(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportPdf").click()]);
  const text = (await import("node:fs")).readFileSync((await download.path())!).toString("latin1");
  expect(text).toContain("/Count 1");
});

test("chat errors and bad files are shown without breaking the chat", async ({ page }) => {
  await openBoard(page, { manual: true });
  await page.keyboard.press("c");
  const bad = join(__dirname, ".not-a-pdf.pdf");
  writeFileSync(bad, "hello");
  await page.locator("#chatFile").setInputFiles(bad);
  await expect(page.locator(".msg.system.error")).toContainText("not a PDF");
  await expect(page.locator("#chatPdf")).toBeHidden();
  await page.route("**/api/chat", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ error: { message: "Gemini is busy" } }) }));
  await say(page, "hello?");
  await expect(page.locator(".msg.assistant.error")).toHaveText("Gemini is busy");
  await expect(page.locator("#chatSend")).toBeEnabled();
});

test("typing in the chat does not trigger board shortcuts", async ({ page }) => {
  await openBoard(page, { manual: true });
  await page.keyboard.press("c");
  await page.locator("#chatInput").focus();
  await page.keyboard.type("epm");
  await expect(page.locator("#eraserBtn")).not.toHaveClass(/active/);
  await expect(page.locator("#voiceBtn")).toHaveAttribute("title", /Voice off/);
});
