import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const integrationDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(integrationDirectory, "../../..");
const runtimeEntry =
  process.env.COPILOTKIT_SHOWCASE_RUNTIME_ENTRY ??
  resolve(repositoryRoot, "packages/runtime/dist/v2/index.mjs");

const nextConfig: NextConfig = {
  // The experimental integration builds against this PR's runtime output.
  // Remove this alias after the first release containing AcpAgent.
  outputFileTracingRoot: repositoryRoot,
  webpack(config) {
    config.resolve.alias["@copilotkit/runtime/v2$"] = runtimeEntry;
    return config;
  },
  // Allow iframe embedding from the showcase shell
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
