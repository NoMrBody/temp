import { defineConfig } from "@playwright/test";

const L = (mode: string, port: number) => ({
  command: `node tests/e2e/launch.mjs ${mode} ${port}`,
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  timeout: 120_000,
});

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", viewport: { width: 1100, height: 700 }, browserName: "chromium" },
  webServer: [L("main", 3100), L("nokey", 3101), L("access", 3102), L("dev", 3103)],
});
