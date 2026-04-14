import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  // Allow iframe embedding from the showcase shell
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "ALLOWALL",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@copilotkit/showcase-shared": path.resolve(
        process.cwd(),
        "shared_frontend/src",
      ),
    };
    return config;
  },
};

export default nextConfig;
