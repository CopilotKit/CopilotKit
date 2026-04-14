import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  typescript: {
    // Mastra beta packages have unstable types
    ignoreBuildErrors: true,
  },
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
      "@copilotkit/showcase-shared": "./shared_frontend/src",
    };
    return config;
  },
};

export default nextConfig;
