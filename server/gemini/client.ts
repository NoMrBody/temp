import { SERVER_CONFIG } from "../../shared/config";
import type { JudgeLine, JudgeResult, Stage, VerifierResult } from "../../shared/types";
import { parseJsonLoose } from "./json";
import { apiBase, apiKey, models, usableCandidates } from "./models";

export type ThinkingConfig = { thinkingBudget: number } | { thinkingLevel: string } | null;

export class ModelError extends Error {
  status: number;
  fatal: boolean;
  kind: string;
  constructor(msg: string, o: { status?: number; fatal?: boolean; kind?: string } = {}) {
    super(msg);
    this.name = "ModelError";
    this.status = o.status ?? 0;
    this.fatal = o.fatal ?? false;
    this.kind = o.kind ?? "other";
  }
}

export function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

export interface GeminiBody {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string; parts: unknown[] }[];
  generationConfig: Record<string, unknown>;
}

export interface CallOpts<T> {
  candidates?: string[];
  parse?: (obj: Record<string, unknown>) => T;
  think?: (model: string) => ThinkingConfig;
  attemptMs?: number;
  hedgeMs?: number;
}

/* Turns a Google API error into a human-readable reason. fatal = a key/project problem. */
export async function describeApiError(res: Response): Promise<{ fatal: boolean; msg: string }> {
  let raw = "";
  let reason = "";
  try {
    const j = (await res.json()) as { error?: { message?: string; details?: { reason?: string }[] } };
    raw = j.error?.message || "";
    for (const d of j.error?.details || []) {
      if (d.reason) {
        reason = d.reason;
        break;
      }
    }
  } catch {
    /* no body */
  }
  const m = raw.toLowerCase();
  if (reason === "API_KEY_INVALID" || m.includes("api key not valid"))
    return { fatal: true, msg: "Google says this API key is invalid — re-copy it (no spaces/quotes) from aistudio.google.com/apikey" };
  if (m.includes("unregistered callers") || m.includes("missing an api key"))
    return { fatal: true, msg: "No API key was sent — check GEMINI_API_KEY in the code" };
  if (m.includes("expired")) return { fatal: true, msg: "This API key has expired — create a new one" };
  if (reason === "API_KEY_HTTP_REFERRER_BLOCKED" || m.includes("referer"))
    return { fatal: true, msg: "Key's website restrictions block this site — add this URL to the key's allowed websites" };
  if (reason === "API_KEY_SERVICE_BLOCKED")
    return { fatal: true, msg: "Key's API restrictions block the Gemini API — allow 'Generative Language API' for this key" };
  if (reason === "SERVICE_DISABLED" || m.includes("has not been used in project") || m.includes("is disabled"))
    return { fatal: true, msg: "Gemini API is not enabled for this key's project — easiest fix: make a key in aistudio.google.com/apikey" };
  if (m.includes("location is not supported"))
    return { fatal: true, msg: "Google says the Gemini API isn't available from your location" };
  if (res.status === 401 || res.status === 403)
    return { fatal: true, msg: `Google rejected the request (${res.status}): ${raw || "no details"}` };
  return { fatal: false, msg: raw || `HTTP ${res.status}` };
}

export function thinkingFor(model: string): ThinkingConfig {
  if (models.noThinkingConfig.has(model)) return null;
  if (/gemini-2\.0/.test(model)) return null;
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  return { thinkingLevel: SERVER_CONFIG.THINKING_LEVEL };
}

export function verifierThinking(model: string): ThinkingConfig {
  if (models.noThinkingConfig.has(model)) return null;
  if (/gemini-2\.0/.test(model)) return null;
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: SERVER_CONFIG.VERIFIER_BUDGET };
  return { thinkingLevel: SERVER_CONFIG.VERIFIER_THINKING_LEVEL };
}

export function parseJudge(obj: Record<string, unknown>): JudgeResult {
  const rawLines = Array.isArray(obj.lines) ? (obj.lines as Record<string, unknown>[]) : [];
  const lines: JudgeLine[] = rawLines.map((l) => ({
    tag: parseInt(String(l && l.tag).replace(/\D/g, ""), 10),
    text: String((l && l.text) || ""),
    status: l && ["ok", "error", "skip"].includes(String(l.status)) ? (l.status as JudgeLine["status"]) : "skip",
    plot: String((l && l.plot) || "").trim().slice(0, 120),
  }));
  return {
    lines,
    stage: String(obj.stage || (obj.is_relevant ? "in_progress" : "blank")) as Stage,
    is_relevant: obj.is_relevant === true,
    is_correct: !lines.some((l) => l.status === "error"),
    issue_is_new: obj.issue_is_new !== false,
    feedback: String(obj.feedback || "").trim(),
  };
}

export function parseVerifier(obj: Record<string, unknown>): VerifierResult {
  return {
    read_text: String(obj.read_text || ""),
    correct_step: String(obj.correct_step || ""),
    reason: String(obj.reason || ""),
    verdict: ["confirmed", "valid", "unclear"].includes(String(obj.verdict))
      ? (obj.verdict as VerifierResult["verdict"])
      : "unclear",
    hint: String(obj.hint || "").trim(),
  };
}

