import { SERVER_CONFIG } from "../../shared/config";
import type { CheckRequest, JudgeResult, VerifierResult } from "../../shared/types";
import { callWithHedge, parseVerifier, verifierThinking, type GeminiBody } from "../gemini/client";
import { verifierCandidates } from "../gemini/models";
import { VERIFIER_SCHEMA, buildVerifierPrompt } from "../prompts/verifier";

export function crop3Tags(req: CheckRequest, tag: number): number[] {
  const prior = req.segments.filter((x) => x.tag < tag).slice(-3);
  return [...prior.map((x) => x.tag), tag];
}

export function buildVerifierContext(req: CheckRequest, res: JudgeResult, tag: number): string {
  const tags = crop3Tags(req, tag);
  const textOf = (t: number) => {
    const l = res.lines.find((x) => x.tag === t);
    if (l && l.text) return l.text;
    const seg = req.segments.find((x) => x.tag === t);
    return (seg && seg.memoryText) || "?";
  };
  return [
    `The first reviewer flagged line L${tag} as wrong.`,
    `Its reading of the lines: ${tags.map((t) => `L${t}: ${textOf(t)}`).join(" | ")}`,
    res.feedback ? `Its explanation: "${res.feedback}"` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Throws on failure; an abort of the outer signal throws an AbortError. */
export async function runVerifier(
  req: CheckRequest,
  res: JudgeResult,
  tag: number,
  crop: string,
  outerSignal: AbortSignal,
): Promise<{ v: VerifierResult; model: string; ms: number }> {
  const t0 = Date.now();
  const body: GeminiBody = {
    systemInstruction: { parts: [{ text: buildVerifierPrompt(req.persona) }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: crop } },
          { text: buildVerifierContext(req, res, tag) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: VERIFIER_SCHEMA,
    },
  };
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outerSignal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort("timeout"), SERVER_CONFIG.VERIFIER_TIMEOUT_MS);
  try {
    const { res: v, model } = await callWithHedge<VerifierResult>(body, ctrl.signal, {
      candidates: verifierCandidates(),
      parse: parseVerifier,
      think: verifierThinking,
      attemptMs: SERVER_CONFIG.VERIFIER_TIMEOUT_MS,
      hedgeMs: 6000,
    });
    return { v, model, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", onAbort);
  }
}
