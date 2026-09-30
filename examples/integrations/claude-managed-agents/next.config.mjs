import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  // The Anthropic SDK and the AG-UI adapter run only in the API route; keep
  // them as plain Node requires instead of bundling them.
  serverExternalPackages: ["@anthropic-ai/sdk", "@ag-ui/claude-managed-agents"],
};

export default nextConfig;
