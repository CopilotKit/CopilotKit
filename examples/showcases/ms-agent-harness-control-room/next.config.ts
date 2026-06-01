import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["express", "pino", "thread-stream"],
};

export default nextConfig;
