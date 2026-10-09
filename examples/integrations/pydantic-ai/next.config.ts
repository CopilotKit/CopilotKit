import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Pin the root to this folder. Otherwise a lockfile in a parent folder
  // becomes the workspace root. This value also sets the file tracing root.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  output: "standalone",
  serverExternalPackages: ["@copilotkit/runtime"],
  env: {
    NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.CPK_INTELLIGENCE_API_KEY
      ? "true"
      : "false",
  },
  typescript: {
    // @ag-ui/client's HttpAgent currently exposes private generic types through
    // the runtime route in this example. Keep builds focused on runtime output.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
