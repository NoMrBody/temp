import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildJudgePrompt, JUDGE_SCHEMA } from "../../server/prompts/judge";
import { buildVerifierPrompt, VERIFIER_SCHEMA } from "../../server/prompts/verifier";
import { PERSONAS } from "../../server/prompts/personas";
import { buildCoachPrompt } from "../../server/prompts/coach";

const snap = (f: string) => readFileSync(join(__dirname, "snapshots", f), "utf8").replace(/\n$/, "");

describe("prompts and schemas are byte-identical to Appendix B", () => {
  it("persona text", () => expect(PERSONAS.friendly.text).toBe(snap("persona-friendly.txt")));
  it("judge prompt", () => expect(buildJudgePrompt("friendly")).toBe(snap("judge-prompt.txt")));
  it("verifier prompt", () => expect(buildVerifierPrompt("friendly")).toBe(snap("verifier-prompt.txt")));
  it("judge schema", () => expect(JSON.parse(JSON.stringify(JUDGE_SCHEMA))).toEqual(JSON.parse(snap("judge-schema.json"))));
  it("verifier schema", () => expect(JSON.parse(JSON.stringify(VERIFIER_SCHEMA))).toEqual(JSON.parse(snap("verifier-schema.json"))));
  it("schema property order is preserved", () => {
    expect(Object.keys(JUDGE_SCHEMA.properties)).toEqual(["lines", "stage", "is_relevant", "issue_is_new", "feedback"]);
  });
  it("coach prompt follows the spec structure", () => {
    const p = buildCoachPrompt("friendly", "y = 2x", ["first", "second"]);
    expect(p.startsWith(PERSONAS.friendly.text + "\n\nThe student has NOT fixed this mistake yet. The line is: \"y = 2x\".")).toBe(true);
    expect(p).toContain("What you already told them, oldest first:\n- first\n- second\n");
    expect(p.endsWith("Never give the final answer or dictate what to write.")).toBe(true);
  });
});
