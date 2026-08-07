import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CopilotRuntime runs in-process in the App Router route handler.
  serverExternalPackages: ["@copilotkit/runtime"],
  typescript: {
    ignoreBuildErrors: true,
  },
  // Allow iframe embedding from the showcase shell.
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
};

export default nextConfig;
