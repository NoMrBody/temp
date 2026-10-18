import type { CheckEvent, CheckRequest } from "../../shared/types";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** POSTs a check and reads the NDJSON stream, calling onEvent for every complete line. */
export async function streamCheck(
  req: CheckRequest,
  accessCode: string,
  signal: AbortSignal,
  onEvent: (e: CheckEvent) => void,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessCode) headers["x-access-code"] = accessCode;
  let res: Response;
  try {
    res = await fetch("/api/check", { method: "POST", headers, body: JSON.stringify(req), signal });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new HttpError(0, "Network error (check your connection)");
  }
  if (!res.ok || !res.body) throw new HttpError(res.status, `HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const flush = (line: string) => {
    const t = line.trim();
    if (!t) return;
    let ev: CheckEvent;
    try {
      ev = JSON.parse(t) as CheckEvent;
    } catch {
      return;
    }
    onEvent(ev);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      flush(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  buf += dec.decode();
  flush(buf);
}
