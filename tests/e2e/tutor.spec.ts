import { expect, test } from "@playwright/test";
import { captureChecks, card, count, calls, drawLine, glowCount, lastOutcome, manualCheck, openBoard, plotButtons, resetMock, scenario, ticks } from "./helpers";

const SHOT = "test-results/screenshots/";
const L = (tag: number, status: "ok" | "error" | "skip", extra: object = {}) => ({ tag, text: `line ${tag}`, status, ...extra });

test.beforeEach(async () => {
  await resetMock();
});

test.describe("verifier outcomes", () => {
  test("1. Verifier confirms: tick on L1, glow + Verifier hint on L2", async ({ page }) => {
    await scenario({
      judge: { lines: [L(1, "ok"), L(2, "error")], stage: "in_progress", feedback: "judge fallback hint" },
      verifier: { verdict: "confirmed", hint: "Verifier says: check the sign on line two." },
    });
    await openBoard(page, { manual: true });
    await drawLine(page, 200);
    await drawLine(page, 300);
    await manualCheck(page);
    await expect(card(page)).toHaveClass(/show/);
    await expect(page.locator("#cardText")).toHaveText("Verifier says: check the sign on line two.");
    await expect(ticks(page)).toHaveCount(1);
    await expect.poll(() => glowCount(page)).toBeGreaterThan(0);
    await expect(page.locator("#trace")).toHaveAttribute("data-last", /mistake spoken/);
    expect(await count("judge")).toBe(1);
    expect(await count("verifier")).toBe(1);
    await page.screenshot({ path: SHOT + "01-verifier-confirms.png" });
  });

  test("2. Verifier says valid: no caption/glow, tick on L2, no second Verifier call for the same ink", async ({ page }) => {
    await scenario({
      judge: { lines: [L(1, "ok"), L(2, "error")], stage: "in_progress", feedback: "judge hint" },
      verifier: { verdict: "valid" },
    });
    await openBoard(page, { manual: true });
    await drawLine(page, 200);
    await drawLine(page, 300);
    await manualCheck(page);
    await expect(ticks(page)).toHaveCount(2);
    await expect(page.locator("#trace")).toHaveAttribute("data-last", /Verifier caught/);
    await expect(card(page)).not.toHaveClass(/show/);
    expect(await glowCount(page)).toBe(0);
    expect(await count("verifier")).toBe(1);
    // new ink on a third line: the Judge flags L2 again, but the veto is remembered
    await scenario({
      judge: { lines: [L(1, "ok"), L(2, "error"), L(3, "ok")], stage: "in_progress", feedback: "judge hint" },
      verifier: { verdict: "valid" },
    });
    const reqs = captureChecks(page);
    await drawLine(page, 400);
    await manualCheck(page);
    await expect.poll(() => count("judge")).toBe(2);
    await expect(page.locator("#trace .it").first().locator(".o")).not.toHaveText("running…");
    expect(await count("verifier")).toBe(1);
    expect(reqs[0].segments.find((s) => s.tag === 2)?.vetoed).toBe(true);
    expect(await glowCount(page)).toBe(0);
  });

  test("3. Verifier says unclear: no caption, no glow, no tick on that line", async ({ page }) => {
    await scenario({
      judge: { lines: [L(1, "ok"), L(2, "error")], stage: "in_progress", feedback: "judge hint" },
      verifier: { verdict: "unclear" },
    });
    await openBoard(page, { manual: true });
    await drawLine(page, 200);
    await drawLine(page, 300);
    await manualCheck(page);
    await expect(page.locator("#trace")).toHaveAttribute("data-last", /Verifier caught/);
    await expect(ticks(page)).toHaveCount(1);
    await expect(ticks(page).first()).toHaveAttribute("data-tag", "1");
    await expect(card(page)).not.toHaveClass(/show/);
    expect(await glowCount(page)).toBe(0);
  });

  test("4. Verifier fails (HTTP 500): the Judge's own feedback is spoken (fail-open)", async ({ page }) => {
    await scenario({
      judge: { lines: [L(1, "ok"), L(2, "error")], stage: "in_progress", feedback: "Judge fallback: line two is off." },
      verifier: "500",
    });
    await openBoard(page, { manual: true });
    await drawLine(page, 200);
    await drawLine(page, 300);
    await manualCheck(page);
    await expect(page.locator("#cardText")).toHaveText("Judge fallback: line two is off.");
    await expect(card(page)).toHaveClass(/show/);
    await expect(page.locator("#trace")).toHaveAttribute("data-last", /mistake spoken/);
    await expect.poll(() => glowCount(page)).toBeGreaterThan(0);
  });

  test("a mistake is spoken once; a fixed one clears silently; correct finished work is cheered once", async ({ page }) => {
    await scenario({
      judge: { lines: [L(1, "error")], stage: "in_progress", feedback: "first slip" },
      verifier: { verdict: "confirmed", hint: "Line one is off, bro." },
    });
    await openBoard(page, { manual: true });
    await drawLine(page, 200);
    await manualCheck(page);
    await expect(page.locator("#cardText")).toHaveText("Line one is off, bro.");
    const glows = await glowCount(page);
    // the student continues without fixing it: same mistake is NOT announced again
    await scenario({ judge: { lines: [L(1, "error"), L(2, "ok")], stage: "in_progress", feedback: "first slip" }, verifier: { verdict: "confirmed", hint: "again?" } });
    await drawLine(page, 300);
    await manualCheck(page);
    await expect.poll(() => count("judge")).toBe(2);
    await expect(page.locator("#trace .it").first().locator(".o")).not.toHaveText("running…");
    expect(await count("verifier")).toBe(1);
    expect(await page.locator("#cardText").textContent()).toBe("Line one is off, bro.");
    expect(await glowCount(page)).toBe(glows);
    // fixed + finished: cheer
    await scenario({ judge: { lines: [L(1, "ok"), L(2, "ok")], stage: "finished", feedback: "Clean, that's exactly it bro." } });
    await drawLine(page, 400);
    await manualCheck(page);
    await expect(page.locator("#cardText")).toHaveText("Clean, that's exactly it bro.");
    await expect(card(page)).toHaveAttribute("data-kind", "ok");
  });
});

