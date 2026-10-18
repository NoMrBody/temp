import { describe, expect, it } from "vitest";
import { SERVER_CONFIG, type ServerConfig } from "../../shared/config";
import type { CheckEvent, CheckRequest, JudgeResult, VerifierResult } from "../../shared/types";
import { runCheck, type Deps } from "../../server/orchestrator";

type L = [number, "ok" | "error" | "skip"];
const judgeRes = (lines: L[], over: Partial<JudgeResult> = {}): JudgeResult => ({
  lines: lines.map(([tag, status]) => ({ tag, text: `t${tag}`, status, plot: "" })),
  stage: "in_progress",
  is_relevant: true,
  is_correct: !lines.some(([, s]) => s === "error"),
  issue_is_new: true,
  feedback: "judge hint",
  ...over,
});
const req = (n: number, over: Partial<CheckRequest> = {}, segOver: Record<number, object> = {}): CheckRequest => ({
  image: "img",
  segments: Array.from({ length: n }, (_, i) => ({
    tag: i + 1,
    key: String(i + 1),
    hasNew: true,
    announced: false,
    vetoed: false,
    ...(segOver[i + 1] ?? {}),
  })),
  crops: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), "crop"])),
  lastIssue: "",
  persona: "friendly",
  ...over,
});
const ver = (verdict: VerifierResult["verdict"], hint = ""): VerifierResult => ({
  read_text: "r",
  correct_step: "c",
  reason: "why",
  verdict,
  hint,
});

function harness(j: JudgeResult, verdicts: (VerifierResult | "fail")[] | (() => VerifierResult | "fail"), coach = "say it differently") {
  const calls = { verifier: [] as number[], coach: 0 };
  let i = 0;
  const deps: Deps = {
    judge: async () => ({ res: structuredClone(j), model: "m", ms: 1 }),
    verifier: async (_r, _res, tag) => {
      calls.verifier.push(tag);
      const v = typeof verdicts === "function" ? verdicts() : verdicts[Math.min(i++, verdicts.length - 1)];
      if (v === "fail") throw new Error("boom");
      return { v, model: "vm", ms: 2 };
    },
    coach: async () => {
      calls.coach++;
      return { hint: coach, model: "cm", ms: 3 };
    },
  };
  return { deps, calls };
}
async function run(r: CheckRequest, deps: Deps, config?: Partial<ServerConfig>) {
  const events: CheckEvent[] = [];
  await runCheck(r, (e) => events.push(e), new AbortController().signal, deps, {
    ...(SERVER_CONFIG as unknown as ServerConfig),
    ...config,
  });
  const final = events.find((e) => e.type === "final") as Extract<CheckEvent, { type: "final" }>;
  return { events, final };
}

