import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow iframe embedding from the showcase shell-dashboard.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
        ],
      },
    ];
  },
};

export default nextConfig;
