import { timingSafeEqual } from "node:crypto";
import { CheckRequestSchema } from "../../../shared/schemas";
import type { CheckEvent } from "../../../shared/types";
import { startDiscovery } from "../../../server/gemini/models";
import { runCheck } from "../../../server/orchestrator";
import { rateLimited } from "../../../server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 4_000_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export async function POST(request: Request): Promise<Response> {
  const code = process.env.ACCESS_CODE;
  if (code && !sameSecret(request.headers.get("x-access-code") ?? "", code)) {
    return json(401, { error: "access_code" });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return json(413, { error: "too_large" });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: "too_large" });
  let parsed;
  try {
    parsed = CheckRequestSchema.safeParse(JSON.parse(raw));
  } catch {
    return json(400, { error: "bad_request" });
  }
  if (!parsed.success) return json(400, { error: "bad_request" });
  const req = parsed.data;

  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (rateLimited(ip)) return json(429, { error: "rate_limited" });

  const enc = new TextEncoder();
  const headers = {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  };

  if (!process.env.GEMINI_API_KEY) {
    const ev: CheckEvent = {
      type: "error",
      message: "The server has no GEMINI_API_KEY configured",
      fatal: true,
      kind: "nokey",
      status: 0,
    };
    return new Response(JSON.stringify(ev) + "\n", { status: 200, headers });
  }

  startDiscovery();
  const t0 = Date.now();
  const types: string[] = [];
  const models: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: CheckEvent) => {
        if (closed) return;
        types.push(e.type);
        if ("model" in e) models.push(e.model);
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      await runCheck(req, emit, request.signal);
      try {
        console.log(`[check] ${Date.now() - t0}ms models=${[...new Set(models)].join(",")} events=${types.join(",")}`);
      } catch {
        /* logging is best effort */
      }
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { status: 200, headers });
}
