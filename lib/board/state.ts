import { CLIENT_CONFIG } from "../../shared/config";
import type { BoardState, TutorState, Timers } from "./types";

export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

export function createState(): BoardState {
  const w = parseFloat(store.get("mathboard.pen") ?? "");
  return {
    strokes: [],
    notes: [],
    lastCleared: null,
    current: null,
    activePointer: null,
    tool: "pen",
    penSeen: store.get("mathboard.penSeen") === "1",
    strokeSeq: 0,
    checkedIds: new Set(),
    lineMemory: new Map(),
    version: 0,
    destructiveVersion: 0,
    penWidth: Number.isFinite(w) && w >= 1.5 && w <= 6 ? w : CLIENT_CONFIG.PEN_WIDTH,
  };
}

export function createTutor(): TutorState {
  return {
    announced: new Set(),
    vetoed: new Set(),
    lastIssue: "",
    issueIds: null,
    acked: false,
    issueDismissed: false,
    inflight: null,
    pending: false,
    lastCheckedVersion: 0,
    retries: 0,
    lastStrokeEnd: 0,
    captionSeq: 0,
    lastFeedback: "",
    mode: store.get("mathboard.mode") === "manual" ? "manual" : "auto",
    persona: "friendly",
    openIssues: new Map(),
    accessRequired: false,
    accessCode: store.get("mathboard.accessCode") ?? "",
    fatal: false,
  };
}

export function createTimers(): Timers {
  return { check: undefined, retry: undefined, nudge: undefined, autoHide: undefined };
}
