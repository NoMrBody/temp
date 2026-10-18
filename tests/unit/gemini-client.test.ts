import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel, callWithHedge, ModelError, parseJudge, parseVerifier, type GeminiBody } from "../../server/gemini/client";
import { buildCandidates, models, resetModelState, usableCandidates, verifierCandidates } from "../../server/gemini/models";
import { parseJsonLoose } from "../../server/gemini/json";

const body: GeminiBody = {
  systemInstruction: { parts: [{ text: "sys" }] },
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  generationConfig: { maxOutputTokens: 2048 },
};
const okPayload = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const errResponse = (status: number, message: string, reason?: string) =>
  new Response(JSON.stringify({ error: { message, details: reason ? [{ reason }] : [] } }), { status });
const judgeObj = { lines: [{ tag: "L1", text: "x", status: "ok", plot: "" }], stage: "in_progress", is_relevant: true, issue_is_new: false, feedback: "" };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetModelState();
  process.env.GEMINI_API_KEY = "secret-key";
  delete process.env.GEMINI_API_BASE;
  delete process.env.JUDGE_MODELS;
  delete process.env.VERIFIER_MODELS;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const ctrl = () => new AbortController();

describe("callModel", () => {
  it("sends the key in a header, never in the URL, and parses the response", async () => {
    fetchMock.mockResolvedValueOnce(okPayload(judgeObj));
    const res = await callModel("gemini-2.5-flash", body, ctrl().signal);
    expect(res.lines[0].tag).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("secret-key");
    expect(String(url)).toContain("/models/gemini-2.5-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
  });

  it("picks the thinking config by model family", async () => {
    fetchMock.mockImplementation(async () => okPayload(judgeObj));
    await callModel("gemini-2.0-flash", body, ctrl().signal);
    await callModel("gemini-2.5-flash", body, ctrl().signal);
    await callModel("gemini-flash-latest", body, ctrl().signal);
    const cfg = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).generationConfig.thinkingConfig);
    expect(cfg).toEqual([undefined, { thinkingBudget: 0 }, { thinkingLevel: "minimal" }]);
  });

  it("retries once without thinkingConfig when the model rejects it", async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(400, "Unable to submit request because thinking is not supported"))
      .mockResolvedValueOnce(okPayload(judgeObj));
    await callModel("gemini-2.5-flash", body, ctrl().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.thinkingConfig).toBeDefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).generationConfig.thinkingConfig).toBeUndefined();
    expect(models.noThinkingConfig.has("gemini-2.5-flash")).toBe(true);
  });

  it("ignores thought parts and tolerates fenced JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text: "```json\n" + JSON.stringify(judgeObj) + "\n```" }] } }] }), { status: 200 }),
    );
    const res = await callModel("gemini-2.5-flash", body, ctrl().signal);
    expect(res.is_relevant).toBe(true);
  });

  it("maps HTTP errors to kinds, and key problems to fatal", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(429, "quota"));
    await expect(callModel("m", body, ctrl().signal)).rejects.toMatchObject({ kind: "rate", status: 429, fatal: false });
    fetchMock.mockResolvedValueOnce(errResponse(503, "high demand"));
    await expect(callModel("m", body, ctrl().signal)).rejects.toMatchObject({ kind: "server" });
    fetchMock.mockResolvedValueOnce(errResponse(404, "no such model"));
    await expect(callModel("m", body, ctrl().signal)).rejects.toMatchObject({ kind: "unsupported", fatal: false });
    fetchMock.mockResolvedValueOnce(errResponse(400, "API key not valid. Please pass a valid API key.", "API_KEY_INVALID"));
    await expect(callModel("m", body, ctrl().signal)).rejects.toMatchObject({ fatal: true });
    fetchMock.mockResolvedValueOnce(errResponse(403, "nope"));
    await expect(callModel("m", body, ctrl().signal)).rejects.toMatchObject({ fatal: true, status: 403 });
  });

  it("reports empty and malformed responses as kind=empty", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await expect(callModel("m", body, ctrl().signal)).rejects.toMatchObject({ kind: "empty" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 }));
    await expect(callModel("m", body, ctrl().signal)).rejects.toMatchObject({ kind: "empty" });
  });

  it("an abort of our own controller throws AbortError, not a network error", async () => {
    const c = ctrl();
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(init.signal!.reason));
    }));
    const p = callModel("m", body, c.signal);
    c.abort("timeout");
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("a real fetch failure is a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(callModel("m", body, ctrl().signal)).rejects.toMatchObject({ kind: "network" });
  });
});

