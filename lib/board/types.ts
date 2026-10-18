import type { CheckRequest, JudgeResult, Persona, VerifierResult } from "../../shared/types";
import type { View } from "./viewmath";

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Stroke {
  id: number;
  tool: "pen" | "eraser";
  width: number;
  pts: Pt[];
  /** started on a white worksheet page: always dark ink there, whatever the theme */
  sheet?: true;
  final?: true;
  bb?: Box;
}
export interface Segment {
  tag: number;
  box: Box;
  strokes: Stroke[];
  key: string;
  hasNew: boolean;
  refH: number;
}

export interface Note {
  x: number;
  y: number;
  /** em size in world units */
  fontSize: number;
  /** one LaTeX string per line */
  lines: string[];
}

export interface BoardState {
  strokes: Stroke[];
  notes: Note[];
  lastCleared: Stroke[] | null;
  current: Stroke | null;
  activePointer: number | null;
  tool: "pen" | "eraser" | "hand";
  penSeen: boolean;
  strokeSeq: number;
  checkedIds: Set<number>;
  lineMemory: Map<string, string>;
  version: number;
  destructiveVersion: number;
  penWidth: number;
}

export interface OpenIssue {
  hints: string[];
  times: number;
  lastSpokenAt: number;
  lastAttemptAt?: number;
}

export interface Job {
  version: number;
  ctrl: AbortController;
}

export interface TutorState {
  announced: Set<string>;
  vetoed: Set<string>;
  lastIssue: string;
  issueIds: Set<number> | null;
  acked: boolean;
  issueDismissed: boolean;
  inflight: Job | null;
  pending: boolean;
  lastCheckedVersion: number;
  retries: number;
  lastStrokeEnd: number;
  captionSeq: number;
  lastFeedback: string;
  mode: "auto" | "manual";
  persona: Persona;
  openIssues: Map<string, OpenIssue>;
  accessRequired: boolean;
  accessCode: string;
  fatal: boolean;
}

export interface Timers {
  check: ReturnType<typeof setTimeout> | undefined;
  retry: ReturnType<typeof setTimeout> | undefined;
  nudge: ReturnType<typeof setTimeout> | undefined;
  autoHide: ReturnType<typeof setTimeout> | undefined;
}

export interface Mark {
  kind: "tick" | "plot";
  el: HTMLElement;
  box: Box;
  /** world-space centre of the badge; its screen position follows the view */
  anchor: Pt;
  refH: number;
  strokes: Stroke[];
}

export interface MarksApi {
  marks: Mark[];
  addTick(seg: Segment): void;
  addPlotButton(seg: Segment, expr: string, label: string): void;
  removeMarks(pred: (m: Mark) => boolean): void;
  reposition(): void;
  onInkErased(eraser: Stroke): void;
  onInkAdded(pen: Stroke): void;
  touchedSince(seg: Segment, captured: Set<number>): boolean;
}
export interface GlowApi {
  start(seg: Segment): void;
  stop(): void;
}
export interface VoiceApi {
  init(): void;
  unlock(): void;
  stop(): void;
  prefetch(text: string): void;
  speaking(): boolean;
  showCard(kind: "bad" | "ok" | "nudge", text: string): void;
  hideCard(): void;
  toggle(): void;
}
export interface GraphApi {
  addSeries(expr: string, label: string): void;
}

export interface TraceStep {
  agent: "Judge" | "Verifier" | "Coach";
  model: string;
  ms: number;
  summary: string;
  judge?: JudgeResult;
  verifier?: VerifierResult;
  coach?: { tag: number; hint: string };
  tag?: number;
}
export interface TraceRecord {
  id: number;
  time: number;
  request: { segments: CheckRequest["segments"]; lastIssue: string; persona: Persona };
  image: string;
  crops: Record<string, string>;
  steps: TraceStep[];
  outcome: string;
  label: "" | "right" | "false" | "missed";
}
export interface TraceApi {
  start(req: CheckRequest): TraceRecord;
  step(rec: TraceRecord, step: TraceStep): void;
  done(rec: TraceRecord, outcome: string): void;
  toggle(): void;
}

export interface CanvasApi {
  redrawAll(): void;
  redrawNotes(): void;
  undo(): void;
  clearCanvas(): void;
  markChanged(destructive: boolean): void;
  resize(): void;
  updateHint(): void;
  syncCursor(): void;
}

export interface NotesUiApi {
  sync(): void;
}

export interface ChatApi {
  toggle(): void;
  open(): void;
  openFile(): void;
  refresh(): void;
}

export interface Sheet {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bitmap: HTMLCanvasElement | null;
  rendering: Promise<void> | null;
}
export interface Worksheet {
  name: string;
  /** base64 of the original PDF, sent to the tutor */
  data: string;
  doc: unknown;
  sheets: Sheet[];
}
export interface SheetsApi {
  load(bytes: Uint8Array, name: string, data: string): Promise<number>;
  clear(): void;
  draw(): void;
  contains(p: Pt): boolean;
  /** index (0-based) of the sheet nearest to the middle of the screen, or -1 */
  focusIndex(): number;
  bounds(): Box | null;
  renderBitmap(sheet: Sheet, w?: Worksheet): Promise<HTMLCanvasElement | null>;
}
export interface ViewApi {
  set(v: View): void;
  panBy(dx: number, dy: number): void;
  zoomAt(factor: number, cx: number, cy: number): void;
  fit(): void;
  reveal(box: Box): void;
  refreshNow(): void;
}

export interface PagesApi {
  goTo(i: number, insertBlank?: boolean): void;
  addPage(): void;
  exportPdf(): Promise<void>;
  count(): number;
  index(): number;
}

export interface TutorApi {
  onStrokeStart(tool: "pen" | "eraser", clientY: number): void;
  onStrokeEnd(): void;
  runCheck(force?: boolean): Promise<void>;
  manualCheck(): void;
  cancelInflight(): void;
  setMode(m: "auto" | "manual"): void;
  resetSession(): void;
  setStatus(kind: "idle" | "busy" | "err", text?: string, onClick?: () => void): void;
  openAccessModal(): void;
}

export interface Ctx {
  root: HTMLElement;
  signal: AbortSignal;
  $(id: string): HTMLElement;
  state: BoardState;
  tutor: TutorState;
  timers: Timers;
  dpr: number;
  reduceMotion: boolean;
  board: HTMLCanvasElement;
  bctx: CanvasRenderingContext2D;
  sheetsCanvas: HTMLCanvasElement;
  sctx: CanvasRenderingContext2D;
  notesCanvas: HTMLCanvasElement;
  nctx: CanvasRenderingContext2D;
  glowCanvas: HTMLCanvasElement;
  gctx: CanvasRenderingContext2D;
  /** Phase-2 readiness: identity transforms between screen and world space. */
  toScreen(p: Pt): Pt;
  toWorld(p: Pt): Pt;
  viewW(): number;
  viewH(): number;
  theme(): "dark" | "light";
  marks: MarksApi;
  glow: GlowApi;
  voice: VoiceApi;
  graph: GraphApi;
  trace: TraceApi;
  canvas: CanvasApi;
  chat: ChatApi;
  notesUi: NotesUiApi;
  sheets: SheetsApi;
  viewApi: ViewApi;
  view: View;
  worksheet: Worksheet | null;
  tutorApi: TutorApi;
  pages: PagesApi;
}
