import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@copilotkit/runtime"],
  typescript: {
    // @mastra/memory beta packages have unstable types that break strict checking
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