describe("callWithHedge", () => {
  it("a 429 cools the model down for 60 s; a 404 marks it dead", async () => {
    process.env.JUDGE_MODELS = "a,b,c";
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/a:")) return errResponse(429, "quota");
      if (url.includes("/b:")) return errResponse(404, "gone");
      return okPayload(judgeObj);
    });
    const out = await callWithHedge(body, ctrl().signal, { candidates: ["a", "b", "c"] });
    expect(out.model).toBe("c");
    expect((models.cooldown.get("a") ?? 0) - Date.now()).toBeGreaterThan(55_000);
    expect(models.dead.has("b")).toBe(true);
    expect(usableCandidates()).toEqual(["c"]);
  });

  it("5xx and network failures cool down for 5 s", async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes("/a:") ? errResponse(500, "x") : okPayload(judgeObj)));
    await callWithHedge(body, ctrl().signal, { candidates: ["a", "b"] });
    const left = (models.cooldown.get("a") ?? 0) - Date.now();
    expect(left).toBeGreaterThan(3000);
    expect(left).toBeLessThanOrEqual(5000);
  });

  it("starts the second model after hedgeMs and the first success wins (aborting the other)", async () => {
    vi.useFakeTimers();
    const aborted: string[] = [];
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url.includes("/slow:")) {
        return new Promise((_res, rej) => init.signal!.addEventListener("abort", () => { aborted.push("slow"); rej(init.signal!.reason); }));
      }
      return Promise.resolve(okPayload(judgeObj));
    });
    const p = callWithHedge(body, ctrl().signal, { candidates: ["slow", "fast"], hedgeMs: 8000 });
    await vi.advanceTimersByTimeAsync(7900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    const out = await p;
    expect(out.model).toBe("fast");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(aborted).toEqual(["slow"]);
  });

  it("a timeout is a failed attempt (moves to the next), not a network error surfaced as abort", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url.includes("/hang:")) return new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)));
      return Promise.resolve(okPayload(judgeObj));
    });
    const p = callWithHedge(body, ctrl().signal, { candidates: ["hang", "ok"], attemptMs: 1000, hedgeMs: 60_000 });
    await vi.advanceTimersByTimeAsync(1100);
    expect((await p).model).toBe("ok");
    expect((models.cooldown.get("hang") ?? 0)).toBeGreaterThan(Date.now());
  });

  it("when everything fails it rejects with the last error", async () => {
    fetchMock.mockImplementation(async () => errResponse(503, "overloaded"));
    await expect(callWithHedge(body, ctrl().signal, { candidates: ["a", "b"] })).rejects.toMatchObject({ kind: "server", message: "overloaded" });
  });

  it("a fatal error rejects immediately without trying other models", async () => {
    fetchMock.mockImplementation(async () => errResponse(403, "denied"));
    await expect(callWithHedge(body, ctrl().signal, { candidates: ["a", "b", "c"] })).rejects.toMatchObject({ fatal: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an outer abort rejects with AbortError", async () => {
    const c = ctrl();
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason))));
    const p = callWithHedge(body, c.signal, { candidates: ["a"] });
    c.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("models", () => {
  it("buildCandidates keeps -latest aliases and appends discovered flash models", () => {
    const list = buildCandidates(["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash-image", "gemini-2.0-flash", "gemini-pro"]);
    expect(list).toContain("gemini-flash-lite-latest");
    expect(list).toContain("gemini-3-flash-preview");
    expect(list).not.toContain("gemini-2.5-flash-image");
    expect(list).not.toContain("gemini-pro");
    expect(list.length).toBeLessThanOrEqual(8);
  });
  it("JUDGE_MODELS and VERIFIER_MODELS override the lists", () => {
    process.env.JUDGE_MODELS = "x,y";
    process.env.VERIFIER_MODELS = "v";
    expect(usableCandidates()).toEqual(["x", "y"]);
    expect(verifierCandidates()).toEqual(["v", "x", "y"]);
  });
  it("when all models cool down it still tries them", () => {
    process.env.JUDGE_MODELS = "x,y";
    models.cooldown.set("x", Date.now() + 60_000);
    models.cooldown.set("y", Date.now() + 60_000);
    expect(usableCandidates()).toEqual(["x", "y"]);
  });
});

describe("parsers", () => {
  it("parseJudge normalises tags, statuses and plot", () => {
    const r = parseJudge({ lines: [{ tag: "L12", text: "a", status: "weird", plot: "  " + "x".repeat(200) }, { tag: 2, status: "error" }], is_relevant: true });
    expect(r.lines[0]).toMatchObject({ tag: 12, status: "skip" });
    expect(r.lines[0].plot).toHaveLength(120);
    expect(r.is_correct).toBe(false);
    expect(r.stage).toBe("in_progress");
  });
  it("parseVerifier maps unknown verdicts to unclear", () => {
    expect(parseVerifier({ verdict: "maybe" }).verdict).toBe("unclear");
  });
  it("parseJsonLoose falls back to the outermost braces", () => {
    expect(parseJsonLoose('noise {"a":1} tail')).toEqual({ a: 1 });
    expect(() => parseJsonLoose("nothing")).toThrow();
  });
  it("ModelError carries its fields", () => {
    const e = new ModelError("m", { status: 5, fatal: true, kind: "k" });
    expect([e.status, e.fatal, e.kind]).toEqual([5, true, "k"]);
  });
});
