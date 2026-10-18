/** Constants shared by client and server. Server-only values live in `SERVER_CONFIG`. */
export const CLIENT_CONFIG = {
  PAUSE_MS: 2000,
  NEW_LINE_FACTOR: 0.5,
  OLD_INK_COLOR: "#9a9a9a",
  NEW_INK_COLOR: "#000000",
  MAX_RETRIES: 3,
  NUDGE_ENABLED: false,
  NUDGE_IDLE_MS: 10000,
  VOICE_PREFER_LOCAL: true,
  GLOW_MS: 2000,
  CAPTION_LINGER_MS: 1800,
  EXPORT_MAX_SIDE: 1024,
  MIN_INK_LENGTH: 14,
  TRACE_MAX: 60,
  PEN_WIDTH: 2.6,
  ERASER_WIDTH: 24,
  INK_COLOR: "#dbe9ff",
  REMIND_MIN_MS: 45000,
  REMIND_IDLE_MS: 30000,
  REMIND_MAX: 3,
} as const;

export const SERVER_CONFIG = {
  DEFAULT_MODEL: "gemini-flash-lite-latest",
  FALLBACK_MODELS: [
    "gemini-flash-lite-latest",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ],
  API_BASE: "https://generativelanguage.googleapis.com/v1beta",
  HEDGE_MS: 8000,
  ATTEMPT_TIMEOUT_MS: 20000,
  THINKING_LEVEL: "minimal",
  MAX_CANDIDATES: 8,
  VERIFIER_ENABLED: true,
  VERIFIER_MODELS: ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"],
  VERIFIER_THINKING_LEVEL: "low",
  VERIFIER_BUDGET: 1024,
  VERIFIER_TIMEOUT_MS: 15000,
  VERIFIER_MAX_PER_CHECK: 2,
  VERIFIER_VETO_ON_UNCLEAR: true,
  VERIFIER_FAIL_OPEN: true,
  MODEL_CACHE_MS: 86400000,
} as const;

export type ServerConfig = {
  -readonly [K in keyof typeof SERVER_CONFIG]: (typeof SERVER_CONFIG)[K] extends readonly string[]
    ? string[]
    : (typeof SERVER_CONFIG)[K] extends string
      ? string
      : (typeof SERVER_CONFIG)[K] extends number
        ? number
        : boolean;
};

export const PERSONA_LABELS = { friendly: "Big brother" } as const;
