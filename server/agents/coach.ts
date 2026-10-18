import type { Persona } from "../../shared/types";
import { callWithHedge, thinkingFor, type GeminiBody } from "../gemini/client";
import { COACH_SCHEMA, buildCoachPrompt } from "../prompts/coach";

export async function runCoach(
  persona: Persona,
  lineText: string,
  previousHints: string[],
  signal: AbortSignal,
): Promise<{ hint: string; model: string; ms: number }> {
  const body: GeminiBody = {
    systemInstruction: { parts: [{ text: buildCoachPrompt(persona, lineText, previousHints) }] },
    contents: [{ role: "user", parts: [{ text: "Say it again, differently." }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 512,
      responseMimeType: "application/json",
      responseSchema: COACH_SCHEMA,
    },
  };
  const t0 = Date.now();
  const { res, model } = await callWithHedge<string>(body, signal, {
    parse: (o) => String(o.hint || "").trim(),
    think: thinkingFor,
  });
  return { hint: res, model, ms: Date.now() - t0 };
}
