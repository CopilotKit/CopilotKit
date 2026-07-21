import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["pino", "thread-stream"],
  env: {
    // This browser-safe flag contains only key presence, never the key itself.
    NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.CPK_INTELLIGENCE_API_KEY
      ? "true"
      : "false",
  },
};

export default nextConfig;
