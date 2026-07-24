import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@copilotkit/runtime"],
  env: {
    NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.COPILOTKIT_LICENSE_TOKEN
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