export function noteFailure(model: string, err: ModelError): void {
  if (err.kind === "unsupported") models.dead.add(model);
  else if (err.kind === "rate") models.cooldown.set(model, Date.now() + 60000);
  else if (err.kind === "server" || err.kind === "network") models.cooldown.set(model, Date.now() + 5000);
}

export async function callModel<T = JudgeResult>(
  model: string,
  body: GeminiBody,
  signal: AbortSignal,
  opts: CallOpts<T> = {},
): Promise<T> {
  const url = `${apiBase()}/models/${encodeURIComponent(model)}:generateContent`;
  const thinking = opts.think ? opts.think(model) : thinkingFor(model);
  const payload = thinking
    ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: thinking } }
    : body;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey() },
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    // fetch rejects with the abort *reason* (e.g. "timeout"), not always an AbortError.
    if (signal.aborted) throw abortError();
    throw new ModelError("Network error (check your connection)", { kind: "network" });
  }
  if (!res.ok) {
    if (thinking && res.status === 400) {
      const peek = await res.clone().text().catch(() => "");
      if (/thinking/i.test(peek)) {
        models.noThinkingConfig.add(model);
        return callModel(model, body, signal, opts);
      }
    }
    const info = await describeApiError(res);
    throw new ModelError(info.msg, {
      status: res.status,
      fatal: info.fatal,
      kind:
        res.status === 429
          ? "rate"
          : res.status >= 500
            ? "server"
            : res.status === 404 || res.status === 400 || res.status === 403
              ? "unsupported"
              : "other",
    });
  }
  let data: {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  try {
    data = await res.json();
  } catch {
    if (signal.aborted) throw abortError();
    throw new ModelError("Bad JSON from model", { kind: "empty" });
  }
  const cand = data.candidates && data.candidates[0];
  if (!cand) throw new ModelError(`No candidate (${data.promptFeedback?.blockReason || "empty"})`, { kind: "empty" });
  const text = (cand.content?.parts || [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");
  if (!text) throw new ModelError(`Empty response (${cand.finishReason || "?"})`, { kind: "empty" });
  let obj: unknown;
  try {
    obj = parseJsonLoose(text);
  } catch {
    throw new ModelError("Bad JSON from model", { kind: "empty" });
  }
  if (!obj || typeof obj !== "object") throw new ModelError("Bad JSON from model", { kind: "empty" });
  const parse = (opts.parse ?? parseJudge) as (o: Record<string, unknown>) => T;
  return parse(obj as Record<string, unknown>);
}

/* Starts the first candidate; if no answer after hedgeMs starts the next in parallel. First success wins. */
export function callWithHedge<T = JudgeResult>(
  body: GeminiBody,
  outerSignal: AbortSignal,
  opts: CallOpts<T> = {},
): Promise<{ res: T; model: string }> {
  const cands = opts.candidates || usableCandidates();
  return new Promise((resolve, reject) => {
    let idx = 0;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
    const active = new Set<AbortController>();
    let lastErr: Error | null = null;

    const finish = <V,>(fn: (v: V) => void, val: V) => {
      if (settled) return;
      settled = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      for (const c of active) c.abort();
      active.clear();
      outerSignal.removeEventListener("abort", onOuterAbort);
      fn(val);
    };
    const onOuterAbort = () => finish(reject, abortError());
    if (outerSignal.aborted) return onOuterAbort();
    outerSignal.addEventListener("abort", onOuterAbort);

    const launch = () => {
      if (settled) return;
      if (idx >= cands.length) {
        if (active.size === 0) finish(reject, lastErr || new ModelError("No models available"));
        return;
      }
      const model = cands[idx++];
      const ctrl = new AbortController();
      active.add(ctrl);
      const timeout = setTimeout(() => ctrl.abort("timeout"), opts.attemptMs || SERVER_CONFIG.ATTEMPT_TIMEOUT_MS);
      if (hedgeTimer) clearTimeout(hedgeTimer);
      hedgeTimer = setTimeout(launch, opts.hedgeMs || SERVER_CONFIG.HEDGE_MS);

      callModel<T>(model, body, ctrl.signal, opts)
        .then((res) => {
          clearTimeout(timeout);
          active.delete(ctrl);
          models.lastUsed = model;
          finish(resolve, { res, model });
        })
        .catch((err: ModelError) => {
          clearTimeout(timeout);
          active.delete(ctrl);
          if (settled) return;
          if (err.name === "AbortError") {
            if (ctrl.signal.reason === "timeout") {
              lastErr = new ModelError("Timed out", { kind: "network" });
              noteFailure(model, lastErr as ModelError);
              launch();
            }
            return;
          }
          lastErr = err;
          noteFailure(model, err);
          if (err.fatal) return finish(reject, err);
          launch();
        });
    };
    launch();
  });
}
