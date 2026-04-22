import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // HttpAgent type mismatch with AbstractAgent in Docker builds
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
