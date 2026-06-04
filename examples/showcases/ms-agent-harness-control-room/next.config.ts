import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["express", "pino", "thread-stream"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
