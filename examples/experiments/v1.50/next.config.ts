import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Externalize packages with bundling issues (pino has test files that break Turbopack)
  serverExternalPackages: [
    "@copilotkit/runtime",
    "pino",
    "pino-pretty",
    "thread-stream",
  ],
};

export default nextConfig;
