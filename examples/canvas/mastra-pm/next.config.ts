import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../../.."),
  // The workspace runs Oxlint through the separate Nx lint target.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
