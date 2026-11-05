import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Pin the root here so a lockfile in a parent folder is never picked up.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  // The runtime pulls in server-only dependencies; keep them out of the bundle.
  serverExternalPackages: ["@copilotkit/runtime"],
  // A self-contained server for the Docker image.
  output: "standalone",
  // Do not write an AGENTS.md into the project on `next dev`.
  agentRules: false,
  devIndicators: false,
  // Repository cards show the owner's GitHub avatar.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
