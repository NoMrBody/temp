# Math Board

A handwritten-math tutor on a full-screen canvas (Next.js App Router + TypeScript). The student writes with a pen, stylus, finger or mouse; a multi-agent pipeline on the server (Judge → Verifier → Coach, driven by a plain-code Orchestrator) puts a green tick next to every line that checks out, and when a line is wrong it makes that ink glow and says one or two short sentences. Everything else stays silent.

The Gemini key lives only in a server-side environment variable. The browser never receives it.

## Setup

```bash
npm install
cp .env.example .env.local        # fill in GEMINI_API_KEY
npm run dev                       # http://localhost:3000
```

| Variable | Required | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | yes | Gemini API key. Server only. Never logged, never sent to the client. |
| `ACCESS_CODE` | no | If set, `/api/check` requires header `x-access-code`. The UI asks for it in a modal. |
| `GEMINI_API_BASE` | no | Defaults to `https://generativelanguage.googleapis.com/v1beta` (tests point it at the mock). |
| `JUDGE_MODELS` | no | Comma-separated model list, overrides the default list (use it to pin stable models). |
| `VERIFIER_MODELS` | no | Comma-separated override for the Verifier list. |
| `TTS_MODEL` / `TTS_VOICE` | no | Server-side speech (`POST /api/speak`, default `gemini-2.5-flash-preview-tts`, voice `Charon`). Falls back to the browser voice if it fails. |

`GET /api/health` → `{ ok, keyConfigured, accessRequired }`.

## Scripts

`dev`, `build`, `start`, `lint`, `typecheck`, `test` (vitest), `test:e2e` (Playwright, uses the mock Gemini server and needs `npm run build` first), `eval` (offline replay of labeled traces with the real key).

## Deploy (Vercel)

1. Push the repository (it contains no secrets). 2. Import it in Vercel (Next.js preset, Node 22). 3. Settings → Environment Variables: add `GEMINI_API_KEY` (mark Sensitive), optionally `ACCESS_CODE`, `JUDGE_MODELS`, `VERIFIER_MODELS`, for Production and Preview. 4. Redeploy. 5. Open `/api/health` and confirm `keyConfigured: true`. 6. `maxDuration` is 60 s in `app/api/check/route.ts`; if your plan allows less, lower it and `VERIFIER_TIMEOUT_MS` in `shared/config.ts`.

## Dark and light mode

