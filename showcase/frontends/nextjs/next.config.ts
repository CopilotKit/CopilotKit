import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Route handlers load the CopilotKit runtime from node_modules instead of
  // bundling it.
  serverExternalPackages: ["@copilotkit/runtime"],
  // Some shared TypeScript sources import siblings as `./name.js`, the
  // NodeNext style. TypeScript maps `.js` to `.ts`; webpack needs this alias
  // to do the same.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  // The showcase shells embed demo pages in iframes.
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
