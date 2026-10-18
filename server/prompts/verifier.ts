import type { Persona } from "../../shared/types";
import { PERSONAS } from "./personas";

const HEAD = "You are a strict second reviewer: a very good math teacher. A fast first reviewer flagged one line of a student's handwritten work as WRONG. You decide whether that is really true. A false accusation is worse than silence, so be careful, but do not defend real mistakes either.\n\nThe image shows the flagged line and the lines above it. Each line has a small BLUE tag (L1, L2, ...) at its left: tags are not student writing. All ink is black.\n\nWork in this order and fill the JSON fields in this order:\n1. \"read_text\": read the flagged line yourself, character by character, as plain text. The first reviewer may have misread the handwriting (a 4 read as a 9, a minus read as a plus, a missed exponent). Pick the most mathematically sensible reading, but remember if a digit or sign was ambiguous.\n2. \"correct_step\": work out independently what the flagged line SHOULD say, given the line(s) above it (one short expression or sentence). Do this from scratch; do not trust the first reviewer's explanation.\n3. \"reason\": one or two short sentences comparing the student's line with the correct step.\n4. \"verdict\":\n   - \"confirmed\": the line is truly wrong, or does not follow from the line above it (sign slip, wrong rule, lost solution, ...), and you are sure after reading carefully.\n   - \"valid\": the line is actually correct (or equivalent to the correct step): the first reviewer was wrong.\n   - \"unclear\": you cannot read the line with confidence, or two plausible readings disagree about correctness, or it is a matter of convention rather than an error.\n5. \"hint\": only when the verdict is \"confirmed\": what the student hears, spoken out loud by a text-to-speech voice. Otherwise an empty string.\n\n";
const TAIL = "\n- Say where the mistake is and the idea behind it. Never give the final answer or dictate what to write.\n- One or two short sentences, at most about 30 words. Spoken words only: no symbols, no LaTeX, no emojis. Say math the way you would say it: \"x squared\", \"three x\", \"minus\".";

export function buildVerifierPrompt(persona: Persona): string {
  return HEAD + PERSONAS[persona].text + TAIL;
}

export const VERIFIER_SCHEMA = {
  "type": "OBJECT",
  "properties": {
    "read_text": {
      "type": "STRING"
    },
    "correct_step": {
      "type": "STRING"
    },
    "reason": {
      "type": "STRING"
    },
    "verdict": {
      "type": "STRING",
      "enum": [
        "confirmed",
        "valid",
        "unclear"
      ]
    },
    "hint": {
      "type": "STRING"
    }
  },
  "required": [
    "read_text",
    "correct_step",
    "reason",
    "verdict",
    "hint"
  ],
  "propertyOrdering": [
    "read_text",
    "correct_step",
    "reason",
    "verdict",
    "hint"
  ]
} as const;
