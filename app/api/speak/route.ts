import { timingSafeEqual } from "node:crypto";
import { apiBase, apiKey } from "../../../server/gemini/models";
import { rateLimited } from "../../../server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_VOICE = "Charon";

function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function wav(pcm: Buffer, rate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

export async function POST(request: Request): Promise<Response> {
  const code = process.env.ACCESS_CODE;
  if (code && !sameSecret(request.headers.get("x-access-code") ?? "", code)) return fail(401, "access_code");
  const key = apiKey();
  if (!key) return fail(503, "no_key");
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (rateLimited("tts:" + ip, 40, 60_000)) return fail(429, "rate_limited");

  let text = "";
  try {
    text = String(((await request.json()) as { text?: unknown }).text ?? "").trim();
  } catch {
    return fail(400, "bad_request");
  }
  if (!text || text.length > 400) return fail(400, "bad_request");

  const model = process.env.TTS_MODEL || DEFAULT_MODEL;
  const voice = process.env.TTS_VOICE || DEFAULT_VOICE;
  try {
    const res = await fetch(`${apiBase()}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Say casually, like a friendly older brother: ${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
    if (!res.ok) return fail(502, "tts_failed");
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    };
    const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!b64) return fail(502, "tts_empty");
    return new Response(new Uint8Array(wav(Buffer.from(b64, "base64"))), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch {
    return fail(502, "tts_failed");
  }
}
