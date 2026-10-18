import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

test("the app is called IterraAI", async ({ page }) => {
  await openBoard(page, { manual: true });
  await expect(page).toHaveTitle("IterraAI");
  await expect(page.locator(".hint .brand")).toHaveText("IterraAI");
});

test("settings saved under the old name (mathboard.*) are still honoured", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mathboard.mode", "manual");
    localStorage.setItem("mathboard.theme", "light");
  });
  await page.goto("/");
  await expect(page.locator("#checkBtn")).toBeVisible(); // Manual mode
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await page.locator("#modeAuto").click();
  expect(await page.evaluate(() => localStorage.getItem("iterraai.mode"))).toBe("auto"); // new key wins from now on
});