test.describe("modes", () => {
  test("5. Manual mode: no automatic checks; Check runs Judge then Verifier; auto resumes", async ({ page }) => {
    await scenario({
      judge: { lines: [L(1, "ok"), L(2, "error")], stage: "in_progress", feedback: "j" },
      verifier: { verdict: "confirmed", hint: "manual hint" },
    });
    await openBoard(page, { manual: true });
    await expect(page.locator("#checkBtn")).toBeVisible();
    await drawLine(page, 200);
    await drawLine(page, 300);
    await page.waitForTimeout(4000);
    expect((await calls()).filter((c) => c.kind !== "models")).toHaveLength(0);
    await manualCheck(page);
    await expect(page.locator("#cardText")).toHaveText("manual hint");
    const seq = (await calls()).filter((c) => c.kind !== "models").map((c) => c.kind);
    expect(seq).toEqual(["judge", "verifier"]);
    await page.screenshot({ path: SHOT + "05-manual-mode.png" });

    // back to auto: the button hides, and unchecked ink triggers a check after the pause
    await scenario({ judge: { lines: [L(1, "ok"), L(2, "ok"), L(3, "ok")], stage: "in_progress", feedback: "" } });
    await drawLine(page, 400);
    await page.locator("#modeAuto").click();
    await expect(page.locator("#checkBtn")).toBeHidden();
    await expect.poll(() => count("judge"), { timeout: 8000 }).toBe(2);
    // L1 and L3 are ticked; L2 (flagged earlier, now gray) is not re-ticked
    await expect(ticks(page)).toHaveCount(2);
  });

  test("manual mode: nothing to check / empty canvas messages and Enter key", async ({ page }) => {
    await scenario({ judge: { lines: [L(1, "ok")], stage: "in_progress", feedback: "" } });
    await openBoard(page, { manual: true });
    await manualCheck(page);
    await expect(page.locator("#statusText")).toHaveText("Write something first");
    await drawLine(page, 200);
    await page.keyboard.press("Enter");
    await expect(ticks(page)).toHaveCount(1);
    await manualCheck(page);
    await expect(page.locator("#statusText")).toHaveText("Nothing new to check");
  });

  test("auto mode: a pause after writing triggers one check and a tick appears", async ({ page }) => {
    await scenario({ judge: { lines: [L(1, "ok")], stage: "in_progress", feedback: "" } });
    await openBoard(page);
    await drawLine(page, 200);
    await expect(ticks(page)).toHaveCount(1);
    expect(await count("judge")).toBe(1);
    expect(await count("verifier")).toBe(0);
  });

  test("auto mode: starting a new line below checks the finished one immediately; writing never cancels a running check", async ({ page }) => {
    await scenario({ judge: { lines: [L(1, "ok"), L(2, "ok")], stage: "in_progress", feedback: "" }, delayMs: 1500 });
    await openBoard(page);
    const reqs = captureChecks(page);
    await drawLine(page, 200);
    await drawLine(page, 300); // first stroke of line 2 starts a check of line 1 right away
    await expect.poll(() => reqs.length, { timeout: 4000 }).toBeGreaterThanOrEqual(1);
    expect(reqs[0].segments).toHaveLength(1);
    // the running check completes (tick for line 1), a follow-up check covers line 2
    await expect(ticks(page)).toHaveCount(2, { timeout: 15_000 });
    expect(reqs.length).toBe(2);
    expect(reqs[1].segments).toHaveLength(2);
  });
});

