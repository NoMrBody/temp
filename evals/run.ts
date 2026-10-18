/* Offline eval runner: replays labeled `iterraai-trace.json` checks through the orchestrator with the REAL key.
 *   npm run eval -- trace1.json [trace2.json ...] [--max-false 0.05]
 * Needs GEMINI_API_KEY in the environment. Not run by `npm test`. */
import { readFileSync } from "node:fs";
import type { CheckEvent, CheckRequest } from "../shared/types";
import { runCheck } from "../server/orchestrator";

interface TraceCheck {
  id: number;
  label: "" | "right" | "false" | "missed";
  outcome: string;
  request: Omit<CheckRequest, "image" | "crops">;
  image: string;
  crops: Record<string, string>;
}

const args = process.argv.slice(2);
const mf = args.indexOf("--max-false");
const maxFalse = mf >= 0 ? Number(args.splice(mf, 2)[1]) : 0.05;
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: npm run eval -- <trace.json...> [--max-false 0.05]");
  process.exit(2);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(2);
}

const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);
const checks: TraceCheck[] = files.flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as { checks: TraceCheck[] }).checks);
const labeled = checks.filter((c) => c.label);

let falseAccusations = 0, withoutMistake = 0, missed = 0, withMistake = 0, vetoOnFalse = 0, vetoOnFalseTotal = 0, wrongVeto = 0;
const lat: Record<string, number[]> = { judge: [], verifier: [], coach: [] };
const confusion = new Map<string, number>();

for (const c of labeled) {
  const req: CheckRequest = { ...c.request, image: c.image, crops: c.crops };
  const events: CheckEvent[] = [];
  await runCheck(req, (e) => events.push(e), new AbortController().signal);
  const fin = events.find((e) => e.type === "final");
  for (const e of events) if (e.type === "judge" || e.type === "verifier" || e.type === "coach") lat[e.type].push(e.ms);
  const spoke = !!fin && fin.type === "final" && fin.outcome === "mistake spoken";
  const vetoes = fin && fin.type === "final" ? fin.vetoes.length : 0;
  confusion.set(`${c.label} → ${fin && fin.type === "final" ? fin.outcome : "error"}`, (confusion.get(`${c.label} → ${fin && fin.type === "final" ? fin.outcome : "error"}`) ?? 0) + 1);
  if (c.label === "false" || c.label === "right") {
    withoutMistake++;
    if (spoke) falseAccusations++;
  }
  if (c.label === "missed") {
    withMistake++;
    if (!spoke) missed++;
  }
  if (c.label === "false") { vetoOnFalseTotal++; if (vetoes) vetoOnFalse++; }
  if (c.label === "missed" && vetoes) wrongVeto += vetoes;
}

const rate = (a: number, b: number) => (b ? a / b : 0);
const falseRate = rate(falseAccusations, withoutMistake);
console.log(`checks labeled: ${labeled.length}`);
console.log(`false-accusation rate: ${(falseRate * 100).toFixed(1)}% (${falseAccusations}/${withoutMistake})`);
console.log(`missed-mistake rate:   ${(rate(missed, withMistake) * 100).toFixed(1)}% (${missed}/${withMistake})`);
console.log(`Verifier veto precision (vetoes on 'false alarm' checks): ${(rate(vetoOnFalse, vetoOnFalseTotal) * 100).toFixed(1)}% (${vetoOnFalse}/${vetoOnFalseTotal})`);
console.log(`Verifier wrong vetoes (vetoes on 'missed' checks): ${wrongVeto}`);
for (const k of Object.keys(lat)) console.log(`latency ${k}: p50 ${pct(lat[k], 0.5)}ms · p95 ${pct(lat[k], 0.95)}ms (n=${lat[k].length})`);
console.log("confusion (label → outcome):");
for (const [k, v] of confusion) console.log(`  ${k}: ${v}`);
if (falseRate > maxFalse) {
  console.error(`false-accusation rate ${falseRate} exceeds --max-false ${maxFalse}`);
  process.exit(1);
}
