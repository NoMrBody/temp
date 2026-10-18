import type { Ctx, Note, NotesUiApi } from "./types";

/** Small handles above each tutor note: drag to move it anywhere, × to remove it. They follow pan/zoom. */
export function createNotesUi(ctx: Ctx): NotesUiApi {
  const host = ctx.$("notectl");
  const els = new Map<Note, HTMLElement>();
  const sig = { signal: ctx.signal };

  function make(note: Note): HTMLElement {
    const el = document.createElement("div");
    el.className = "note-ctl";
    const grip = document.createElement("button");
    grip.className = "grip";
    grip.title = "Drag to move";
    grip.setAttribute("aria-label", "Move this note");
    grip.textContent = "✥";
    const del = document.createElement("button");
    del.className = "del";
    del.title = "Remove this note";
    del.setAttribute("aria-label", "Remove this note");
    del.textContent = "×";
    el.append(grip, del);

    let drag: { px: number; py: number; x: number; y: number } | null = null;
    grip.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        grip.setPointerCapture(e.pointerId);
        drag = { px: e.clientX, py: e.clientY, x: note.x, y: note.y };
        el.classList.add("dragging");
      },
      sig,
    );
    grip.addEventListener(
      "pointermove",
      (e) => {
        if (!drag) return;
        note.x = drag.x + (e.clientX - drag.px) / ctx.view.scale;
        note.y = drag.y + (e.clientY - drag.py) / ctx.view.scale;
        ctx.canvas.redrawNotes();
        place(note, el);
      },
      sig,
    );
    const end = () => {
      drag = null;
      el.classList.remove("dragging");
    };
    grip.addEventListener("pointerup", end, sig);
    grip.addEventListener("pointercancel", end, sig);
    del.addEventListener(
      "click",
      () => {
        const i = ctx.state.notes.indexOf(note);
        if (i >= 0) ctx.state.notes.splice(i, 1);
        ctx.canvas.redrawNotes();
        ctx.canvas.updateHint();
        sync();
      },
      sig,
    );
    host.appendChild(el);
    return el;
  }

  function place(note: Note, el: HTMLElement) {
    const p = ctx.toScreen({ x: note.x, y: note.y });
    el.style.left = Math.round(p.x - 4) + "px";
    el.style.top = Math.round(p.y - 30) + "px";
    el.style.display = p.x < -80 || p.y < -60 || p.x > ctx.viewW() + 20 || p.y > ctx.viewH() + 20 ? "none" : "";
  }

  function sync() {
    for (const [note, el] of els) {
      if (!ctx.state.notes.includes(note)) {
        el.remove();
        els.delete(note);
      }
    }
    ctx.state.notes.forEach((note, i) => {
      let el = els.get(note);
      if (!el) {
        el = make(note);
        els.set(note, el);
      }
      el.dataset.note = String(i);
      place(note, el);
    });
  }

  return { sync };
}
