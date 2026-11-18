import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Treat these packages as external to avoid bundling test files
  serverExternalPackages: ["pino", "thread-stream"],
};

export default nextConfig;
