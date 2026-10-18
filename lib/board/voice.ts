import { CLIENT_CONFIG } from "../../shared/config";
import { store } from "./state";
import type { Ctx, VoiceApi } from "./types";

const MALE_US_VOICES = [
  /Microsoft (Guy|Davis|Andrew|Brian|Christopher|Eric|Roger|Steffan|Ryan).*Natural/i,
  /Microsoft.*Natural.*(Guy|Davis|Andrew|Brian|Christopher|Eric|Roger|Steffan)/i,
  /\b(Aaron|Alex|Evan|Nathan|Tom|Fred)\b/i,
  /\b(David|Mark)\b/i,
];

// ~100 ms of silence, played on the first gesture so later audio is allowed to start.
function silentWavUrl(): string {
  const n = 2400;
  const buf = new ArrayBuffer(44 + n * 2);
  const d = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  d.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true);
  d.setUint16(22, 1, true);
  d.setUint32(24, 24000, true);
  d.setUint32(28, 48000, true);
  d.setUint16(32, 2, true);
  d.setUint16(34, 16, true);
  str(36, "data");
  d.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export function createVoice(ctx: Ctx): VoiceApi {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const v = {
    enabled: store.get("mathboard.voice") !== "off",
    chosen: null as SpeechSynthesisVoice | null,
    unlocked: false,
    seq: 0,
    current: null as SpeechSynthesisUtterance | null,
    audio: null as HTMLAudioElement | null,
    serverOk: true,
    /** Firefox (robotic voices) and Brave (speech blocked) get the Gemini voice; Chrome/Edge/Safari use their own. */
    preferServer: typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent),
  };
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }) : null;
  void nav?.brave?.isBrave?.().then((b) => {
    if (b) v.preferServer = true;
  });
  const browserCanSpeak = () => supported && speechSynthesis.getVoices().length > 0;
  const shouldUseServer = () => v.preferServer || !browserCanSpeak();

  const audioJobs = new Map<string, Promise<string | null>>();

  /** Fetches (once) the server-made audio for a text. Resolves a blob URL, or null if unavailable. */
  function fetchAudio(text: string): Promise<string | null> {
    const hit = audioJobs.get(text);
    if (hit) return hit;
    const job = (async () => {
      if (!v.serverOk) return null;
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (ctx.tutor.accessCode) headers["x-access-code"] = ctx.tutor.accessCode;
        const res = await fetch("/api/speak", { method: "POST", headers, body: JSON.stringify({ text }), signal: ctx.signal });
        if (!res.ok) {
          if (res.status !== 429) v.serverOk = false;
          return null;
        }
        return URL.createObjectURL(await res.blob());
      } catch {
        return null;
      }
    })();
    audioJobs.set(text, job);
    void job.then((u) => {
      if (!u) audioJobs.delete(text);
    });
    return job;
  }

  /** Natural voice from the server (same on every browser). Resolves false if it could not play. */
  async function speakServer(text: string, mySeq: number, onStart?: () => void): Promise<boolean> {
    const url = await fetchAudio(text);
    if (!url) return false;
    if (mySeq !== v.seq) return true;
    const a = v.audio ?? new Audio();
    v.audio = a;
    a.src = url;
    return new Promise<boolean>((resolve) => {
      let started = false;
      const done = (ok: boolean) => {
        a.onended = a.onerror = a.onplaying = null;
        if (mySeq === v.seq) card().classList.remove("speaking");
        resolve(ok || started);
      };
      a.onplaying = () => {
        started = true;
        if (mySeq === v.seq && onStart) onStart();
      };
      a.onended = () => done(true);
      a.onerror = () => done(false);
      card().classList.add("speaking");
      a.play().catch(() => done(false));
    });
  }

  const { timers } = ctx;
  const card = () => ctx.$("card");

  function updateVoiceButton() {
    const b = ctx.$("voiceBtn");
    b.classList.toggle("active", v.enabled && supported);
    b.title = v.enabled ? "Voice on (M)" : "Voice off (M)";
    ctx.$("voiceOnIcon").style.display = v.enabled ? "" : "none";
    ctx.$("voiceOffIcon").style.display = v.enabled ? "none" : "";
  }

  function pickVoice() {
    if (!supported) return;
    const all = speechSynthesis.getVoices();
    if (!all.length) return;
    const us = all.filter((x) => /^en[-_]US/i.test(x.lang));
    let found: SpeechSynthesisVoice | undefined;
    const pool = CLIENT_CONFIG.VOICE_PREFER_LOCAL ? us.filter((x) => x.localService) : us;
    for (const re of MALE_US_VOICES) {
      found = pool.find((x) => re.test(x.name));
      if (found) break;
    }
    if (!found && CLIENT_CONFIG.VOICE_PREFER_LOCAL) found = pool.find((x) => /male|david|mark|alex|tom|fred/i.test(x.name)) || pool[0];
    v.chosen = found || us[0] || all.find((x) => /^en/i.test(x.lang)) || null;
    updateVoiceButton();
  }

  function stop() {
    v.seq++;
    if (v.audio) {
      v.audio.pause();
      v.audio.onended = v.audio.onerror = v.audio.onplaying = null;
    }
    if (supported) {
      try {
        speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    v.current = null;
    card().classList.remove("speaking");
  }

  async function speak(text: string, onStart?: () => void): Promise<boolean> {
    if (!v.enabled || !text) return false;
    const seq = ++v.seq;
    if (v.audio) v.audio.pause();
    if (shouldUseServer()) {
      if (await speakServer(text, seq, onStart)) return true;
      if (seq !== v.seq) return false;
    }
    v.seq--;
    return speakBrowser(text, onStart);
  }

  function speakBrowser(text: string, onStart?: () => void): Promise<boolean> {
    return new Promise((resolve) => {
      if (!supported || !v.enabled || !text) return resolve(false);
      const mySeq = ++v.seq;
      const busy = speechSynthesis.speaking || speechSynthesis.pending;
      if (busy) speechSynthesis.cancel();
      setTimeout(
        () => {
          if (mySeq !== v.seq) return resolve(false);
          const u = new SpeechSynthesisUtterance(text);
          if (v.chosen) u.voice = v.chosen;
          u.lang = v.chosen?.lang || "en-US";
          u.rate = 1.05;
          u.pitch = 0.95;
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(safety);
            if (v.current === u) v.current = null;
            if (mySeq === v.seq) card().classList.remove("speaking");
            resolve(true);
          };
          const safety = setTimeout(finish, 4000 + text.length * 120);
          u.onstart = () => {
            if (mySeq === v.seq && onStart) onStart();
          };
          u.onend = finish;
          u.onerror = finish;
          v.current = u;
          card().classList.add("speaking");
          speechSynthesis.speak(u);
        },
        busy ? 120 : 0,
      );
    });
  }

  function hideCard() {
    clearTimeout(timers.autoHide);
    card().classList.remove("show", "dim");
  }

  function showCard(kind: "bad" | "ok" | "nudge", text: string) {
    if (!text) return;
    const c = card();
    clearTimeout(timers.autoHide);
    c.dataset.kind = kind;
    ctx.$("cardText").textContent = text;
    c.classList.remove("show", "dim");
    ctx.tutor.lastFeedback = text;

    const shownAt = ++ctx.tutor.captionSeq;
    let shown = false;
    const reveal = () => {
      if (shown || shownAt !== ctx.tutor.captionSeq) return;
      shown = true;
      void c.offsetWidth;
      c.classList.add("show");
      if (ctx.state.activePointer !== null) c.classList.add("dim");
    };
    reveal(); // the caption does not wait for the voice (server speech takes a moment)
    void speak(text, reveal).then((spoke) => {
      reveal();
      if (shownAt !== ctx.tutor.captionSeq) return;
      const linger = spoke ? CLIENT_CONFIG.CAPTION_LINGER_MS : Math.max(3500, text.length * 70);
      timers.autoHide = setTimeout(() => {
        if (shownAt === ctx.tutor.captionSeq) hideCard();
      }, linger);
    });
  }

  return {
    init() {
      updateVoiceButton();
      if (!supported) return;
      pickVoice();
      speechSynthesis.addEventListener("voiceschanged", pickVoice, { signal: ctx.signal });
    },
    unlock() {
      if (v.unlocked) return;
      if (!v.audio) {
        v.audio = new Audio(silentWavUrl());
        void v.audio.play().catch(() => undefined);
      }
      if (!supported) return;
      v.unlocked = true;
      try {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        if (v.chosen) u.voice = v.chosen;
        speechSynthesis.speak(u);
      } catch {
        /* ignore */
      }
    },
    prefetch(text: string) {
      if (v.enabled && text && shouldUseServer()) void fetchAudio(text);
    },
    stop,
    speaking: () => !!v.current || (!!v.audio && !v.audio.paused && !v.audio.ended) || (supported && (speechSynthesis.speaking || speechSynthesis.pending)),
    showCard,
    hideCard,
    toggle() {
      v.enabled = !v.enabled;
      store.set("mathboard.voice", v.enabled ? "on" : "off");
      if (!v.enabled) stop();
      updateVoiceButton();
    },
  };
}
