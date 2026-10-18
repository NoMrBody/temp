import { CLIENT_CONFIG } from "../../shared/config";
import type { CheckRequest } from "../../shared/types";
import type { Ctx, TraceApi, TraceRecord, TraceStep } from "./types";

export function createTrace(ctx: Ctx): TraceApi {
  const records: TraceRecord[] = [];
  const open = new Set<number>();
  let seq = 0;
  let raf = 0;
  const panel = () => ctx.$("trace");

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }
  ctx.signal.addEventListener("abort", () => cancelAnimationFrame(raf));

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const secs = (ms: number) => (ms / 1000).toFixed(1) + "s";

  function chip(s: TraceStep): string {
    const cls = s.agent === "Judge" ? "jud" : s.agent === "Verifier" ? "ver" : "";
    return `<span class="chip ${cls}">${esc(s.agent)} · ${secs(s.ms)} · ${esc(s.summary)}</span>`;
  }

  function detail(r: TraceRecord): string {
    const judge = r.steps.find((s) => s.agent === "Judge")?.judge;
    let h = '<div class="d">';
    if (judge) {
      h += '<div class="dh">Lines</div>';
      for (const l of judge.lines)
        h += `<div class="ln ${l.status}"><b>L${l.tag}</b>${esc(l.text)}<i>${l.status}</i></div>`;
      if (judge.feedback) h += `<div class="say">Judge: “${esc(judge.feedback)}”</div>`;
    }
    for (const s of r.steps) {
      if (s.agent === "Verifier" && s.verifier) {
        const v = s.verifier;
        h += `<div class="dh" style="margin-top:6px">Verifier · L${s.tag}</div><div class="ln">read: ${esc(v.read_text)}<br>should be: ${esc(v.correct_step)}<br>why: ${esc(v.reason)}<br>verdict: <b>${v.verdict}</b></div>`;
        if (v.hint) h += `<div class="say">“${esc(v.hint)}”</div>`;
      }
      if (s.agent === "Coach" && s.coach) h += `<div class="say">Reminder L${s.coach.tag}: “${esc(s.coach.hint)}”</div>`;
    }
    h += `<img class="th" alt="canvas sent to the Judge" src="data:image/png;base64,${r.image}">`;
    h += `<div class="labels"><span>Label:</span>`;
    for (const [k, t] of [["right", "✓ right"], ["false", "✗ false alarm"], ["missed", "✗ missed a mistake"]] as const)
      h += `<button data-label="${k}" data-id="${r.id}" class="${r.label === k ? "on " + k : ""}">${t}</button>`;
    h += "</div></div>";
    return h;
  }

  function stats(): string {
    const lab = records.filter((r) => r.label);
    const n = (k: string) => lab.filter((r) => r.label === k).length;
    const caught = records.filter((r) => r.steps.some((s) => s.agent === "Verifier" && s.verifier && s.verifier.verdict !== "confirmed")).length;
    return `${lab.length} labeled: ${n("right")} right · ${n("false")} false alarm · ${n("missed")} missed · Verifier caught ${caught}`;
  }

  function render() {
    const list = ctx.$("traceList");
    ctx.$("traceStats").textContent = stats();
    if (!records.length) {
      list.innerHTML = '<div class="empty">No checks yet. Write something and the agents will show their work here.</div>';
      return;
    }
    list.innerHTML = [...records]
      .reverse()
      .map((r) => {
        const t = new Date(r.time).toLocaleTimeString();
        return `<div class="it" data-id="${r.id}"><div class="hd" data-toggle="${r.id}"><span class="t">${t}</span><span class="o">${esc(r.outcome || "running…")}</span>${r.label ? `<span class="lb ${r.label}">${r.label}</span>` : ""}</div><div class="chips">${r.steps.map(chip).join("")}</div>${open.has(r.id) ? detail(r) : ""}</div>`;
      })
      .join("");
  }

  const listEl = ctx.$("traceList");
  listEl.addEventListener(
    "click",
    (e) => {
      const t = e.target as HTMLElement;
      const tog = t.closest("[data-toggle]") as HTMLElement | null;
      const lab = t.closest("[data-label]") as HTMLElement | null;
      if (lab) {
        const r = records.find((x) => x.id === Number(lab.dataset.id));
        if (r) r.label = r.label === lab.dataset.label ? "" : (lab.dataset.label as TraceRecord["label"]);
        schedule();
      } else if (tog) {
        const id = Number(tog.dataset.toggle);
        if (open.has(id)) open.delete(id);
        else open.add(id);
        schedule();
      }
    },
    { signal: ctx.signal },
  );
  ctx.$("traceClose").addEventListener("click", () => panel().classList.remove("open"), { signal: ctx.signal });
  ctx.$("traceClear").addEventListener(
    "click",
    () => {
      records.length = 0;
      open.clear();
      schedule();
    },
    { signal: ctx.signal },
  );
  ctx.$("traceExport").addEventListener(
    "click",
    () => {
      const data = {
        exportedAt: new Date().toISOString(),
        note: "Math Board trace. Replay with `npm run eval -- <file>`.",
        checks: records.map((r) => ({
          id: r.id,
          time: new Date(r.time).toISOString(),
          outcome: r.outcome,
          label: r.label,
          request: r.request,
          steps: r.steps.map((s) => ({
            agent: s.agent,
            model: s.model,
            ms: s.ms,
            summary: s.summary,
            judge: s.judge,
            verifier: s.verifier,
            coach: s.coach,
          })),
          image: r.image,
          crops: r.crops,
        })),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "mathboard-trace.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    { signal: ctx.signal },
  );

  render();

  return {
    start(req: CheckRequest) {
      const rec: TraceRecord = {
        id: ++seq,
        time: Date.now(),
        request: { segments: req.segments, lastIssue: req.lastIssue, persona: req.persona },
        image: req.image,
        crops: req.crops,
        steps: [],
        outcome: "",
        label: "",
      };
      records.push(rec);
      while (records.length > CLIENT_CONFIG.TRACE_MAX) records.shift();
      schedule();
      return rec;
    },
    step(rec, step) {
      rec.steps.push(step);
      schedule();
    },
    done(rec, outcome) {
      rec.outcome = outcome;
      panel().dataset.last = outcome;
      schedule();
    },
    toggle() {
      panel().classList.toggle("open");
      schedule();
    },
  };
}
