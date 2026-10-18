import { SERVER_CONFIG } from "../../shared/config";

export const EXCLUDE_RE =
  /embed|aqa|tts|image|vision|audio|live|robotics|computer-use|imagen|veo|gemma|learnlm|native|thinking-exp|-exp-/i;

export function apiBase(): string {
  return process.env.GEMINI_API_BASE || SERVER_CONFIG.API_BASE;
}

export function apiKey(): string {
  return process.env.GEMINI_API_KEY ?? "";
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ModelState {
  candidates: string[] | null;
  dead: Set<string>;
  cooldown: Map<string, number>;
  noThinkingConfig: Set<string>;
  lastUsed: string;
  discoveryStarted: boolean;
  discoveredAt: number;
}

export const models: ModelState = {
  candidates: null,
  dead: new Set(),
  cooldown: new Map(),
  noThinkingConfig: new Set(),
  lastUsed: "",
  discoveryStarted: false,
  discoveredAt: 0,
};

export function resetModelState(): void {
  models.candidates = null;
  models.dead.clear();
  models.cooldown.clear();
  models.noThinkingConfig.clear();
  models.lastUsed = "";
  models.discoveryStarted = false;
  models.discoveredAt = 0;
}

export function versionOf(name: string): number {
  const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

export function staticList(): string[] {
  const override = envList("JUDGE_MODELS");
  const list = override.length
    ? override
    : [SERVER_CONFIG.DEFAULT_MODEL, ...SERVER_CONFIG.FALLBACK_MODELS];
  return [...new Set(list)].slice(0, SERVER_CONFIG.MAX_CANDIDATES);
}

export function buildCandidates(available: string[] | null): string[] {
  const override = envList("JUDGE_MODELS");
  const preferred = override.length
    ? [...new Set(override)]
    : [...new Set([SERVER_CONFIG.DEFAULT_MODEL, ...SERVER_CONFIG.FALLBACK_MODELS])];
  if (!available || !available.length) return preferred.slice(0, SERVER_CONFIG.MAX_CANDIDATES);
  if (override.length) return preferred.slice(0, SERVER_CONFIG.MAX_CANDIDATES);
  const avail = new Set(available);
  const kept = preferred.filter((m) => avail.has(m) || m.endsWith("-latest"));
  const extras = available
    .filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !EXCLUDE_RE.test(n) && !kept.includes(n))
    .sort((a, b) => {
      const pa = /preview|exp/.test(a) ? 1 : 0;
      const pb = /preview|exp/.test(b) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const va = versionOf(a);
      const vb = versionOf(b);
      if (va !== vb) return vb - va;
      return (/lite/.test(a) ? 0 : 1) - (/lite/.test(b) ? 0 : 1);
    });
  return [...kept, ...extras].slice(0, SERVER_CONFIG.MAX_CANDIDATES);
}

/** Runs once per instance in the background; never awaited by a request. Failures are ignored. */
export function startDiscovery(): void {
  const key = apiKey();
  if (!key) return;
  const stale = Date.now() - models.discoveredAt > SERVER_CONFIG.MODEL_CACHE_MS;
  if (models.discoveryStarted && !stale) return;
  models.discoveryStarted = true;
  void (async () => {
    try {
      const names: string[] = [];
      let pageToken = "";
      for (let page = 0; page < 3; page++) {
        const url =
          `${apiBase()}/models?pageSize=200` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
        const res = await fetch(url, { headers: { "x-goog-api-key": key } });
        if (!res.ok) return;
        const data = (await res.json()) as {
          models?: { name?: string; supportedGenerationMethods?: string[] }[];
          nextPageToken?: string;
        };
        for (const m of data.models ?? []) {
          if (m.name && (m.supportedGenerationMethods ?? []).includes("generateContent")) {
            names.push(m.name.replace(/^models\//, ""));
          }
        }
        pageToken = data.nextPageToken ?? "";
        if (!pageToken) break;
      }
      if (names.length) {
        models.candidates = buildCandidates(names);
        models.discoveredAt = Date.now();
      }
    } catch {
      /* ignore silently */
    }
  })();
}

export function usableCandidates(): string[] {
  const now = Date.now();
  const list = models.candidates ?? buildCandidates(null);
  const alive = list.filter((m) => !models.dead.has(m));
  const ready = alive.filter((m) => (models.cooldown.get(m) ?? 0) <= now);
  return ready.length ? ready : alive;
}

export function verifierCandidates(): string[] {
  const now = Date.now();
  const override = envList("VERIFIER_MODELS");
  const base: string[] = override.length ? override : [...SERVER_CONFIG.VERIFIER_MODELS];
  const pref = base.filter((m) => !models.dead.has(m) && (models.cooldown.get(m) ?? 0) <= now);
  const rest = usableCandidates().filter((m) => !pref.includes(m));
  return [...pref, ...rest];
}
