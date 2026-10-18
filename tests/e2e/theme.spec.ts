import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { drawLine, makeWorksheet, openBoard, resetMock, scenario, ticks } from "./helpers";

const px = (page: Page, rect: [number, number, number, number], mode: "dark" | "light") =>
  page.locator("#board").evaluate(
    (c, a) => {
      const [x, y, w, h, m] = a as [number, number, number, number, string];
      const d = (c as HTMLCanvasElement).getContext("2d")!.getImageData(x, y, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 40) continue;
        if ((m === "dark" && d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 130) || (m === "light" && d[i + 2] > 190)) n++;
      }
      return n;
    },
    [...rect, mode] as [number, number, number, number, string],
  );
const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

test.beforeEach(async () => {
  await resetMock();
});

test("dark is the default; the toggle switches to light, is remembered and applies before the first paint", async ({ page }) => {
  await openBoard(page, { manual: true });
  expect(await theme(page)).toBe("dark");
  const dark = await bg(page);
  await page.locator("#themeBtn").click();
  expect(await theme(page)).toBe("light");
  const light = await bg(page);
  expect(light).not.toBe(dark);
  expect(await page.evaluate(() => localStorage.getItem("iterraai.theme"))).toBe("light");
  await expect(page.locator("#themeBtn")).toHaveAttribute("title", "Switch to dark mode");
  await page.screenshot({ path: "test-results/screenshots/theme-light.png" });
  // reload: the stored theme is set by the inline script before React runs
  await page.addInitScript(() => localStorage.setItem("iterraai.theme", "light")); // survives the harness's own init script
  await page.reload();
  expect(await theme(page)).toBe("light");
  expect(await bg(page)).toBe(light);
  await page.locator("#themeBtn").click();
  expect(await theme(page)).toBe("dark");
  expect(await bg(page)).toBe(dark);
});

test("ink stays readable: light on the dark grid, dark on the light grid, existing ink flips with the theme", async ({ page }) => {
  await openBoard(page, { manual: true });
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(260, 360, { steps: 4 });
  await page.mouse.move(320, 300, { steps: 4 });
  await page.mouse.up();
  const rect: [number, number, number, number] = [190, 290, 140, 80];
  expect(await px(page, rect, "light")).toBeGreaterThan(20);
  expect(await px(page, rect, "dark")).toBe(0);
  await page.locator("#themeBtn").click();
  await expect.poll(() => px(page, rect, "dark")).toBeGreaterThan(20);
  expect(await px(page, rect, "light")).toBe(0);
  // new ink in light mode is dark too
  await page.mouse.move(200, 450);
  await page.mouse.down();
  await page.mouse.move(260, 500, { steps: 4 });
  await page.mouse.up();
  expect(await px(page, [190, 440, 100, 70], "dark")).toBeGreaterThan(10);
});

test("light mode: panels, chat, graph and tutor notes are themed", async ({ page }) => {
  const pdf = join(__dirname, ".theme.pdf");
  await makeWorksheet(pdf, 1);
  await scenario({
    chat: { intent: "solution", message: "ok", solution_lines: ["x^2 - 4x = 0", "x(x-4)=0"] },
    judge: { lines: [{ tag: 1, text: "y = x^2", status: "ok", plot: "x^2" }], stage: "in_progress", feedback: "" },
  });
  await openBoard(page, { manual: true, storage: { "iterraai.theme": "light" } });
  expect(await theme(page)).toBe("light");
  await page.locator("#chatFile").setInputFiles(pdf);
  await expect(page.locator("#sheets")).toHaveAttribute("data-sheets", "1");
  await page.locator("#chatInput").fill("write the solution");
  await page.locator("#chatSend").click();
  await expect(page.locator("#notes")).toHaveAttribute("data-typeset", "2");
  // the chat panel is white-ish in light mode
  const panel = await page.locator("#chat").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(panel).toBe("rgb(255, 255, 255)");
  await page.locator("#chatClose").click();
  await drawLineOnSheet(page);
  await page.locator("#checkBtn").click();
  await expect(ticks(page)).toHaveCount(1);
  await page.locator(".gbtn").first().click();
  await expect(page.locator("#graph")).toHaveClass(/open/);
  await page.screenshot({ path: "test-results/screenshots/theme-light-worksheet.png" });
  await page.locator("#themeBtn").click();
  await page.screenshot({ path: "test-results/screenshots/theme-dark-worksheet.png" });
  // the green note changed colour with the theme (still typeset: no re-render needed in the old colour)
  await expect(page.locator("#notes")).toHaveAttribute("data-typeset", "2");
});

async function drawLineOnSheet(page: Page) {
  await drawLine(page, 250, 120);
}