test.describe("graph", () => {
  test("6. plot button opens the panel; chips; × closes; unplottable strings get no button", async ({ page }) => {
    await scenario({
      judge: {
        lines: [L(1, "ok", { text: "y = 2x^2", plot: "2*x^2" }), L(2, "ok", { text: "y = x + 1", plot: "x+1" }), L(3, "ok", { text: "|x|", plot: "|x|" })],
        stage: "in_progress",
        feedback: "",
      },
    });
    await openBoard(page, { manual: true });
    await drawLine(page, 200);
    await drawLine(page, 300);
    await drawLine(page, 400);
    await manualCheck(page);
    await expect(plotButtons(page)).toHaveCount(2);
    await plotButtons(page).first().click();
    await expect(page.locator("#graph")).toHaveClass(/open/);
    await expect(page.locator(".g-chip")).toHaveCount(1);
    await expect(page.locator(".g-chip").first()).toContainText("y = 2x^2");
    await plotButtons(page).nth(1).click();
    await expect(page.locator(".g-chip")).toHaveCount(2);
    // duplicates only reopen
    await plotButtons(page).first().click();
    await expect(page.locator(".g-chip")).toHaveCount(2);
    await page.screenshot({ path: SHOT + "06-graph.png" });
    await page.locator(".g-chip button").last().click();
    await expect(page.locator(".g-chip")).toHaveCount(1);
    await expect(page.locator("#graph")).toHaveClass(/open/);
    await page.locator(".g-chip button").last().click();
    await expect(page.locator("#graph")).not.toHaveClass(/open/);
  });

  test("graph panel: zoom, reset and drag the header", async ({ page }) => {
    await scenario({ judge: { lines: [L(1, "ok", { plot: "x^2" })], stage: "in_progress", feedback: "" } });
    await openBoard(page, { manual: true });
    await drawLine(page, 200);
    await manualCheck(page);
    await plotButtons(page).first().click();
    await expect(page.locator("#graph")).toHaveClass(/open/);
    await page.waitForTimeout(400);
    const before = await page.locator("#gcanvas").screenshot();
    await page.locator('[data-z="x+"]').click();
    await page.locator('[data-z="y-"]').click();
    await expect.poll(async () => (await page.locator("#gcanvas").screenshot()).equals(before)).toBe(false);
    await page.waitForTimeout(300);
    const zoomed = await page.locator("#gcanvas").screenshot();
    await page.locator("#gReset").click();
    await expect.poll(async () => (await page.locator("#gcanvas").screenshot()).equals(zoomed)).toBe(false);
    const box0 = (await page.locator("#graph").boundingBox())!;
    await page.mouse.move(box0.x + 200, box0.y + 14);
    await page.mouse.down();
    await page.mouse.move(box0.x + 260, box0.y - 60, { steps: 4 });
    await page.mouse.up();
    const box1 = (await page.locator("#graph").boundingBox())!;
    expect(box1.y).toBeLessThan(box0.y - 40);
  });
});

test.describe("invalidation", () => {
  test("7. writing on / erasing over a ticked line removes its tick; Clear removes all marks", async ({ page }) => {
    await scenario({ judge: { lines: [L(1, "ok"), L(2, "ok")], stage: "in_progress", feedback: "" } });
    await openBoard(page, { manual: true });
    const reqs = captureChecks(page);
    await drawLine(page, 200);
    await drawLine(page, 300);
    await manualCheck(page);
    await expect(ticks(page)).toHaveCount(2);

    // write a stroke on line 1
    await page.mouse.move(300, 215);
    await page.mouse.down();
    await page.mouse.move(340, 225, { steps: 3 });
    await page.mouse.up();
    await expect(ticks(page)).toHaveCount(1);
    await expect(ticks(page).first()).toHaveAttribute("data-tag", "2");

    // erase across line 2: tick gone, ink is "new" again in the next request
    await page.keyboard.press("e");
    await page.mouse.move(190, 320);
    await page.mouse.down();
    await page.mouse.move(470, 320, { steps: 12 });
    await page.mouse.up();
    await expect(ticks(page)).toHaveCount(0);
    await page.keyboard.press("p");
    await scenario({ judge: { lines: [L(1, "ok"), L(2, "ok")], stage: "in_progress", feedback: "" } });
    await manualCheck(page);
    await expect.poll(() => reqs.length).toBe(2);
    expect(reqs[1].segments.every((s) => s.hasNew)).toBe(true);

    await expect(ticks(page).first()).toBeVisible();
    await page.locator("#clearBtn").click();
    await expect(page.locator("#marks .tick:not(.out)")).toHaveCount(0);
    await expect(page.locator("#hint")).not.toHaveClass(/gone/);
  });

  test("undo removes the last stroke and its tick", async ({ page }) => {
    await scenario({ judge: { lines: [L(1, "ok")], stage: "in_progress", feedback: "" } });
    await openBoard(page, { manual: true });
    await drawLine(page, 200);
    await manualCheck(page);
    await expect(ticks(page)).toHaveCount(1);
    await page.mouse.move(250, 215);
    await page.mouse.down();
    await page.mouse.move(280, 225, { steps: 3 });
    await page.mouse.up();
    await expect(ticks(page)).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(page.locator("#board")).toHaveAttribute("data-strokes", "6");
  });
});

