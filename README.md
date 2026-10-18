# IterraAI

IterraAI is a handwritten-math tutor on a full-screen canvas. You write with a pen, stylus, finger or mouse. A "big brother" tutor watches your notebook and stays quiet unless it has something useful to say:

- a small **green tick** appears next to every line that checks out;
- when a line is **wrong**, its ink glows for two seconds and the tutor tells you, in one or two short sentences, *where* the mistake is and the idea behind it (never the final answer);
- you can **open a PDF of problems**, write on its pages, and **chat** with the tutor: ask for a hint on "problem 2b", and if the hint is not enough, ask it to write the solution on the canvas as typeset LaTeX.

Built with Next.js (App Router) and TypeScript. The Gemini API key lives only on the server.

## Contents

[Quick start](#quick-start) · [Using IterraAI](#using-iterraai) · [How it works](#how-it-works) · [Configuration](#configuration) · [Project layout](#project-layout) · [Testing](#testing) · [Deploying to Vercel](#deploying-to-vercel) · [Design decisions](#design-decisions) · [Known limits](#known-limits)

## Quick start

Requirements: Node.js 20 or newer and a [Gemini API key](https://aistudio.google.com/apikey).

```bash
npm install
echo 'GEMINI_API_KEY=your_key_here' > .env.local
npm run dev            # http://localhost:3000
```

Production build: `npm run build && npm start`. Check `http://localhost:3000/api/health`: it should report `keyConfigured: true`.

## Using IterraAI

### Writing and being checked

- **Auto mode (default):** the tutor checks two seconds after you stop writing, or immediately when you start a new line below. A running check is never cancelled by new writing; one follow-up check runs afterwards.
- **Manual mode:** nothing is checked until you press **Check** (or Enter).
- **Silence is the default.** The tutor speaks about a mistake once per exact line, only after a second, stronger model has confirmed it. If you leave a confirmed mistake unfixed and keep working, it reminds you later in different words (at most three times, 45 s apart, only after 30 s of idle time in Auto mode). Fixed mistakes clear silently. A correct finished solution gets one short cheer.
- **Graphs:** a line such as `y = 2x^2` gets a small graph button. The panel supports several curves, zoom, pan, and marks intercepts, roots and extrema.
- **Voice:** Chrome, Edge and Safari use the browser's own speech. Firefox, Brave and browsers without any voices use a natural voice generated on the server (Gemini text-to-speech), so every browser sounds acceptable. Mute with **M**.

### Worksheets (PDF)

- **Open PDF** (bottom bar, or the paperclip in the chat): all pages appear as white sheets floating on the canvas, stacked top to bottom. Limits: 30 pages, 2.6 MB.
- **Write on them** like on any canvas. Ink is dark on a sheet; your lines are checked as usual.
- **Move around:** the canvas is unbounded. Wheel or two-finger scroll pans; Ctrl+wheel or a trackpad pinch zooms (25 % – 400 %); on touch screens pinch with two fingers (with a stylus in use, one finger pans); the **Move** tool (**H**), holding **Space**, or the middle mouse button also pan. **0** or the fit button fits the worksheet to the screen.
- **Move or delete the worksheet:** a handle above its first page shows the file name. Drag ✥ to move the whole worksheet (your writing on it and its ticks go along). × deletes it after a second click; your writing stays.

### Tutor chat

Open with the speech-bubble button or **C**.

| You say | The tutor does |
|---|---|
| "help me with problem 1a" | Reads the whole PDF, your writing and which page you are looking at. Shows a **hint** in a small window in the top-left corner (never the final answer). |
| "that's not enough, write the solution on the canvas" | Writes the full solution as **typeset LaTeX** next to the worksheet and pans there. |
| anything else | Answers in the chat. |

Solution notes have handles: ✥ drag them anywhere, × remove. They are not your ink: never checked as your work, untouched by the eraser, included in the PDF export. The tutor's solutions are produced by a language model and are not verified: check them.

### Pages, export, themes

- **Pages:** `+` adds a canvas page, ‹ › switch between them. Each page keeps its own ink, worksheet, view, undo history and tutor memory.
- **Export PDF** (bottom bar): one PDF page per worksheet sheet (with your writing and the tutor's notes closest to it, nothing cropped) or one page for a plain canvas. Everything runs in the browser.
- **Theme:** the sun/moon button switches between dark (default) and light and is remembered.
- **Trace panel (T):** shows every agent step of every check (Judge, Verifier, Coach, timings, the image sent), lets you label results (✓ right, ✗ false alarm, ✗ missed) and export them as `iterraai-trace.json` for the offline evaluator.

### Shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| **P** / **E** / **H** | pen / eraser / move | **M** | mute or unmute voice |
| **T** | trace panel | **C** | tutor chat |
| **0** | fit worksheet | **Space** (hold) | pan with the mouse |
| **Ctrl/Cmd+Z** | undo | **Enter** | Check (Manual mode) |
| **Ctrl/Cmd+Enter** | check now (any mode) | **Esc** | dismiss caption and glow |

Tablets and styluses are supported: palm rejection (large touches, touches near the pen, touches after the pen has been used), the stylus eraser button, and a canvas that follows rotation and Safari's address bar.

## How it works

```
 Browser (React shell + imperative canvas engine)               Server (Next.js route handlers, Node runtime)
 ┌───────────────────────────────────────────────┐              ┌──────────────────────────────────────────┐
 │ strokes → lines (L1, L2, …) → tagged PNG      │  CheckRequest│ POST /api/check  (NDJSON stream)          │
 │ ticks, glow, caption, voice, graph, trace     │ ────────────▶│  Orchestrator (plain code)                │
 │ worksheet sheets, pan/zoom, notes, pages, PDF │ ◀────────────│   ├─ Judge     fast model, every line  │
 │ owns ALL session state                        │  NDJSON      │   ├─ Verifier  stronger, flagged lines │
 └───────────────────────────────────────────────┘  events      │   └─ Coach     rewords reminders       │
        │  POST /api/chat   (hint / solution / answer)          │ POST /api/chat   tutor chat + PDF         │
        └──────────────────────────────────────────────────────▶│ POST /api/speak  server-side speech       │
                                                                │ GET  /api/health                          │
                                                                └──────────────────────────────────────────┘
```

- **The server is stateless.** Every request carries what it needs; the browser keeps all session state. This makes the orchestrator a pure function of the request and removes sticky-session problems on serverless hosting.
- **Judge → Verifier:** the Judge reads the whole canvas image and returns a verdict for every line. Only lines it flags (and that are new or never announced) go to the Verifier, at most two per check. A mistake is spoken only if the Verifier confirms it (fail-open if the Verifier is unreachable). The Verifier can only confirm, veto or reword; it can never create an accusation.
- **Gemini access** is plain REST with model fallback, a hedged second request after 8 s, per-model cooldowns, thinking-config handling per model family, and fatal-error detection for key problems.
- **Canvas engine:** native Canvas 2D and Pointer Events, no drawing library. A world/screen transform supports pan and zoom; PDF pages are rendered with `pdfjs-dist`, LaTeX with MathJax (loaded on first use), PDFs are written by a small built-in generator.

## Configuration

Set in `.env.local` (local) or the host's environment (Vercel). Only the first is required.

| Variable | Meaning |
|---|---|
| `GEMINI_API_KEY` | **Required.** Gemini API key. Server only: never logged, never sent to the browser. |
| `ACCESS_CODE` | Optional shared code. If set, every API call must carry it (the UI asks once). Recommended for public deployments. |
| `JUDGE_MODELS` | Optional comma-separated model list that replaces the default Judge list (pin stable models here). |
| `VERIFIER_MODELS` | Optional list for the Verifier and the chat. |
| `TTS_MODEL`, `TTS_VOICE` | Optional server-side speech model and voice (defaults `gemini-2.5-flash-preview-tts`, `Charon`). |
| `GEMINI_API_BASE` | Optional API base URL (the tests point it at a mock server). |

Tunable behaviour (pause length, thresholds, timeouts, retry budget…) lives in `shared/config.ts`.

## Project layout

```
app/            routes: page, /api/check, /api/chat, /api/speak, /api/health, global CSS (themes)
components/     Board.tsx — the markup (a single client component that mounts the engine)
lib/board/      browser-only engine: canvas, ink analysis, export, tutor loop, marks, glow, voice,
                graph/, sheets (PDF pages), view (pan/zoom), pages, chat, notes + LaTeX, trace, PDF writer
server/         Gemini client, models, prompts, agents (judge, verifier, coach, chat), orchestrator
shared/         config, types, zod schemas, outcome helpers (used by both sides)
tests/          unit/ (vitest), e2e/ (Playwright), mock-gemini/ (a stand-in Gemini server)
evals/run.ts    offline replay of labeled traces against the real model
```

`lib/` never imports from `server/` and the other way round; both may import `shared/`.

## Testing

```bash
npm test               # unit tests (vitest)
npm run typecheck && npm run lint
npm run build          # required before the e2e tests
npm run test:e2e       # Playwright against `next start` + the mock Gemini server
```

- **Unit tests** cover the expression parser, ink segmentation, the orchestrator's rules, the Gemini client (retries, cooldowns, hedging, timeouts), request validation, prompt/schema snapshots, chat parsing, view math and the PDF writer.
- **End-to-end tests** run in Chromium with a mock Gemini server on a random port (no key needed): verifier outcomes, Auto and Manual modes, reminders, graphs, invalidation, pages and export, worksheets and gestures, chat, LaTeX notes and moving them, themes, access code, a missing key, and React StrictMode (against `next dev`). Screenshots land in `test-results/screenshots/`.
- `npm run eval -- iterraai-trace.json [--max-false 0.05]` replays labeled traces with the **real** key and reports the false-accusation and missed-mistake rates, Verifier precision and latencies.

## Deploying to Vercel

1. Push the repository (it contains no secrets). 2. Import it in Vercel (Next.js preset, Node 22). 3. Add `GEMINI_API_KEY` (mark it Sensitive) and, for a public site, `ACCESS_CODE`, for Production and Preview. 4. Redeploy and open `/api/health`. 5. The API routes declare `maxDuration` 60 s (`/api/chat` too); lower it, and `VERIFIER_TIMEOUT_MS` in `shared/config.ts`, if your plan allows less.

Vercel limits request bodies to about 4.5 MB, which is why PDFs are capped at 2.6 MB.

## Design decisions

- **Prompts, schemas and thresholds are unchanged from the tested prototype** (and snapshot-tested against it). New agents may only confirm, veto or reword.
- **Worksheet context:** the PDF is re-sent with every chat message (stateless server, no file upload API). The automatic checker still sees only your handwriting, not the printed text; the prompt changes needed for that are intentionally not made without a labeled evaluation on worksheet pages. When writing is spread over a very tall canvas, empty vertical bands between lines are squeezed in the checker's image so lines stay readable; ordinary canvases are sent exactly as before.
- **Speech:** browser speech where it is good, server-generated speech where it is not, with the browser voice as the fallback.
- **Tutor solutions** are plain LaTeX lines (MathJax with the base and AMS packages only); a line that cannot be typeset is shown as plain text.
- **No accounts, no database, English only.** Nothing is saved between visits: pages, worksheets and chat history live in the browser tab. Settings (mode, pen size, voice, theme, access code) are kept in `localStorage` under `iterraai.*`; settings saved under the former name (`mathboard.*`) are still read.
- **The project was renamed from "Math Board" to IterraAI;** only the repository folder may still be called `mathboard`.

## Known limits

- Accuracy on real handwriting has **not** been measured: the test suite runs against a mock Gemini server. Use the trace panel and `npm run eval` to measure it.
- Not verified: real speech voices on every browser, iPad Safari with Apple Pencil, and a live Vercel deployment.
- Rate limiting and model-health tracking are per server instance and best effort.
- Moving a worksheet or a note, and deleting either, cannot be undone.
- Sheets are rendered at a fixed resolution, so they soften above roughly 300 % zoom.
- Thinking-config names for newer Gemini models and the `-latest` aliases follow the prototype and may need pinning through `JUDGE_MODELS`.
