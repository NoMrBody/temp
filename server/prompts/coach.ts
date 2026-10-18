import type { Persona } from "../../shared/types";
import { PERSONAS } from "./personas";

export function buildCoachPrompt(persona: Persona, lineText: string, previousHints: string[]): string {
  return `${PERSONAS[persona].text}

The student has NOT fixed this mistake yet. The line is: "${lineText}".
What you already told them, oldest first:
${previousHints.map((h) => `- ${h}`).join("\n")}

Say it again in a DIFFERENT way: new wording, a different angle or a different tiny example, a bit more direct but never mean. Do not repeat phrases you already used. One or two short sentences, at most about 30 words. Spoken words only: no symbols, no LaTeX, no emojis. Never give the final answer or dictate what to write.`;
}

export const COACH_SCHEMA = {
  type: "OBJECT",
  properties: { hint: { type: "STRING" } },
  required: ["hint"],
  propertyOrdering: ["hint"],
} as const;
