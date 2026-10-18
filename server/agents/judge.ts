import type { CheckRequest, JudgeResult } from "../../shared/types";
import { callWithHedge, type GeminiBody } from "../gemini/client";
import { JUDGE_SCHEMA, buildJudgePrompt } from "../prompts/judge";

export function buildJudgeContext(req: CheckRequest): string {
  const { segments } = req;
  const tagList = (list: { tag: number }[]) => list.map((sg) => "L" + sg.tag).join(", ");
  const gray = segments.filter((sg) => !sg.hasNew);
  const known = gray.filter((sg) => sg.memoryText).map((sg) => `L${sg.tag}: ${sg.memoryText}`);
  const ctx = [
    `The canvas has ${segments.length} tagged line(s): ${tagList(segments)}.`,
    `Lines with NEW (black) ink: ${tagList(segments.filter((sg) => sg.hasNew))}. Return one entry for EVERY line (L1 to L${segments.length}).`,
  ];
  if (known.length) ctx.push(`Already-checked (gray) lines, as you read them before: ${known.join(" | ")}`);
  if (req.lastIssue) ctx.push(`Error you already reported and may still be unfixed: "${req.lastIssue}"`);
  else if (gray.length) ctx.push("You found no errors in the gray ink last time.");
  return ctx.join("\n");
}

export async function runJudge(
  req: CheckRequest,
  signal: AbortSignal,
): Promise<{ res: JudgeResult; model: string; ms: number }> {
  const body: GeminiBody = {
    systemInstruction: { parts: [{ text: buildJudgePrompt(req.persona) }] },
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/png", data: req.image } },
          { text: buildJudgeContext(req) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: JUDGE_SCHEMA,
    },
  };
  const t0 = Date.now();
  const { res, model } = await callWithHedge<JudgeResult>(body, signal);
  return { res, model, ms: Date.now() - t0 };
}
