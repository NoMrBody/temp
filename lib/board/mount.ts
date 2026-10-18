import { CLIENT_CONFIG, PERSONA_LABELS } from "../../shared/config";
import type { Persona } from "../../shared/types";
import { createCanvas } from "./canvas";
import { createChat } from "./chat";
import { createGlow } from "./glow";
import { createGraph } from "./graph/panel";
import { createMarks } from "./marks";
import { createNotesUi } from "./notesui";
import { createSheetUi } from "./sheetui";
import { createPages } from "./pages";
import { createSheets } from "./sheets";
import { createView } from "./view";
import { toScreenPt, toWorldPt } from "./viewmath";
import { createState, createTimers, createTutor, store } from "./state";
import { createTrace } from "./trace";
import { createTutorApi } from "./tutor";
import type { Ctx } from "./types";
import { createVoice } from "./voice";

/** Wires the whole board imperatively. Idempotent: every listener/timer is released by the returned cleanup. */
export function mountBoard(root: HTMLElement): () => void {
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  const $ = (id: string): HTMLElement => {
    const el = root.querySelector("#" + id) as HTMLElement | null;
    if (!el) throw new Error("missing #" + id);
    return el;
  };
  const board = $("board") as HTMLCanvasElement;
  const glowCanvas = $("glow") as HTMLCanvasElement;

  const ctx = {
    root,
    signal: ac.signal,
    $,
    state: createState(),
    tutor: createTutor(),
    timers: createTimers(),
    dpr: Math.max(1, window.devicePixelRatio || 1),
    reduceMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    board,
    bctx: board.getContext("2d") as CanvasRenderingContext2D,
    view: { scale: 1, tx: 0, ty: 0 },
    worksheet: null,
    sheetsCanvas: $("sheets") as HTMLCanvasElement,
    sctx: ($("sheets") as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D,
    notesCanvas: $("notes") as HTMLCanvasElement,
    nctx: ($("notes") as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D,
    glowCanvas,
    gctx: glowCanvas.getContext("2d") as CanvasRenderingContext2D,
    toScreen: (p) => toScreenPt(ctx.view, p),
    toWorld: (p) => toWorldPt(ctx.view, p),
    viewW: () => window.innerWidth,
    viewH: () => window.innerHeight,
    theme: () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
  } as Ctx;

  ctx.viewApi = createView(ctx);
  ctx.sheets = createSheets(ctx);
  ctx.notesUi = createNotesUi(ctx);
  ctx.sheetUi = createSheetUi(ctx);
  ctx.marks = createMarks(ctx);
  ctx.glow = createGlow(ctx);
  ctx.voice = createVoice(ctx);
  ctx.graph = createGraph(ctx);
  ctx.trace = createTrace(ctx);
  ctx.tutorApi = createTutorApi(ctx);
  ctx.canvas = createCanvas(ctx);
  ctx.pages = createPages(ctx);
  ctx.chat = createChat(ctx);

  const { state, tutor, timers } = ctx;
  const on = (id: string, fn: (e: Event) => void) => $(id).addEventListener("click", fn, sig);

  // --- initial UI state
  ctx.voice.init();
  ctx.canvas.resize();
  ctx.canvas.updateHint();
  ctx.tutorApi.setMode(tutor.mode);
  ctx.tutorApi.setStatus("idle");
  const penSize = $("penSize") as HTMLInputElement;
  penSize.value = String(state.penWidth);
  const sizePrev = $("sizePrev");
  const showSize = () => {
    sizePrev.style.height = Math.max(1.5, state.penWidth) + "px";
  };
  showSize();

  // --- tools
  function setTool(t: "pen" | "eraser" | "hand") {
    state.tool = t;
    $("penBtn").classList.toggle("active", t === "pen");
    $("eraserBtn").classList.toggle("active", t === "eraser");
    $("handBtn").classList.toggle("active", t === "hand");
    document.body.classList.toggle("eraser", t === "eraser");
    ctx.canvas.syncCursor();
  }
  on("penBtn", () => setTool("pen"));
  on("eraserBtn", () => setTool("eraser"));
  on("handBtn", () => setTool("hand"));
  on("sizeBtn", (e) => {
    e.stopPropagation();
    $("sizePop").classList.toggle("open");
  });
  $("sizePop").addEventListener("click", (e) => e.stopPropagation(), sig);
  document.addEventListener("click", () => $("sizePop").classList.remove("open"), sig);
  penSize.addEventListener(
    "input",
    () => {
      state.penWidth = parseFloat(penSize.value) || CLIENT_CONFIG.PEN_WIDTH;
      store.set("mathboard.pen", String(state.penWidth));
      showSize();
    },
    sig,
  );
  function setTheme(t: "dark" | "light") {
    document.documentElement.dataset.theme = t;
    store.set("mathboard.theme", t);
    $("themeSun").style.display = t === "dark" ? "" : "none";
    $("themeMoon").style.display = t === "dark" ? "none" : "";
    $("themeBtn").title = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
    window.dispatchEvent(new Event("mathboard:theme"));
  }
  on("themeBtn", () => setTheme(ctx.theme() === "dark" ? "light" : "dark"));
  setTheme(ctx.theme());
  on("undoBtn", () => ctx.canvas.undo());
  on("clearBtn", () => ctx.canvas.clearCanvas());
  on("traceBtn", () => ctx.trace.toggle());
  on("voiceBtn", () => ctx.voice.toggle());
  on("modeAuto", () => ctx.tutorApi.setMode("auto"));
  on("modeManual", () => ctx.tutorApi.setMode("manual"));
  on("checkBtn", () => ctx.tutorApi.manualCheck());

  function dismissCaption() {
    tutor.captionSeq++;
    tutor.issueDismissed = true;
    ctx.voice.stop();
    ctx.glow.stop();
    ctx.voice.hideCard();
  }
  on("cardClose", dismissCaption);

  // --- access code modal
  const accessModal = $("accessModal");
  const accessInput = $("accessInput") as HTMLInputElement;
  function saveAccess() {
    tutor.accessCode = accessInput.value.trim();
    store.set("mathboard.accessCode", tutor.accessCode);
    tutor.fatal = false;
    accessModal.classList.remove("open");
    ctx.tutorApi.setStatus("idle");
    if (state.version !== tutor.lastCheckedVersion && state.strokes.length) {
      timers.check = setTimeout(() => void ctx.tutorApi.runCheck(), 300);
    }
  }
  on("accessSave", saveAccess);
  on("accessCancel", () => accessModal.classList.remove("open"));
  on("accessBtn", () => ctx.tutorApi.openAccessModal());
  accessInput.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") saveAccess();
    },
    sig,
  );

  // --- keyboard
  window.addEventListener(
    "keydown",
    (e) => {
      if (accessModal.classList.contains("open")) {
        if (e.key === "Escape") accessModal.classList.remove("open");
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName) && e.key !== "Escape") return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        ctx.canvas.undo();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        void ctx.tutorApi.runCheck(true);
      } else if (!mod && e.key === "Enter" && tutor.mode === "manual") {
        e.preventDefault();
        ctx.tutorApi.manualCheck();
      } else if (!mod && k === "p") setTool("pen");
      else if (!mod && k === "e") setTool("eraser");
      else if (!mod && k === "h") setTool("hand");
      else if (!mod && k === "0") ctx.viewApi.fit();
      else if (!mod && k === "m") ctx.voice.toggle();
      else if (!mod && k === "t") ctx.trace.toggle();
      else if (!mod && k === "c") {
        e.preventDefault();
        ctx.chat.toggle();
      }
      else if (e.key === "Escape") {
        $("sizePop").classList.remove("open");
        dismissCaption();
      }
    },
    sig,
  );
  window.addEventListener("resize", () => ctx.canvas.resize(), sig);

  // --- persona switch: only when more than one persona exists
  const personas = Object.keys(PERSONA_LABELS) as Persona[];
  let personaEl: HTMLElement | null = null;
  if (personas.length > 1) {
    const saved = store.get("mathboard.persona") as Persona | null;
    if (saved && personas.includes(saved)) tutor.persona = saved;
    personaEl = document.createElement("div");
    personaEl.className = "toolbar persona";
    personaEl.style.right = "auto";
    const seg = document.createElement("div");
    seg.className = "seg";
    for (const p of personas) {
      const b = document.createElement("button");
      b.textContent = PERSONA_LABELS[p];
      b.classList.toggle("active", p === tutor.persona);
      b.addEventListener(
        "click",
        () => {
          tutor.persona = p;
          store.set("mathboard.persona", p);
          for (const x of Array.from(seg.children)) x.classList.toggle("active", x === b);
        },
        sig,
      );
      seg.appendChild(b);
    }
    personaEl.appendChild(seg);
    root.appendChild(personaEl);
  }

  // --- server capabilities
  void (async () => {
    try {
      const res = await fetch("/api/health", { signal: ac.signal });
      const h = (await res.json()) as { keyConfigured: boolean; accessRequired: boolean };
      tutor.accessRequired = h.accessRequired;
      if (h.accessRequired) {
        $("accessBtn").hidden = false;
        if (!tutor.accessCode) ctx.tutorApi.openAccessModal();
      }
      if (!h.keyConfigured) {
        tutor.fatal = true;
        ctx.tutorApi.setStatus("err", "The server has no GEMINI_API_KEY configured");
      }
    } catch {
      /* offline or unmounted: the first check will surface any problem */
    }
  })();

  return () => {
    ac.abort();
    clearTimeout(timers.check);
    clearTimeout(timers.retry);
    clearTimeout(timers.nudge);
    clearTimeout(timers.autoHide);
    ctx.tutorApi.cancelInflight();
    ctx.voice.stop();
    ctx.glow.stop();
    ctx.marks.removeMarks(() => true);
    ctx.$("notectl").replaceChildren();
    ctx.$("sheetctl").replaceChildren();
    document.body.classList.remove("eraser", "hand");
    personaEl?.remove();
  };
}
