import type { ChatRequest, ChatResponse } from "../../shared/types";
import { exportImage } from "./export";
import { strokeBox } from "./geometry";
import { renderTex } from "./latex";
import { fitFontSize, noteBox, noteColor } from "./notes";
import { SHEET_W } from "./sheets";
import type { Box, ChatApi, Ctx, Note } from "./types";

const MAX_PDF_BYTES = 2_600_000; // base64 grows it by a third; the server body limit is ~4.4 MB
const MAX_CANVAS_B64 = 900_000;

interface Msg {
  role: "user" | "assistant";
  text: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createChat(ctx: Ctx): ChatApi {
  const { state, tutor } = ctx;
  const sig = { signal: ctx.signal };
  const panel = ctx.$("chat");
  const list = ctx.$("chatList");
  const input = ctx.$("chatInput") as HTMLTextAreaElement;
  const sendBtn = ctx.$("chatSend") as HTMLButtonElement;
  const file = ctx.$("chatFile") as HTMLInputElement;
  const chip = ctx.$("chatPdf");
  const hintbox = ctx.$("hintbox");

  const messages: Msg[] = [];
  let busy = false;
  let ctrl: AbortController | null = null;
  ctx.signal.addEventListener("abort", () => ctrl?.abort());

  function stack() {
    const open = hintbox.classList.contains("open");
    document.documentElement.style.setProperty("--stack", open ? hintbox.offsetHeight + 10 + "px" : "0px");
  }

  function bubble(role: "user" | "assistant" | "system", text: string, cls = ""): HTMLElement {
    const el = document.createElement("div");
    el.className = `msg ${role} ${cls}`.trim();
    el.textContent = text;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    return el;
  }

  /** The chip shows the worksheet that lives on the current page. */
  function refresh() {
    const w = ctx.worksheet;
    chip.hidden = !w;
    ctx.$("chatPdfName").textContent = w ? `${w.name} · ${w.sheets.length} page${w.sheets.length > 1 ? "s" : ""}` : "";
  }

  function showHint(text: string) {
    ctx.$("hintBoxText").textContent = text;
    hintbox.classList.add("open");
    stack();
  }
  function hideHint() {
    hintbox.classList.remove("open");
    stack();
  }

  /**
   * The tutor's solution as typeset LaTeX. With a worksheet it goes into the free space to the right of the sheets,
   * level with what the student is looking at (and the view pans to it); otherwise below the student's ink.
   * The student can drag it anywhere afterwards (handle above the note).
   */
  async function writeSolution(lines: string[]): Promise<void> {
    await Promise.all(lines.map((l) => renderTex(l, noteColor(ctx.theme()))));
    const v = ctx.view;
    const sheets = ctx.sheets.bounds();
    const topWorld = ctx.toWorld({ x: 0, y: 90 }).y;
    const wanted = Math.min(44, Math.max(16, 24 / v.scale)); // about 24 px on screen
    let note: Note;
    if (sheets) {
      const maxW = Math.max(200, (ctx.viewW() - 460) / v.scale); // leaves room for the chat panel
      note = { x: sheets.x1 + 48, y: topWorld, fontSize: fitFontSize(lines, maxW, wanted, 10), lines };
      // do not write over an earlier note
      let moved = true;
      while (moved) {
        moved = false;
        const h = noteBox(note).y1 - note.y;
        for (const n of state.notes) {
          const b = noteBox(n);
          if (note.x < b.x1 + 20 && note.x + 40 > b.x0 && note.y < b.y1 + 20 && note.y + h > b.y0 - 20) {
            note.y = b.y1 + 32;
            moved = true;
          }
        }
      }
    } else {
      note = { x: 44, y: 0, fontSize: fitFontSize(lines, Math.max(160, ctx.viewW() / v.scale - 90), wanted, 10), lines };
      let bottom = 70;
      for (const s of state.strokes) if (s.tool === "pen") bottom = Math.max(bottom, strokeBox(s).y1);
      for (const n of state.notes) bottom = Math.max(bottom, noteBox(n).y1);
      note.y = state.strokes.length || state.notes.length ? bottom + 36 : topWorld;
    }
    state.notes.push(note);
    ctx.canvas.redrawNotes();
    ctx.canvas.updateHint();
    const b = noteBox(note);
    const reveal: Box = { x0: b.x0, y0: b.y0 - 34 / v.scale, x1: b.x1, y1: Math.min(b.y1, b.y0 + (ctx.viewH() - 200) / v.scale) };
    ctx.viewApi.reveal(reveal);
    ctx.notesUi.sync();
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    bubble("user", text);
    const history = messages.slice(-10);
    messages.push({ role: "user", text });
    busy = true;
    sendBtn.disabled = true;
    const wait = bubble("assistant", "thinking…", "wait");

    const body: ChatRequest = { message: text, history, persona: tutor.persona };
    const w = ctx.worksheet;
    if (w) {
      body.pdf = { name: w.name, data: w.data };
      body.pageCount = w.sheets.length;
      const f = ctx.sheets.focusIndex();
      if (f >= 0) body.focusPage = f + 1;
    }
    const exp = exportImage(ctx, { allBlack: true });
    if (exp && exp.image.length <= MAX_CANVAS_B64) body.canvas = exp.image;

    ctrl = new AbortController();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (tutor.accessCode) headers["x-access-code"] = tutor.accessCode;
      const res = await fetch("/api/chat", { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
      if (res.status === 401) {
        ctx.tutorApi.openAccessModal();
        throw new Error("This server is protected — enter the access code.");
      }
      if (res.status === 429) throw new Error("Slow down a little — too many messages in a minute.");
      if (res.status === 413) throw new Error("That is too big to send. Try a smaller PDF.");
      if (!res.ok) throw new Error(`The tutor could not answer (HTTP ${res.status}).`);
      const data = (await res.json()) as Partial<ChatResponse> & { error?: { message: string } };
      if (data.error) throw new Error(data.error.message);
      const reply = data as ChatResponse;
      wait.remove();
      let shown = reply.message || "…";
      if (reply.intent === "solution" && reply.solution_lines.length) {
        hideHint();
        await writeSolution(reply.solution_lines);
        shown += w ? " (written next to the worksheet)" : ` (written on page ${ctx.pages.index() + 1})`;
      } else if (reply.intent === "hint") {
        showHint(reply.message);
      }
      messages.push({ role: "assistant", text: reply.message });
      bubble("assistant", shown, "i-" + reply.intent);
    } catch (err) {
      wait.remove();
      if ((err as Error).name !== "AbortError") bubble("assistant", (err as Error).message || "Something went wrong.", "error");
      messages.pop(); // the failed question is not part of the conversation
    } finally {
      busy = false;
      sendBtn.disabled = false;
      ctrl = null;
      input.focus();
    }
  }

  async function attach(f: File) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const isPdf = bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "%PDF";
    if (!isPdf) {
      bubble("system", "That file is not a PDF.", "error");
      return;
    }
    if (bytes.length > MAX_PDF_BYTES) {
      bubble("system", `That PDF is ${(bytes.length / 1e6).toFixed(1)} MB; the limit is ${(MAX_PDF_BYTES / 1e6).toFixed(1)} MB. Try fewer pages.`, "error");
      return;
    }
    try {
      const n = await ctx.sheets.load(bytes, f.name, toBase64(bytes));
      open();
      bubble("system", `Opened ${f.name}: ${n} page${n > 1 ? "s" : ""} on your canvas (${SHEET_W} wide, scroll or pinch to move around). Ask me about a problem, for example “help me with problem 1a”.`);
    } catch (err) {
      bubble("system", `Could not open that PDF: ${(err as Error).message}`, "error");
    }
  }

  function open() {
    panel.classList.add("open");
    setTimeout(() => input.focus(), 0);
  }
  function toggle() {
    if (panel.classList.contains("open")) panel.classList.remove("open");
    else open();
  }

  ctx.$("chatBtn").addEventListener("click", () => toggle(), sig);
  ctx.$("chatClose").addEventListener("click", () => panel.classList.remove("open"), sig);
  ctx.$("chatAttach").addEventListener("click", () => file.click(), sig);
  ctx.$("openPdf").addEventListener("click", () => file.click(), sig);
  ctx.$("chatPdfRemove").addEventListener("click", () => ctx.sheets.clear(), sig);
  file.addEventListener(
    "change",
    () => {
      const f = file.files?.[0];
      if (f) void attach(f);
      file.value = "";
    },
    sig,
  );
  sendBtn.addEventListener("click", () => void send(), sig);
  input.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
      e.stopPropagation(); // typing must not trigger board shortcuts
    },
    sig,
  );
  ctx.$("hintClose").addEventListener("click", hideHint, sig);
  window.addEventListener("resize", stack, sig);
  refresh();
  bubble("system", "Open a PDF with your problems (the 📄 button or 📎): its pages float on your canvas and you can write on them. Then tell me which problem you want help with. I give a hint first; ask me to write the solution on the canvas if you need it.");

  return { toggle, open, openFile: () => file.click(), refresh };
}
