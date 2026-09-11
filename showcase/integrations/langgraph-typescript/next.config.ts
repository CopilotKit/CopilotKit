import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/angular/:path*",
        destination: "/angular/index.html",
      },
    ];
  },
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
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
