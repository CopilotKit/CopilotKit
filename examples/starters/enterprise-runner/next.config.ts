import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@copilotkitnext/agent",
    "@copilotkitnext/react",
    "@copilotkitnext/runtime",
    "@copilotkitnext/core",
    "@copilotkitnext/shared",
    "@copilotkitnext/web-inspector",
  ],
  experimental: {
    // Allow importing from outside the root directory
    externalDir: true,
  },
};

export default nextConfig;
