import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  env: {
    // NEXT_PUBLIC_* resolves at build time while the Runtime reads the project key
    // per request. Provide CPK_INTELLIGENCE_API_KEY during the host build so the
    // browser gate matches the managed Runtime configuration.
    NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.CPK_INTELLIGENCE_API_KEY
      ? "true"
      : "false",
  },
  typescript: {
    // The verbatim demo (useFrontendTool/useRenderToolCall parameter shapes)
    // has type drift against the installed @copilotkit/react-core@1.55.2 v2
    // typings — the same demo-vs-installed-types mismatch the sibling examples
    // (mastra, langgraph-python) absorb with this flag.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
