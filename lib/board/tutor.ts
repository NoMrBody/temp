import { CLIENT_CONFIG } from "../../shared/config";
import { judgeSummary, pickError } from "../../shared/outcome";
import type { CheckEvent, CheckRequest, JudgeResult, ReminderIn, SegmentIn } from "../../shared/types";
import { exportImage } from "./export";
import { boxesOverlap } from "./geometry";
import { compileExpr } from "./graph/expr";
import { analyzeInk, inkMetrics } from "./ink";
import { HttpError, streamCheck } from "./stream";
import { store } from "./state";
import type { Ctx, Job, Segment, TraceRecord, TutorApi } from "./types";

export function createTutorApi(ctx: Ctx): TutorApi {
  const { state, tutor, timers } = ctx;
  const sig = { signal: ctx.signal };
  const isManual = () => tutor.mode === "manual";
  let statusClick: (() => void) | null = null;

  function setStatus(kind: "idle" | "busy" | "err", text?: string, onClick?: () => void) {
    const el = ctx.$("status");
    el.className = "status " + kind;
    ctx.$("statusText").textContent = text ?? (kind === "busy" ? "Analyzing…" : "Ready");
    statusClick = onClick ?? null;
  }
  ctx.$("status").addEventListener("click", () => statusClick && statusClick(), sig);

  function refreshCheckBtn() {
    const b = ctx.$("checkBtn");
    const busy = !!tutor.inflight;
    b.classList.toggle("busy", busy);
    ctx.$("checkLabel").textContent = busy && isManual() ? "Checking…" : "Check";
    (b as HTMLButtonElement).disabled = busy && isManual();
  }

  function openAccessModal() {
    ctx.$("accessModal").classList.add("open");
    (ctx.$("accessInput") as HTMLInputElement).value = tutor.accessCode;
    setTimeout(() => (ctx.$("accessInput") as HTMLInputElement).focus(), 0);
  }

  function cancelInflight() {
    tutor.pending = false;
    if (tutor.inflight) {
      tutor.inflight.ctrl.abort();
      tutor.inflight = null;
    }
    refreshCheckBtn();
  }

  function onStrokeStart(tool: "pen" | "eraser", startY: number) {
    clearTimeout(timers.check);
    clearTimeout(timers.nudge);
    ctx.$("card").classList.add("dim");
    if (tool === "pen") {
      const m = inkMetrics(state);
      if (!isManual() && m.hasUnchecked && isFinite(m.bottom) && startY > m.bottom + CLIENT_CONFIG.NEW_LINE_FACTOR * m.lineH) {
        void runCheck(true);
      }
    }
  }

  function onStrokeEnd() {
    tutor.lastStrokeEnd = Date.now();
    tutor.retries = 0;
    clearTimeout(timers.retry);
    ctx.$("card").classList.remove("dim");
    clearTimeout(timers.check);
    if (!isManual()) timers.check = setTimeout(() => void runCheck(), CLIENT_CONFIG.PAUSE_MS);
  }

  function resetSession() {
    cancelInflight();
    clearTimeout(timers.check);
    clearTimeout(timers.nudge);
    clearTimeout(timers.retry);
    tutor.captionSeq++;
    ctx.voice.stop();
    ctx.voice.hideCard();
    tutor.lastCheckedVersion = state.version;
    state.checkedIds = new Set();
    state.lineMemory.clear();
    tutor.announced.clear();
    tutor.vetoed.clear();
    tutor.openIssues.clear();
    tutor.lastIssue = "";
    tutor.issueIds = null;
    ctx.marks.removeMarks(() => true);
    ctx.glow.stop();
    tutor.acked = false;
    tutor.issueDismissed = false;
    setStatus("idle");
  }

  function setMode(m: "auto" | "manual") {
    tutor.mode = m;
    store.set("iterraai.mode", m);
    ctx.$("modeAuto").classList.toggle("active", m === "auto");
    ctx.$("modeManual").classList.toggle("active", m === "manual");
    (ctx.$("checkBtn") as HTMLElement).hidden = m === "auto";
    ctx.$("hintText").textContent =
      m === "auto"
        ? "A green tick means a line checks out. If something's off, he'll light it up and tell you. Press M to mute."
        : "Write your math, then press Check (or Enter). A green tick means a line checks out; if something's off, he'll light it up and tell you.";
    clearTimeout(timers.check);
    if (m === "auto" && state.version !== tutor.lastCheckedVersion && state.strokes.length && !state.current) {
      timers.check = setTimeout(() => void runCheck(), CLIENT_CONFIG.PAUSE_MS);
    }
    refreshCheckBtn();
  }

  function manualCheck() {
    if (!state.strokes.some((s) => s.tool === "pen")) {
      setStatus("idle", "Write something first");
      return;
    }
    if (state.version === tutor.lastCheckedVersion && !tutor.inflight) {
      setStatus("idle", "Nothing new to check");
      return;
    }
    void runCheck(true);
  }

  /* ---- marks (ticks / plot buttons) ---- */
  function applyMarks(r: JudgeResult, version: number, segments: Segment[], captured: Set<number>) {
    if (state.destructiveVersion > version) return;
    if (!r.is_relevant) return;
    const segOf = (tag: number) => segments.find((sg) => sg.tag === tag);
    for (const l of r.lines) {
      const sg = segOf(l.tag);
      if (!sg) continue;
      if (l.status === "ok") {
        if (sg.hasNew && !ctx.marks.touchedSince(sg, captured)) ctx.marks.addTick(sg);
      } else if (l.status === "error") {
        ctx.marks.removeMarks((m) => boxesOverlap(m.box, sg.box));
      }
      if (
        l.plot &&
        l.status !== "error" &&
        !ctx.marks.touchedSince(sg, captured) &&
        !ctx.marks.marks.some((m) => m.kind === "plot" && boxesOverlap(m.box, sg.box))
      ) {
        try {
          compileExpr(l.plot);
          ctx.marks.addPlotButton(sg, l.plot, l.text);
        } catch {
          /* not plottable: no button */
        }
      }
    }
  }

  /* ---- reminders (Section 10) ---- */
  function entryDue(e: { lastSpokenAt: number; lastAttemptAt?: number; times: number }, now: number) {
    return now - Math.max(e.lastSpokenAt, e.lastAttemptAt ?? 0) >= CLIENT_CONFIG.REMIND_MIN_MS && e.times < CLIENT_CONFIG.REMIND_MAX;
  }

  function collectReminders(segments: Segment[]): ReminderIn[] {
    const alive = new Map(segments.map((sg) => [sg.key, sg]));
    for (const key of [...tutor.openIssues.keys()]) if (!alive.has(key)) tutor.openIssues.delete(key);
    if (state.activePointer !== null) return [];
    const now = Date.now();
    const out: ReminderIn[] = [];
    for (const [key, e] of tutor.openIssues) {
      const sg = alive.get(key);
      if (!sg || !entryDue(e, now)) continue;
      e.lastAttemptAt = now;
      out.push({ tag: sg.tag, key, previousHints: [...e.hints] });
    }
    return out;
  }

  /* ---- the check ---- */
  async function runCheck(force = false, remind = false): Promise<void> {
    if (!force && state.activePointer !== null) return;
    const version = state.version;
    if (!remind && version === tutor.lastCheckedVersion) return;
    if (tutor.fatal) return;
    if (tutor.inflight) {
      tutor.pending = true;
      refreshCheckBtn();
      return;
    }
    tutor.pending = false;

    const an = analyzeInk(ctx);
    const exp = exportImage(ctx, {}, an);
    if (!exp) {
      tutor.lastCheckedVersion = version;
      tutor.lastIssue = "";
      tutor.issueIds = null;
      tutor.openIssues.clear();
      ctx.voice.hideCard();
      return;
    }
    const segments = exp.segments;
    if (!exp.hasNew && !remind) {
      tutor.lastCheckedVersion = version;
      if (tutor.issueIds) {
        const alive = new Set(segments.flatMap((sg) => sg.strokes.map((s) => s.id)));
        if (![...tutor.issueIds].some((id) => alive.has(id))) {
          tutor.lastIssue = "";
          tutor.issueIds = null;
          if (ctx.$("card").dataset.kind === "bad") ctx.voice.hideCard();
        }
      }
      return;
    }

    const capturedIdSet = new Set(state.strokes.map((s) => s.id));
    const capturedIds = [...capturedIdSet];
    const segsIn: SegmentIn[] = segments.map((sg) => {
      const o: SegmentIn = {
        tag: sg.tag,
        key: sg.key,
        hasNew: sg.hasNew,
        announced: tutor.announced.has(sg.key),
        vetoed: tutor.vetoed.has(sg.key),
      };
      const mem = state.lineMemory.get(sg.key);
      if (!sg.hasNew && mem) o.memoryText = mem;
      return o;
    });
    const crops: Record<string, string> = {};
    const candidates = segsIn.filter((s) => (s.hasNew || !s.announced) && !s.vetoed).slice(0, 8);
    for (const c of candidates) {
      const tags = [...segments.filter((x) => x.tag < c.tag).slice(-3).map((x) => x.tag), c.tag];
      const cx = exportImage(ctx, { onlyTags: tags, allBlack: true }, an);
      if (cx) crops[String(c.tag)] = cx.image;
    }
    const reminders = collectReminders(segments);
    const req: CheckRequest = {
      image: exp.image,
      segments: segsIn,
      crops,
      lastIssue: tutor.lastIssue,
      persona: tutor.persona,
      ...(reminders.length ? { reminders } : {}),
    };

    const ctrl = new AbortController();
    const job: Job = { version, ctrl };
    tutor.inflight = job;
    refreshCheckBtn();
    const started = performance.now();
    setStatus("busy", "Analyzing…");
    const rec: TraceRecord = ctx.trace.start(req);
    let judgeModel = "";
    let finalSeen = false;
    let errorEvent: Extract<CheckEvent, { type: "error" }> | null = null;

    const segByTag = (tag: number) => segments.find((s) => s.tag === tag);

    const handleFinal = (ev: Extract<CheckEvent, { type: "final" }>) => {
      finalSeen = true;
      const r = ev.result;
      ctx.trace.done(rec, ev.outcome);
      tutor.lastCheckedVersion = version;
      tutor.retries = 0;
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      const ms = (a: string) => rec.steps.filter((x) => x.agent === a).reduce((t, x) => t + x.ms, 0);
      const parts = [`Judge ${(ms("Judge") / 1000).toFixed(1)}s`];
      if (ms("Verifier")) parts.push(`Verifier ${(ms("Verifier") / 1000).toFixed(1)}s`);
      setStatus("idle", `Checked in ${secs}s (${parts.join(" · ")}) · ${judgeModel}`);
      if (state.destructiveVersion > version) return;

      const spokenIn = pickError(r, segsIn);
      const spoken = spokenIn ? segByTag(spokenIn.tag) ?? null : null;
      applyMarks(r, version, segments, capturedIdSet);

      const held = new Set<number>();
      for (const l of r.lines) {
        if (l.status !== "error") continue;
        const sg = segByTag(l.tag);
        if (sg && sg.hasNew && sg !== spoken) for (const st of sg.strokes) held.add(st.id);
      }
      for (const id of capturedIds) if (!held.has(id)) state.checkedIds.add(id);
      for (const l of r.lines) {
        const sg = segByTag(l.tag);
        if (sg && l.text) state.lineMemory.set(sg.key, l.text);
      }
      for (const k of ev.addVetoedKeys) tutor.vetoed.add(k);

      // close reminders whose line is no longer wrong
      for (const key of [...tutor.openIssues.keys()]) {
        const sg = segments.find((s) => s.key === key);
        const line = sg && r.lines.find((l) => l.tag === sg.tag);
        if (!sg || !line || line.status !== "error") tutor.openIssues.delete(key);
      }

      const changedSince = state.version !== version;
      const isError = !!(spoken && r.feedback);
      if (changedSince && !isError) return;

      if (!r.is_relevant) {
        tutor.lastIssue = "";
        tutor.issueIds = null;
        tutor.openIssues.clear();
        ctx.voice.hideCard();
        return;
      }
      if (isError && spoken) {
        tutor.announced.add(spoken.key);
        tutor.lastIssue = r.feedback;
        tutor.issueIds = new Set(spoken.strokes.map((s) => s.id));
        tutor.issueDismissed = false;
        tutor.acked = false;
        tutor.openIssues.set(spoken.key, { hints: [r.feedback], times: 1, lastSpokenAt: Date.now() });
        ctx.voice.showCard("bad", r.feedback);
        ctx.glow.start(spoken);
        return;
      }
      if (r.lines.some((l) => l.status === "error")) {
        // an earlier, already-announced mistake is still there: maybe say it differently (reminder)
        for (const rm of ev.reminders) {
          const sg = segByTag(rm.tag);
          const entry = sg && tutor.openIssues.get(sg.key);
          if (!sg || !entry || ctx.voice.speaking()) continue;
          entry.hints.push(rm.hint);
          entry.times++;
          entry.lastSpokenAt = Date.now();
          ctx.voice.showCard("bad", rm.hint);
          ctx.glow.start(sg);
          break;
        }
        return;
      }
      tutor.lastIssue = "";
      tutor.issueIds = null;
      tutor.issueDismissed = false;
      if (r.stage === "finished") {
        if (!r.lines.some((l) => l.status === "ok")) return;
        if (!tutor.acked) ctx.voice.showCard("ok", r.feedback || "Correct.");
        else if (ctx.$("card").dataset.kind === "bad") ctx.voice.hideCard();
        tutor.acked = true;
        return;
      }
      tutor.acked = false;
      if (ctx.$("card").dataset.kind === "bad") ctx.voice.hideCard();
      if (CLIENT_CONFIG.NUDGE_ENABLED && r.feedback) {
        const wait = Math.max(0, CLIENT_CONFIG.NUDGE_IDLE_MS - (Date.now() - tutor.lastStrokeEnd));
        clearTimeout(timers.nudge);
        timers.nudge = setTimeout(() => {
          if (state.version === version && state.activePointer === null) ctx.voice.showCard("nudge", r.feedback);
        }, wait);
      }
    };

    const onEvent = (ev: CheckEvent) => {
      if (tutor.inflight !== job) return;
      switch (ev.type) {
        case "judge":
          judgeModel = ev.model;
          ctx.trace.step(rec, { agent: "Judge", model: ev.model, ms: ev.ms, summary: judgeSummary(ev.result), judge: ev.result });
          applyMarks(ev.result, version, segments, capturedIdSet);
          if (ev.result.lines.some((l) => l.status === "error")) setStatus("busy", "Double-checking…");
          break;
        case "verifier":
          if (ev.result.verdict === "confirmed") ctx.voice.prefetch(ev.result.hint);
          ctx.trace.step(rec, {
            agent: "Verifier",
            model: ev.model,
            ms: ev.ms,
            summary: `L${ev.tag} ${ev.result.verdict}`,
            verifier: ev.result,
            tag: ev.tag,
          });
          break;
        case "verifier_failed":
          ctx.trace.step(rec, { agent: "Verifier", model: "-", ms: ev.ms, summary: `failed (${ev.message})`, tag: ev.tag });
          break;
        case "coach":
          ctx.trace.step(rec, { agent: "Coach", model: ev.model, ms: ev.ms, summary: `L${ev.tag} reminder`, coach: { tag: ev.tag, hint: ev.hint } });
          break;
        case "final":
          handleFinal(ev);
          break;
        case "error":
          errorEvent = ev;
          break;
      }
    };

    try {
      await streamCheck(req, tutor.accessCode, ctrl.signal, onEvent);
      if (tutor.inflight !== job) {
        ctx.trace.done(rec, "superseded");
        return;
      }
      if (errorEvent) {
        const e = errorEvent as Extract<CheckEvent, { type: "error" }>;
        throw Object.assign(new Error(e.message), { fatal: e.fatal, status: e.status });
      }
      if (!finalSeen) throw new Error("The check ended unexpectedly");
    } catch (err) {
      const e = err as Error & { fatal?: boolean; status?: number };
      if (e.name === "AbortError") {
        ctx.trace.done(rec, "cancelled");
        return;
      }
      if (tutor.inflight !== job) {
        ctx.trace.done(rec, "superseded");
        return;
      }
      ctx.trace.done(rec, `error: ${e.message}`);
      if (err instanceof HttpError && err.status === 401) {
        tutor.fatal = true;
        setStatus("err", "This server is protected — enter the access code", openAccessModal);
        openAccessModal();
      } else if (e.fatal) {
        tutor.fatal = true;
        setStatus("err", e.message);
      } else {
        tutor.retries++;
        if (tutor.retries <= CLIENT_CONFIG.MAX_RETRIES) {
          const delay = 2000 * 2 ** (tutor.retries - 1);
          setStatus("busy", `Gemini is busy — retrying in ${delay / 1000}s…`);
          clearTimeout(timers.retry);
          timers.retry = setTimeout(() => void runCheck(), delay);
        } else {
          setStatus("err", "Gemini is overloaded right now — it will try again when you write more");
        }
      }
    } finally {
      if (tutor.inflight === job) {
        tutor.inflight = null;
        refreshCheckBtn();
        if (
          tutor.pending &&
          state.version !== tutor.lastCheckedVersion &&
          state.activePointer === null &&
          (isManual() || Date.now() - tutor.lastStrokeEnd >= CLIENT_CONFIG.PAUSE_MS)
        ) {
          void runCheck();
        }
      }
    }
  }

  // Reminder clock: in Auto mode an unfixed, announced mistake is re-said after the idle time.
  const clock = setInterval(() => {
    if (isManual() || tutor.fatal || tutor.inflight || state.activePointer !== null) return;
    if (!tutor.openIssues.size || ctx.voice.speaking()) return;
    if (Date.now() - tutor.lastStrokeEnd < CLIENT_CONFIG.REMIND_IDLE_MS) return;
    const now = Date.now();
    if (![...tutor.openIssues.values()].some((e) => entryDue(e, now))) return;
    void runCheck(true, true);
  }, 1000);
  ctx.signal.addEventListener("abort", () => clearInterval(clock));

  return {
    onStrokeStart,
    onStrokeEnd,
    runCheck,
    manualCheck,
    cancelInflight,
    setMode,
    resetSession,
    setStatus,
    openAccessModal,
  };
}
