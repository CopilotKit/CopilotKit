import type { NextConfig } from "next";

const threadsEnabled = process.env.COPILOTKIT_LICENSE_TOKEN ? "true" : "false";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: threadsEnabled,
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
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
