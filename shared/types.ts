export type Persona = "friendly";
export type LineStatus = "ok" | "error" | "skip";
export type Stage = "blank" | "scribble" | "in_progress" | "finished";

export interface SegmentIn {
  tag: number;
  key: string;
  hasNew: boolean;
  announced: boolean;
  vetoed: boolean;
  memoryText?: string;
}

export interface ReminderIn {
  tag: number;
  key: string;
  previousHints: string[];
}

export interface CheckRequest {
  image: string;
  segments: SegmentIn[];
  crops: Record<string, string>;
  lastIssue: string;
  persona: Persona;
  reminders?: ReminderIn[];
}

export interface JudgeLine {
  tag: number;
  text: string;
  status: LineStatus;
  plot: string;
}
export interface JudgeResult {
  lines: JudgeLine[];
  stage: Stage;
  is_relevant: boolean;
  is_correct: boolean;
  issue_is_new: boolean;
  feedback: string;
}
export interface VerifierResult {
  read_text: string;
  correct_step: string;
  reason: string;
  verdict: "confirmed" | "valid" | "unclear";
  hint: string;
}

export type VetoVerdict = "valid" | "unclear" | "cached" | "failed";

export type CheckEvent =
  | { type: "judge"; model: string; ms: number; result: JudgeResult }
  | { type: "verifier"; model: string; ms: number; tag: number; result: VerifierResult }
  | { type: "verifier_failed"; tag: number; ms: number; message: string }
  | { type: "coach"; model: string; ms: number; tag: number; hint: string }
  | {
      type: "final";
      result: JudgeResult;
      vetoes: { tag: number; verdict: VetoVerdict }[];
      addVetoedKeys: string[];
      reminders: { tag: number; hint: string }[];
      outcome: string;
    }
  | { type: "error"; message: string; fatal: boolean; kind: string; status: number };

export type ChatIntent = "hint" | "solution" | "answer";
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}
export interface ChatRequest {
  message: string;
  history: ChatTurn[];
  /** base64 PDF (no data: prefix) the student attached */
  pdf?: { name: string; data: string };
  /** base64 PNG of the student's current page, all ink black, lines tagged */
  canvas?: string;
  /** 1-based PDF page the student is looking at, and how many pages the worksheet has */
  focusPage?: number;
  pageCount?: number;
  persona: Persona;
}
export interface ChatResponse {
  intent: ChatIntent;
  message: string;
  solution_lines: string[];
}
