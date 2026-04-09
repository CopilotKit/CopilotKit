import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BASE_URL:
      process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
  },
  serverExternalPackages: ["@copilotkit/runtime", "@copilotkitnext/runtime"],
};

export default nextConfig;
