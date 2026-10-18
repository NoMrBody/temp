// A tiny stand-in for the Gemini REST API, used by the e2e tests (no real key needed).
//   GET  /v1beta/models                       model list
//   POST /v1beta/models/<m>:generateContent   Judge / Verifier / Coach, chosen by the system prompt
//   POST /__scenario {judge, verifier, coach, delayMs}   what to answer
//   POST /__reset                             clear scenario and recorded calls
//   GET  /__calls                             recorded requests (without images)
import http from "node:http";

const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];

const fresh = () => ({
  judge: { lines: [], stage: "in_progress", feedback: "" },
  verifier: { verdict: "valid", hint: "" },
  coach: { hint: "Okay, different angle: look at that line again." },
  chat: { intent: "answer", message: "ok", solution_lines: [] },
  delayMs: 0,
});

export function startMock(port = 0) {
  let scenario = fresh();
  let calls = [];
  let judgeIdx = 0;
  let chatIdx = 0;

  const send = (res, status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  const envelope = (payload) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: "STOP" }] });
  const readBody = (req) =>
    new Promise((resolve) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => resolve(b));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/v1beta/models") {
      calls.push({ kind: "models" });
      return send(res, 200, { models: MODELS.map((m) => ({ name: "models/" + m, supportedGenerationMethods: ["generateContent"] })) });
    }
    if (req.method === "POST" && url.pathname === "/__scenario") {
      scenario = { ...fresh(), ...JSON.parse((await readBody(req)) || "{}") };
      judgeIdx = 0;
      chatIdx = 0;
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/__reset") {
      scenario = fresh();
      calls = [];
      judgeIdx = 0;
      chatIdx = 0;
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/__calls") return send(res, 200, calls);

    const m = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(url.pathname);
    if (req.method === "POST" && m) {
      const body = JSON.parse((await readBody(req)) || "{}");
      const sys = body.systemInstruction?.parts?.[0]?.text ?? "";
      const parts = body.contents?.[0]?.parts ?? [];
      const context = parts.map((p) => p.text).filter(Boolean).join("\n");
      const hasImage = parts.some((p) => p.inlineData);
      const kind = sys.includes("has NOT fixed this mistake")
        ? "coach"
        : sys.includes("second reviewer")
          ? "verifier"
          : sys.includes("chat next to their math notebook")
            ? "chat"
            : "judge";
      const allParts = (body.contents ?? []).flatMap((c) => c.parts ?? []);
      calls.push({ kind, model: m[1], context, hasImage,
        hasPdf: allParts.some((p) => p.inlineData?.mimeType === "application/pdf"),
        turns: (body.contents ?? []).length,
        focusPage: Number(/looking at page (\d+) of (\d+)/.exec(JSON.stringify(allParts))?.[1] ?? 0) || undefined,
        hasCanvas: allParts.some((p) => p.inlineData?.mimeType === "image/png"),
        message: kind === "chat" ? (parts.at(-1)?.text ?? "") : undefined, key: req.headers["x-goog-api-key"] ? "header" : "none", thinking: body.generationConfig?.thinkingConfig ?? null });
      if (scenario.delayMs) await new Promise((r) => setTimeout(r, scenario.delayMs));
      if (kind === "verifier") {
        if (scenario.verifier === "500") return send(res, 500, { error: { message: "mock verifier failure" } });
        return send(res, 200, envelope({ read_text: "read", correct_step: "step", reason: "because", hint: "", ...scenario.verifier }));
      }
      if (kind === "chat") {
        const c = Array.isArray(scenario.chat) ? scenario.chat[Math.min(chatIdx++, scenario.chat.length - 1)] : scenario.chat;
        return send(res, 200, envelope(c));
      }
      if (kind === "coach") return send(res, 200, envelope(scenario.coach));
      const j = Array.isArray(scenario.judge) ? scenario.judge[Math.min(judgeIdx++, scenario.judge.length - 1)] : scenario.judge;
      return send(res, 200, envelope({ is_relevant: true, issue_is_new: true, feedback: "", plot: "", ...j, lines: (j.lines ?? []).map((l) => ({ plot: "", ...l })) }));
    }
    send(res, 404, { error: { message: "not found" } });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startMock(Number(process.env.PORT ?? 0));
  console.log(`mock gemini listening on http://127.0.0.1:${port}/v1beta`);
}
