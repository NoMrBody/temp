import type { ChatRequest, ChatResponse } from "../../shared/types";
import { callWithHedge, verifierThinking, type GeminiBody } from "../gemini/client";
import { verifierCandidates } from "../gemini/models";
import { CHAT_SCHEMA, buildChatPrompt } from "../prompts/chat";

export function parseChat(obj: Record<string, unknown>): ChatResponse {
  const message = String(obj.message ?? "").trim();
  const lines = (Array.isArray(obj.solution_lines) ? obj.solution_lines : [])
    .map((l) => String(l ?? "").trim())
    .filter(Boolean)
    .slice(0, 14)
    .map((l) => l.slice(0, 160));
  let intent: ChatResponse["intent"] = ["hint", "solution", "answer"].includes(String(obj.intent))
    ? (obj.intent as ChatResponse["intent"])
    : "answer";
  if (intent === "solution" && !lines.length) intent = "answer";
  return { intent, message, solution_lines: intent === "solution" ? lines : [] };
}

export async function runChat(
  req: ChatRequest,
  signal: AbortSignal,
): Promise<{ res: ChatResponse; model: string; ms: number }> {
  const contents: GeminiBody["contents"] = req.history.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.text }],
  }));
  const parts: unknown[] = [];
  if (req.pdf) parts.push({ inlineData: { mimeType: "application/pdf", data: req.pdf.data } });
  if (req.canvas) {
    parts.push({ inlineData: { mimeType: "image/png", data: req.canvas } });
    parts.push({ text: "(The picture above is the student's current notebook page.)" });
  }
  if (req.pdf) {
    const where = req.focusPage && req.pageCount ? ` The student is currently looking at page ${req.focusPage} of ${req.pageCount}.` : "";
    parts.push({
      text: `(The PDF above is the worksheet "${req.pdf.name}". Its pages are laid out on the student's canvas, one below the other, and the student writes on them.${where})`,
    });
  }
  parts.push({ text: req.message });
  contents.push({ role: "user", parts });

  const body: GeminiBody = {
    systemInstruction: { parts: [{ text: buildChatPrompt(req.persona) }] },
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: CHAT_SCHEMA,
    },
  };
  const t0 = Date.now();
  const { res, model } = await callWithHedge<ChatResponse>(body, signal, {
    candidates: verifierCandidates(),
    parse: parseChat,
    think: verifierThinking,
    attemptMs: 30000,
    hedgeMs: 12000,
  });
  return { res, model, ms: Date.now() - t0 };
}
