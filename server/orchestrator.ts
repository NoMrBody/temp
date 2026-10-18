import { SERVER_CONFIG, type ServerConfig } from "../shared/config";
import { describeOutcome, pickError } from "../shared/outcome";
import type {
  CheckEvent,
  CheckRequest,
  JudgeResult,
  LineStatus,
  VerifierResult,
  VetoVerdict,
} from "../shared/types";
import { runCoach } from "./agents/coach";
import { runJudge } from "./agents/judge";
import { runVerifier } from "./agents/verifier";
import { ModelError } from "./gemini/client";

export interface Deps {
  judge: (req: CheckRequest, signal: AbortSignal) => Promise<{ res: JudgeResult; model: string; ms: number }>;
  verifier: (
    req: CheckRequest,
    res: JudgeResult,
    tag: number,
    crop: string,
    signal: AbortSignal,
  ) => Promise<{ v: VerifierResult; model: string; ms: number }>;
  coach: (
    persona: CheckRequest["persona"],
    lineText: string,
    previousHints: string[],
    signal: AbortSignal,
  ) => Promise<{ hint: string; model: string; ms: number }>;
}

export const defaultDeps: Deps = { judge: runJudge, verifier: runVerifier, coach: runCoach };

function setLineStatus(res: JudgeResult, tag: number, status: LineStatus) {
  for (const l of res.lines) if (l.tag === tag) l.status = status;
  res.is_correct = !res.lines.some((l) => l.status === "error");
}

const isAbort = (e: unknown) => (e as Error | undefined)?.name === "AbortError";

export async function runCheck(
  req: CheckRequest,
  emit: (e: CheckEvent) => void,
  signal: AbortSignal,
  deps: Deps = defaultDeps,
  config: ServerConfig = SERVER_CONFIG as unknown as ServerConfig,
): Promise<void> {
  try {
    const j = await deps.judge(req, signal);
    const res = j.res;
    emit({ type: "judge", model: j.model, ms: j.ms, result: structuredClone(res) });

    const vetoes: { tag: number; verdict: VetoVerdict }[] = [];
    const addVetoedKeys: string[] = [];
    let unclear = false;

    if (config.VERIFIER_ENABLED && res.is_relevant) {
      const judgeTag = pickError(res, req.segments)?.tag ?? null;
      let tries = 0;
      for (;;) {
        const sg = pickError(res, req.segments);
        if (!sg) break;
        const dismiss = (status: LineStatus, verdict: VetoVerdict) => {
          setLineStatus(res, sg.tag, status);
          vetoes.push({ tag: sg.tag, verdict });
          if (sg.tag === judgeTag) res.feedback = "";
        };
        if (sg.vetoed) {
          dismiss("skip", "cached");
          continue;
        }
        if (tries >= config.VERIFIER_MAX_PER_CHECK) {
          if (sg.tag === judgeTag) res.feedback = "";
          setLineStatus(res, sg.tag, "skip");
          continue;
        }
        const crop = req.crops[String(sg.tag)];
        let v: VerifierResult | null = null;
        if (crop) {
          tries++;
          try {
            const out = await deps.verifier(req, res, sg.tag, crop, signal);
            v = out.v;
            emit({ type: "verifier", model: out.model, ms: out.ms, tag: sg.tag, result: out.v });
          } catch (err) {
            if (signal.aborted || isAbort(err)) throw err;
            emit({
              type: "verifier_failed",
              tag: sg.tag,
              ms: 0,
              message: (err as Error).message || "timeout",
            });
          }
        }
        if (!v) {
          if (config.VERIFIER_FAIL_OPEN) {
            if (sg.tag !== judgeTag) res.feedback = "";
            break;
          }
          dismiss("skip", "failed");
          continue;
        }
        if (v.verdict === "confirmed") {
          if (v.hint) res.feedback = v.hint;
          else if (sg.tag !== judgeTag) res.feedback = "";
          break;
        }
        if (v.verdict === "valid") {
          addVetoedKeys.push(sg.key);
          dismiss("ok", "valid");
          continue;
        }
        unclear = true;
        if (config.VERIFIER_VETO_ON_UNCLEAR) {
          addVetoedKeys.push(sg.key);
          dismiss("skip", "unclear");
          continue;
        }
        break;
      }
      if (unclear && res.stage === "finished") res.stage = "in_progress";
    }

    // Reminders (Section 10): reword the old hint for lines the Judge still flags.
    const reminders: { tag: number; hint: string }[] = [];
    if (res.is_relevant && req.reminders?.length) {
      const spoken = pickError(res, req.segments);
      const due = req.reminders.filter((r) => {
        const line = res.lines.find((l) => l.tag === r.tag);
        return line && line.status === "error" && !(spoken && spoken.key === r.key);
      });
      await Promise.all(
        due.map(async (r) => {
          const line = res.lines.find((l) => l.tag === r.tag)!;
          try {
            const c = await deps.coach(req.persona, line.text, r.previousHints, signal);
            if (!c.hint || c.hint.length > 240) return;
            reminders.push({ tag: r.tag, hint: c.hint });
            emit({ type: "coach", model: c.model, ms: c.ms, tag: r.tag, hint: c.hint });
          } catch (err) {
            if (signal.aborted || isAbort(err)) throw err;
          }
        }),
      );
      reminders.sort((a, b) => a.tag - b.tag);
    }

    emit({
      type: "final",
      result: res,
      vetoes,
      addVetoedKeys,
      reminders,
      outcome: describeOutcome(res, req.segments, vetoes),
    });
  } catch (err) {
    if (signal.aborted || isAbort(err)) return;
    const e = err as Partial<ModelError>;
    emit({
      type: "error",
      message: (err as Error).message || "Unknown error",
      fatal: e.fatal === true,
      kind: e.kind || "other",
      status: e.status || 0,
    });
  }
}
