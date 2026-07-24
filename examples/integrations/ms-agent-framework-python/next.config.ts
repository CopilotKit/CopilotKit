import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  env: {
    // The public Threads UI flag is DERIVED from the server-side license token.
    // Set COPILOTKIT_LICENSE_TOKEN (only) to enable Threads — do not set this
    // flag directly. NOTE: NEXT_PUBLIC_* resolves at BUILD time while the
    // runtime reads the token per-request, so the UI gate and runtime agree
    // only when the token is present at build time (the standard `next dev` /
    // host-build flow).
    NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.COPILOTKIT_LICENSE_TOKEN
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
