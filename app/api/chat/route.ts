import { timingSafeEqual } from "node:crypto";
import { ChatRequestSchema } from "../../../shared/schemas";
import { runChat } from "../../../server/agents/chat";
import type { ModelError } from "../../../server/gemini/client";
import { startDiscovery } from "../../../server/gemini/models";
import { rateLimited } from "../../../server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 4_400_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function POST(request: Request): Promise<Response> {
  const code = process.env.ACCESS_CODE;
  if (code && !sameSecret(request.headers.get("x-access-code") ?? "", code)) return json(401, { error: "access_code" });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY) return json(413, { error: "too_large" });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: "too_large" });
  let parsed;
  try {
    parsed = ChatRequestSchema.safeParse(JSON.parse(raw));
  } catch {
    return json(400, { error: "bad_request" });
  }
  if (!parsed.success) return json(400, { error: "bad_request" });
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (rateLimited("chat:" + ip, 30, 60_000)) return json(429, { error: "rate_limited" });
  if (!process.env.GEMINI_API_KEY) {
    return json(200, { error: { message: "The server has no GEMINI_API_KEY configured", fatal: true } });
  }
  startDiscovery();
  const t0 = Date.now();
  try {
    const { res, model, ms } = await runChat(parsed.data, request.signal);
    try {
      console.log(`[chat] ${Date.now() - t0}ms model=${model} intent=${res.intent} pdf=${!!parsed.data.pdf}`);
    } catch {
      /* logging is best effort */
    }
    return json(200, { ...res, model, ms });
  } catch (err) {
    if (request.signal.aborted) return json(499, { error: "aborted" });
    const e = err as Partial<ModelError>;
    return json(200, { error: { message: (err as Error).message || "Unknown error", fatal: e.fatal === true, kind: e.kind || "other" } });
  }
}
