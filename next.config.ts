import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // dev server only: lets the Playwright run (which uses 127.0.0.1) hydrate under `next dev`
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
