import { expect, test } from "@playwright/test";
import { count, drawLine, openBoard, resetMock, scenario, ticks, PORTS, calls } from "./helpers";

const base = (p: number) => `http://127.0.0.1:${p}/`;

test("8a. missing server key → fatal status text and no check is attempted", async ({ page, request }) => {
  const health = await (await request.get(`http://127.0.0.1:${PORTS.nokey}/api/health`)).json();
  expect(health).toEqual({ ok: true, keyConfigured: false, accessRequired: false });
  await openBoard(page, { base: base(PORTS.nokey), manual: true });
  await expect(page.locator("#statusText")).toHaveText("The server has no GEMINI_API_KEY configured");
  await drawLine(page, 200);
  await page.locator("#checkBtn").click();
  await page.waitForTimeout(500);
  await expect(page.locator("#statusText")).toHaveText("The server has no GEMINI_API_KEY configured");
});

test("8a'. /api/check without a key answers with one fatal error event", async ({ request }) => {
  const res = await request.post(`http://127.0.0.1:${PORTS.nokey}/api/check`, {
    data: { image: "x", segments: [{ tag: 1, key: "1", hasNew: true, announced: false, vetoed: false }], crops: {}, lastIssue: "", persona: "friendly" },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/x-ndjson");
  const lines = (await res.text()).trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toMatchObject({ type: "error", fatal: true, message: "The server has no GEMINI_API_KEY configured" });
});

test("8b. ACCESS_CODE set: the modal opens when no code is stored; a wrong code reopens it", async ({ page, request }) => {
  const health = await (await request.get(`http://127.0.0.1:${PORTS.access}/api/health`)).json();
  expect(health).toEqual({ ok: true, keyConfigured: true, accessRequired: true });
  await openBoard(page, { base: base(PORTS.access), manual: true });
  await expect(page.locator("#accessModal")).toHaveClass(/open/);
  await expect(page.locator("#accessBtn")).toBeVisible();
  await page.locator("#accessInput").fill("wrong-code");
  await page.locator("#accessSave").click();
  await expect(page.locator("#accessModal")).not.toHaveClass(/open/);
  await drawLine(page, 200);
  await page.locator("#checkBtn").click();
  await expect(page.locator("#accessModal")).toHaveClass(/open/);
  await expect(page.locator("#statusText")).toContainText("access code");
});

test("8c. the right access code works end to end", async ({ page, request }) => {
  const bad = await request.post(`http://127.0.0.1:${PORTS.access}/api/check`, { data: {} });
  expect(bad.status()).toBe(401);
  await resetMock("access");
  await scenario({ judge: { lines: [{ tag: 1, text: "x", status: "ok" }], stage: "in_progress", feedback: "" } }, "access");
  await openBoard(page, { base: base(PORTS.access), manual: true, storage: { "iterraai.accessCode": "letmein" } });
  await expect(page.locator("#accessModal")).not.toHaveClass(/open/);
  await drawLine(page, 200);
  await page.locator("#checkBtn").click();
  await expect(ticks(page)).toHaveCount(1);
  expect(await count("judge", "access")).toBe(1);
});

test("api validation: bad body → 400, oversized → 413", async ({ request }) => {
  const url = `http://127.0.0.1:${PORTS.main}/api/check`;
  expect((await request.post(url, { data: { nope: true } })).status()).toBe(400);
  expect((await request.post(url, { data: "not json", headers: { "content-type": "application/json" } })).status()).toBe(400);
  const huge = { image: "a".repeat(4_100_000), segments: [], crops: {}, lastIssue: "", persona: "friendly" };
  expect((await request.post(url, { data: huge })).status()).toBe(413);
  await resetMock();
  expect((await calls()).filter((c) => c.kind !== "models")).toHaveLength(0);
});

test("9. StrictMode double-mount (next dev) does not duplicate listeners: one line → one check", async ({ page }) => {
  await resetMock("dev");
  await scenario({ judge: { lines: [{ tag: 1, text: "x", status: "ok" }], stage: "in_progress", feedback: "" } }, "dev");
  await openBoard(page, { base: base(PORTS.dev) });
  await drawLine(page, 200);
  await expect(ticks(page)).toHaveCount(1);
  await page.waitForTimeout(2500);
  expect(await count("judge", "dev")).toBe(1);
  await expect(page.locator("#board")).toHaveAttribute("data-strokes", "6");
  await expect(page.locator("#marks .tick")).toHaveCount(1);
});

test("chat endpoint: validation, access code and missing key", async ({ request }) => {
  const body = { message: "hi", history: [], persona: "friendly" };
  expect((await request.post(`http://127.0.0.1:${PORTS.main}/api/chat`, { data: { nope: 1 } })).status()).toBe(400);
  expect((await request.post(`http://127.0.0.1:${PORTS.access}/api/chat`, { data: body })).status()).toBe(401);
  const nokey = await request.post(`http://127.0.0.1:${PORTS.nokey}/api/chat`, { data: body });
  expect((await nokey.json()).error).toMatchObject({ fatal: true });
  const ok = await request.post(`http://127.0.0.1:${PORTS.main}/api/chat`, { data: body });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).intent).toBe("answer");
});
