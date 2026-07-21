import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  env: {
    // This browser-safe flag contains only key presence, never the key itself.
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
