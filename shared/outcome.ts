import type { JudgeResult, SegmentIn, VetoVerdict } from "./types";

/** The wrong line the tutor talks about now: first one (top to bottom) with new or never-announced ink. */
export function pickError(r: JudgeResult, segments: SegmentIn[]): SegmentIn | null {
  if (!r.is_relevant) return null;
  for (const l of r.lines) {
    if (l.status !== "error") continue;
    const sg = segments.find((x) => x.tag === l.tag);
    if (sg && (sg.hasNew || !sg.announced)) return sg;
  }
  return null;
}

export function describeOutcome(
  res: JudgeResult,
  segments: SegmentIn[],
  vetoes: { tag: number; verdict: VetoVerdict }[],
): string {
  const sg = pickError(res, segments);
  if (sg && res.feedback) return "mistake spoken";
  if (vetoes.length)
    return `Verifier caught ${vetoes.length} false alarm${vetoes.length > 1 ? "s" : ""} · silent`;
  if (!res.is_relevant) return "ignored (not math)";
  const oks = res.lines.filter((l) => l.status === "ok").length;
  if (res.stage === "finished" && oks) return "finished · cheered";
  return `silent · ${oks} ok`;
}

export function judgeSummary(res: JudgeResult): string {
  const bad = res.lines.filter((l) => l.status === "error").length;
  const ok = res.lines.filter((l) => l.status === "ok").length;
  return `${res.lines.length} lines · ${ok} ok · ${bad} flagged`;
}