describe("orchestrator", () => {
  it("makes no Verifier call when the Judge flags nothing", async () => {
    const h = harness(judgeRes([[1, "ok"], [2, "ok"]], { feedback: "" }), [ver("confirmed")]);
    const { final, events } = await run(req(2), h.deps);
    expect(h.calls.verifier).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(["judge", "final"]);
    expect(final.outcome).toBe("silent · 2 ok");
  });

  it("confirmed: keeps the flag and uses the Verifier's hint", async () => {
    const h = harness(judgeRes([[1, "ok"], [2, "error"]]), [ver("confirmed", "verifier hint")]);
    const { final, events } = await run(req(2), h.deps);
    expect(final.result.feedback).toBe("verifier hint");
    expect(final.result.lines[1].status).toBe("error");
    expect(final.outcome).toBe("mistake spoken");
    expect(events.filter((e) => e.type === "verifier")).toHaveLength(1);
  });

  it("confirmed without a hint on the Judge's own line keeps the Judge feedback", async () => {
    const h = harness(judgeRes([[1, "error"]]), [ver("confirmed", "")]);
    const { final } = await run(req(1), h.deps);
    expect(final.result.feedback).toBe("judge hint");
  });

  it("valid: line becomes ok, key is vetoed, the Judge's feedback is cleared", async () => {
    const h = harness(judgeRes([[1, "ok"], [2, "error"]]), [ver("valid")]);
    const { final } = await run(req(2), h.deps);
    expect(final.result.lines[1].status).toBe("ok");
    expect(final.result.is_correct).toBe(true);
    expect(final.addVetoedKeys).toEqual(["2"]);
    expect(final.result.feedback).toBe("");
    expect(final.vetoes).toEqual([{ tag: 2, verdict: "valid" }]);
    expect(final.outcome).toContain("Verifier caught");
  });

  it("unclear: line is skipped and vetoed; finished becomes in_progress", async () => {
    const h = harness(judgeRes([[1, "error"]], { stage: "finished" }), [ver("unclear")]);
    const { final } = await run(req(1), h.deps);
    expect(final.result.lines[0].status).toBe("skip");
    expect(final.addVetoedKeys).toEqual(["1"]);
    expect(final.result.stage).toBe("in_progress");
    expect(final.result.feedback).toBe("");
  });

  it("Verifier failure with fail-open keeps the Judge's feedback", async () => {
    const h = harness(judgeRes([[1, "error"]]), ["fail"]);
    const { final, events } = await run(req(1), h.deps);
    expect(final.result.feedback).toBe("judge hint");
    expect(final.result.lines[0].status).toBe("error");
    expect(events.some((e) => e.type === "verifier_failed")).toBe(true);
  });

  it("Verifier failure without fail-open dismisses the line (not remembered)", async () => {
    const h = harness(judgeRes([[1, "error"]]), ["fail"]);
    const { final } = await run(req(1), h.deps, { VERIFIER_FAIL_OPEN: false });
    expect(final.result.lines[0].status).toBe("skip");
    expect(final.addVetoedKeys).toEqual([]);
    expect(final.result.feedback).toBe("");
    expect(final.vetoes).toEqual([{ tag: 1, verdict: "failed" }]);
  });

  it("a missing crop is treated as Verifier unavailable (fail-open)", async () => {
    const h = harness(judgeRes([[1, "error"]]), [ver("valid")]);
    const { final } = await run(req(1, { crops: {} }), h.deps);
    expect(h.calls.verifier).toEqual([]);
    expect(final.result.feedback).toBe("judge hint");
  });

  it("cached veto: no Verifier call", async () => {
    const h = harness(judgeRes([[1, "error"]]), [ver("confirmed", "x")]);
    const { final } = await run(req(1, {}, { 1: { vetoed: true } }), h.deps);
    expect(h.calls.verifier).toEqual([]);
    expect(final.vetoes).toEqual([{ tag: 1, verdict: "cached" }]);
    expect(final.result.lines[0].status).toBe("skip");
  });

  it("budget: three flagged lines → exactly 2 Verifier calls; the third stays quiet", async () => {
    const h = harness(judgeRes([[1, "error"], [2, "error"], [3, "error"]]), () => ver("valid"));
    const { final } = await run(req(3), h.deps);
    expect(h.calls.verifier).toEqual([1, 2]);
    expect(final.result.lines.map((l) => l.status)).toEqual(["ok", "ok", "skip"]);
    expect(final.result.feedback).toBe("");
  });

  it("never turns a non-error line into an error and never exceeds the budget", async () => {
    for (const verdict of ["confirmed", "valid", "unclear"] as const) {
      const lines: L[] = [[1, "ok"], [2, "skip"], [3, "error"], [4, "error"], [5, "error"]];
      const h = harness(judgeRes(lines), () => ver(verdict, "h"));
      const { final } = await run(req(5), h.deps);
      expect(h.calls.verifier.length).toBeLessThanOrEqual(2);
      expect(final.result.lines[0].status).toBe("ok");
      expect(final.result.lines[1].status).toBe("skip");
    }
  });

  it("empty feedback for an error line unless a Verifier confirmed", async () => {
    const h = harness(judgeRes([[1, "ok"], [2, "error"], [3, "error"]]), [ver("valid"), ver("confirmed", "")]);
    const { final } = await run(req(3), h.deps);
    // line 2 was the Judge's line (dismissed → cleared), line 3 confirmed without hint → stays cleared
    expect(final.result.feedback).toBe("");
  });

  it("does not speak about gray, already announced errors", async () => {
    const h = harness(judgeRes([[1, "error"]]), [ver("confirmed", "x")]);
    const { events } = await run(req(1, {}, { 1: { hasNew: false, announced: true } }), h.deps);
    expect(h.calls.verifier).toEqual([]);
    expect(events.at(-1)!.type).toBe("final");
  });

  it("reminders: coach rewords lines the Judge still flags, nothing for fixed lines", async () => {
    const h = harness(judgeRes([[1, "error"], [2, "ok"]], { feedback: "" }), [ver("confirmed")]);
    const r = req(2, { reminders: [{ tag: 1, key: "1", previousHints: ["old"] }, { tag: 2, key: "2", previousHints: ["old2"] }] }, {
      1: { hasNew: false, announced: true },
      2: { hasNew: false, announced: true },
    });
    const { final, events } = await run(r, h.deps);
    expect(final.reminders).toEqual([{ tag: 1, hint: "say it differently" }]);
    expect(h.calls.coach).toBe(1);
    expect(h.calls.verifier).toEqual([]);
    expect(events.some((e) => e.type === "coach")).toBe(true);
  });

  it("reminders: an over-long coach hint is dropped", async () => {
    const h = harness(judgeRes([[1, "error"]], { feedback: "" }), [ver("confirmed")], "x".repeat(300));
    const r = req(1, { reminders: [{ tag: 1, key: "1", previousHints: ["old"] }] }, { 1: { hasNew: false, announced: true } });
    const { final } = await run(r, h.deps);
    expect(final.reminders).toEqual([]);
  });

  it("emits exactly one error event when the Judge fails, and nothing after", async () => {
    const deps: Deps = {
      judge: async () => {
        throw Object.assign(new Error("bad key"), { fatal: true, kind: "other", status: 403 });
      },
      verifier: async () => ({ v: ver("valid"), model: "m", ms: 1 }),
      coach: async () => ({ hint: "x", model: "m", ms: 1 }),
    };
    const { events } = await run(req(1), deps);
    expect(events).toEqual([{ type: "error", message: "bad key", fatal: true, kind: "other", status: 403 }]);
  });

  it("emits nothing when the check is aborted", async () => {
    const ctrl = new AbortController();
    const events: CheckEvent[] = [];
    const deps: Deps = {
      judge: async () => {
        ctrl.abort();
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      },
      verifier: async () => ({ v: ver("valid"), model: "m", ms: 1 }),
      coach: async () => ({ hint: "x", model: "m", ms: 1 }),
    };
    await runCheck(req(1), (e) => events.push(e), ctrl.signal, deps);
    expect(events).toEqual([]);
  });
});
