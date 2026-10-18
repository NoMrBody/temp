import { describe, expect, it } from "vitest";
import { parseChat } from "../../server/agents/chat";
import { buildChatPrompt } from "../../server/prompts/chat";
import { ChatRequestSchema } from "../../shared/schemas";
import { PERSONAS } from "../../server/prompts/personas";

describe("parseChat", () => {
  it("keeps solution lines only for the solution intent", () => {
    expect(parseChat({ intent: "hint", message: " try this ", solution_lines: ["x = 1"] })).toEqual({ intent: "hint", message: "try this", solution_lines: [] });
    expect(parseChat({ intent: "solution", message: "ok", solution_lines: ["2x = 8", "", "x = 4"] }).solution_lines).toEqual(["2x = 8", "x = 4"]);
  });
  it("a solution without lines degrades to an answer; unknown intents become answers", () => {
    expect(parseChat({ intent: "solution", message: "m", solution_lines: [] }).intent).toBe("answer");
    expect(parseChat({ intent: "dance", message: "m" }).intent).toBe("answer");
  });
  it("caps the number and length of lines", () => {
    const r = parseChat({ intent: "solution", message: "m", solution_lines: Array.from({ length: 30 }, () => "y".repeat(200)) });
    expect(r.solution_lines).toHaveLength(14);
    expect(r.solution_lines[0]).toHaveLength(160);
  });
});

describe("chat prompt", () => {
  const p = buildChatPrompt("friendly");
  it("defaults to a hint and only writes solutions on explicit request", () => {
    expect(p).toContain('"hint" (the DEFAULT');
    expect(p).toContain("ONLY when the student explicitly asks");
    expect(p).toContain("chat next to their math notebook");
  });
  it("asks for LaTeX lines without delimiters", () => {
    expect(p).toContain("as LaTeX");
    expect(p).toContain("WITHOUT $");
  });
  it("reuses the persona's personality but not its never-give-the-answer rules", () => {
    expect(p).toContain(PERSONAS.friendly.text.split("\n\nHOW TO CORRECT")[0]);
    expect(p).not.toContain("HOW TO CORRECT");
  });
});

describe("ChatRequestSchema", () => {
  const ok = { message: "help", history: [], persona: "friendly" };
  it("accepts minimal and full requests", () => {
    expect(ChatRequestSchema.safeParse(ok).success).toBe(true);
    expect(ChatRequestSchema.safeParse({ ...ok, pdf: { name: "a.pdf", data: "AAAA" }, canvas: "BBBB", history: [{ role: "user", text: "hi" }] }).success).toBe(true);
  });
  it("rejects empty or oversized messages, long history, bad roles and huge attachments", () => {
    expect(ChatRequestSchema.safeParse({ ...ok, message: "" }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...ok, message: "x".repeat(1501) }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...ok, history: Array.from({ length: 13 }, () => ({ role: "user", text: "a" })) }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...ok, history: [{ role: "system", text: "a" }] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...ok, pdf: { name: "a", data: "A".repeat(3_700_001) } }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...ok, persona: "x" }).success).toBe(false);
  });
});
