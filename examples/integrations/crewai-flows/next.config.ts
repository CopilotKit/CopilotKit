import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@copilotkit/runtime"],
  env: {
    // This browser-safe flag contains only key presence, never the key itself.
    NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.CPK_INTELLIGENCE_API_KEY
      ? "true"
      : "false",
  },
  typescript: {
    // HttpAgent type mismatch with CopilotRuntime — pending upstream fix in @copilotkit/runtime
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