The sun/moon button in the toolbar switches theme; the choice is stored (`mathboard.theme`) and applied by a tiny inline script before the first paint, so there is no flash. Dark is the default (the spec's dark UI); the operating system's preference is not followed. Colours are CSS variables in `app/globals.css` (`html[data-theme="light"]` overrides). In light mode ink is dark navy (existing ink flips too), tutor notes and the red mistake glow use darker tones, the graph panel has a light palette, and worksheet sheets keep their white paper with a softer shadow. Exports (Judge image, PDF) never depend on the theme.

## Worksheets, chat and pages

- **Open PDF** (📄 in the page bar, or 📎 in the chat): all pages of the PDF are laid out one below the other as white sheets floating on the canvas (rendered with `pdfjs-dist`, 820 world units wide, max 30 pages, 2.6 MB). You write on them with the pen; ink is dark on a sheet and light on the grid. A worksheet belongs to the canvas page it was opened on (`✕` in the chat removes it; the ink stays).
- **Move around:** the canvas is unbounded. Wheel / two-finger scroll pans, Ctrl+wheel or a trackpad pinch zooms around the cursor, two fingers pinch/pan on touch screens (with a stylus in use, one finger pans), the **Move** tool (H), holding Space or the middle mouse button also pan. The page bar has −/%/+ and ⤢ (also key `0`) to fit the worksheet to the screen. Zoom is 25 %–400 %.
- **Chat (button or `C`):** `POST /api/chat` sends the whole PDF (as a Gemini attachment), a picture of your writing, which PDF page is in the middle of your screen, and the last chat turns. Ask e.g. "help me with problem 2b" — the tutor finds it anywhere in the PDF. It answers with one of three intents: **hint** (the default; shown in the small window top-left and in the chat; never the final answer), **solution** (only when you explicitly ask; typeset as LaTeX with MathJax and placed on the canvas in green in the free space right of the sheets, level with what you are looking at; the view pans to it) or **answer** (anything else).
- **Tutor notes** are typeset LaTeX (one line per step; a line MathJax cannot parse is shown as plain text). Each note has handles above it: ✥ drag it anywhere (also while panning/zooming), × remove it. They are not your ink: never sent to the Judge, untouched by the eraser, removed by Clear (not by Undo), and included in the PDF export. MathJax is loaded on first use (`mathjax-full/es5/tex-svg.js`, packages base+ams only).
- **Pages** (`+`, ‹ ›): each canvas page has its own ink, worksheet, view, undo and tutor memory. **PDF** exports every canvas page: one PDF page per worksheet sheet, holding the sheet, the writing and tutor notes closest to it. That page is made just large enough to contain all of them completely (notes beside the sheet widen it, nothing is cropped or drawn twice). A plain canvas exports as one page.
- **Judge on tall canvases:** when writing spans so much height that the image sent to the Judge would shrink below 0.8×, empty vertical bands (> 100 px) between lines are squeezed to 60 px, so lines stay as readable as on a small canvas. Small canvases are exported exactly as before. The Judge still sees only your ink (the printed text is not in its image) — the spec's Phase 2 prompt changes were not made.
- Decisions: the PDF is re-sent with every chat message (stateless server, no Files API; Vercel's ~4.5 MB body limit is why the PDF is capped at 2.6 MB); solutions are plain text with Unicode math, no LaTeX; the chat uses the Verifier model list with its thinking settings and 4096 output tokens; sheets are rendered at 1400 px wide and at most 8 stay in memory; ticks follow panning/zooming (hidden when off screen), the red glow stops when the view moves.
- Not saved between visits: pages, worksheets, chat history. The model's worked solutions are not verified by anything — check them.

## Layout

`app/` routes and shell · `components/Board.tsx` markup (Appendix D as JSX) · `lib/board/*` browser-only canvas engine, tutor loop, marks, glow, voice, graph, trace · `server/*` Gemini REST client, prompts, agents, orchestrator · `shared/*` config, types, zod schemas, outcome helpers · `tests/unit` vitest · `tests/e2e` Playwright · `tests/mock-gemini` mock server · `evals/run.ts` offline eval runner. `lib/` never imports `server/` and vice versa.

## Tests

- `npm test` — 79 unit tests: expression parser table, segmentation (the 1917×793 four-line layout, erased strokes, fractions), orchestrator invariants, Gemini client (thinking-config retry, cooldowns, dead models, timeouts vs aborts, hedging, fatal errors), zod schemas, rate limit, and byte-for-byte snapshot tests of the Judge/Verifier prompts and schemas against Appendix B.
- `npm run test:e2e` — Playwright against `next start` with the mock Gemini server (random port, written to `tests/e2e/.mock-port-<mode>` by `tests/e2e/launch.mjs`). It starts four servers: main, no key, `ACCESS_CODE=letmein`, and `next dev` (for the StrictMode double-mount check). Screenshots of scenarios 1, 5 and 6 land in `test-results/screenshots/`.

## Decisions

Decisions taken without asking, as the spec requires:

- **`EXCLUDE_RE`** and the **voice-preference regexes** were referenced but not given. I wrote `/embed|aqa|tts|image|vision|audio|live|robotics|computer-use|imagen|veo|gemma|learnlm|native|thinking-exp|-exp-/i` and Edge "Natural" male names, then `Aaron|Alex|Evan|Nathan|Tom|Fred`, then `David|Mark`.
- **Helpers not in Appendix E** (`drawFullStroke`, incremental drawing, `boxesOverlap`, `growBox`, `rrect`, …) were written to match the described behavior (quadratic midpoints, min widths 1.6/4, eraser as `destination-out`).
- **Appendix E.1/E.4** contain two garbled comment openers; they were ignored (code is unaffected).
- **Reminders (Section 10):** a 1 s client clock re-checks in Auto mode when an open issue is due and the pen has been idle ≥ 30 s. To avoid hammering the server if the Coach fails, each attempt also stamps `lastAttemptAt`, which is used together with `lastSpokenAt` for the 45 s spacing. Only one reminder is spoken per check, and never while the voice is busy or when a new mistake was announced.
- **Fatal errors** (no key, bad Google key, 401) set `tutor.fatal`, which stops further automatic checks until reload (or until the access code is saved).
- **Persona switch** is built but only rendered when `PERSONA_LABELS` has more than one entry (today: one). `PERSONA_LABELS` lives in `shared/config.ts` because the persona *text* must stay server-side.
- **Test hooks in production code:** `data-*` attributes (`#board[data-strokes]`, `#glow[data-glow-count]`, `#trace[data-last]`, `.tick[data-tag]`) so Playwright can assert observable outcomes. The reminder e2e shifts `Date.now()` from an init script instead of waiting 30–45 s.
- **`allowedDevOrigins: ["127.0.0.1"]`** in `next.config.ts` only affects `next dev`.
- Unit tests use `@napi-rs/canvas` (dev dependency) so the real ink-visibility replay runs in Node.
- The graph panel's Reset test checks that Reset changes the zoomed view rather than pixel equality with the first render (hover state made the latter flaky).

## Open questions

- Thinking-config names for 3.x models (`thinkingLevel: "minimal" | "low"`) and the `-latest` aliases are exactly as in the prototype but unverified against today's API; the 400-"thinking" retry covers rejection.
- The rate limit and model-health state (`cooldown`, `dead`) are per serverless instance; on Vercel they reset on cold starts.
- Verifier crops are skipped when the client has no crop for a flagged line (fail-open means the Judge's hint is spoken unverified, as specified).
- Phase 2 is only partly built: worksheets on the canvas and pan/zoom exist, but the Judge/Verifier prompts were not changed for printed content (see above). `evals/run.ts` exists but has not been run (it needs real labeled traces and a key).
- `maxDuration = 60` may exceed hobby-plan limits.

## Manual QA on the real model (author)

Write correct lines; a deliberate sign error; two mistakes at once; a fixed mistake; a doodle; a star; `y=2x²` then `y'=4x+2`; two equations side by side. Label each check in the trace panel, then **Export JSON** and feed the file to `npm run eval`.

## Honest limits

Verified with the mock Gemini server only: pipeline plumbing, orchestration rules, the canvas engine, UI behavior, error paths. **Not verified:** the accuracy of the real Judge/Verifier on real handwriting, real speech-synthesis voices, iPad/Apple Pencil, and Vercel deployment. Prompts, schemas and thresholds are the prototype's, unchanged.
