import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16.3 writes AGENTS.md and CLAUDE.md into the project when `next dev`
  // detects an AI coding agent. Keep the project as it was scaffolded.
  agentRules: false,
  // Pin the root to this folder. Otherwise a lockfile in a parent folder
  // becomes the workspace root. This value also sets the file tracing root.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  // The AG-UI adapter (and the Omnara SDK it imports) runs only in the API
  // route; keep it a plain Node import instead of bundling it.
  serverExternalPackages: ["@ag-ui/omnara"],
};

export default nextConfig;
