import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16.3 writes AGENTS.md and CLAUDE.md into the project when `next dev`
  // detects an AI coding agent. Keep the project as it was scaffolded.
  agentRules: false,
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  // The Anthropic SDK and the AG-UI adapter run only in the API route; keep
  // them as plain Node requires instead of bundling them.
  serverExternalPackages: ["@anthropic-ai/sdk", "@ag-ui/claude-managed-agents"],
};

export default nextConfig;
