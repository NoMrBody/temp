// Starts a mock Gemini server on a random port, writes the port to a file, then runs Next with
// GEMINI_API_BASE pointing at the mock. Usage: node launch.mjs <mode> <port>
//   mode: main | nokey | access | dev
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMock } from "../mock-gemini/server.mjs";

const [mode, port] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { server, port: mockPort } = await startMock(0);
writeFileSync(join(here, `.mock-port-${mode}`), String(mockPort));

const env = { ...process.env, GEMINI_API_BASE: `http://127.0.0.1:${mockPort}/v1beta`, NEXT_TELEMETRY_DISABLED: "1" };
// Explicit empty strings (not deletes): Next would otherwise fill them in from the developer's .env.local.
for (const k of ["ACCESS_CODE", "GEMINI_API_KEY", "JUDGE_MODELS", "VERIFIER_MODELS", "TTS_MODEL", "TTS_VOICE"]) env[k] = "";
if (mode !== "nokey") env.GEMINI_API_KEY = "test-key-not-real";
if (mode === "access") env.ACCESS_CODE = "letmein";

const next = join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, mode === "dev" ? "dev" : "start", "-p", port], { cwd: root, env, stdio: "inherit" });
const stop = () => {
  child.kill("SIGTERM");
  server.close();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => {
  server.close();
  process.exit(code ?? 0);
});
