import { expect, test } from "@playwright/test";
import { drawLine, openBoard } from "./helpers";

test.describe("small screens and stylus", () => {
  test("phone width: toolbar stays inside the screen and canvas matches the window", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openBoard(page, { manual: true });
    const tb = (await page.locator(".toolbar").boundingBox())!;
    expect(tb.x).toBeGreaterThanOrEqual(0);
    expect(tb.x + tb.width).toBeLessThanOrEqual(360);
    expect(tb.y + tb.height).toBeLessThanOrEqual(640);
    const size = await page.locator("#board").evaluate((c) => [c.getBoundingClientRect().width, c.getBoundingClientRect().height]);
    expect(size).toEqual([360, 640]);
  });

  test("tablet: canvas follows rotation and ink stays under the pointer", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await openBoard(page, { manual: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await expect.poll(() => page.locator("#board").evaluate((c) => c.getBoundingClientRect().width)).toBe(1180);
    await drawLine(page, 300);
    await expect(page.locator("#board")).toHaveAttribute("data-strokes", "6");
  });

  test("palm rejection: large touch contacts and touches after the pen are ignored", async ({ page }) => {
    await openBoard(page, { manual: true });
    const fire = (type: string, extra: object) =>
      page.locator("#board").evaluate(
        (c, a) => {
          const o = a as { type: string; extra: object };
          c.dispatchEvent(new PointerEvent(o.type, { bubbles: true, cancelable: true, clientX: 300, clientY: 300, isPrimary: true, ...o.extra }));
        },
        { type, extra },
      );
    // palm: big contact
    await fire("pointerdown", { pointerType: "touch", pointerId: 11, width: 80, height: 80, button: 0, buttons: 1 });
    await fire("pointerup", { pointerType: "touch", pointerId: 11 });
    await expect(page.locator("#board")).toHaveAttribute("data-strokes", "0");
    // normal finger works
    await fire("pointerdown", { pointerType: "touch", pointerId: 12, width: 12, height: 12, button: 0, buttons: 1 });
    await fire("pointerup", { pointerType: "touch", pointerId: 12 });
    await expect(page.locator("#board")).toHaveAttribute("data-strokes", "1");
    // after the pen has touched, fingers are ignored
    await fire("pointerdown", { pointerType: "pen", pointerId: 13, width: 2, height: 2, button: 0, buttons: 1 });
    await fire("pointerup", { pointerType: "pen", pointerId: 13 });
    await fire("pointerdown", { pointerType: "touch", pointerId: 14, width: 12, height: 12, button: 0, buttons: 1 });
    await fire("pointerup", { pointerType: "touch", pointerId: 14 });
    await expect(page.locator("#board")).toHaveAttribute("data-strokes", "2");
  });
});