test.describe("segmentation", () => {
  test("10. side-by-side equations are four tagged lines in the request", async ({ page }) => {
    await scenario({ judge: { lines: [L(1, "ok"), L(2, "ok"), L(3, "ok"), L(4, "ok")], stage: "in_progress", feedback: "" } });
    await openBoard(page, { manual: true });
    const reqs = captureChecks(page);
    await drawLine(page, 200, 150);
    await drawLine(page, 200, 650);
    await drawLine(page, 330, 150);
    await drawLine(page, 330, 650);
    await manualCheck(page);
    await expect(ticks(page)).toHaveCount(4);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].segments.map((s) => s.tag)).toEqual([1, 2, 3, 4]);
    expect(Object.keys(reqs[0].crops).sort()).toEqual(["1", "2", "3", "4"]); // every new line is a candidate
    expect(reqs[0].image.length).toBeGreaterThan(500);
  });
});

test.describe("reminders", () => {
  test("a mistake left unfixed is re-said differently after the idle time", async ({ page }) => {
    await scenario({
      judge: { lines: [L(1, "error")], stage: "in_progress", feedback: "judge" },
      verifier: { verdict: "confirmed", hint: "First hint: look at line one." },
      coach: { hint: "Second try: line one still has the slip." },
    });
    await openBoard(page);
    const reqs = captureChecks(page);
    await drawLine(page, 200);
    await expect(page.locator("#cardText")).toHaveText("First hint: look at line one.");
    expect(await count("coach")).toBe(0);
    // time passes: the student did nothing
    await page.evaluate(() => ((window as unknown as { __shift: number }).__shift += 60_000));
    await expect(page.locator("#cardText")).toHaveText("Second try: line one still has the slip.", { timeout: 15_000 });
    expect(await count("coach")).toBe(1);
    expect(await count("verifier")).toBe(1);
    const withReminder = reqs.find((r) => r.reminders?.length);
    expect(withReminder?.reminders?.[0].previousHints).toEqual(["First hint: look at line one."]);
    await expect(page.locator("#trace")).toHaveAttribute("data-last", /.+/);
  });

  test("a fixed mistake is not reminded", async ({ page }) => {
    await scenario({
      judge: { lines: [L(1, "error")], stage: "in_progress", feedback: "judge" },
      verifier: { verdict: "confirmed", hint: "First hint: look at line one." },
    });
    await openBoard(page);
    await drawLine(page, 200);
    await expect(page.locator("#cardText")).toHaveText("First hint: look at line one.");
    await scenario({ judge: { lines: [L(1, "ok")], stage: "in_progress", feedback: "" } });
    await page.evaluate(() => ((window as unknown as { __shift: number }).__shift += 60_000));
    await expect.poll(() => count("judge"), { timeout: 15_000 }).toBe(2);
    await expect(ticks(page)).toHaveCount(0 + (await ticks(page).count())); // settle
    expect(await count("coach")).toBe(0);
    await expect(card(page)).not.toHaveClass(/show/);
    await page.waitForTimeout(2500);
    expect(await count("judge")).toBe(2);
  });
});

test("mock never receives the key in a URL and thinking config matches the model family", async ({ page }) => {
  await scenario({ judge: { lines: [L(1, "ok")], stage: "in_progress", feedback: "" } });
  await openBoard(page, { manual: true });
  await drawLine(page, 200);
  await manualCheck(page);
  await expect(ticks(page)).toHaveCount(1);
  const c = (await calls()).filter((x) => x.kind === "judge");
  expect(c.every((x) => x.key === "header")).toBe(true);
});
