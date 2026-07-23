import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable React strict mode to prevent double-rendering issues with MCP Apps
  // The MCPAppsActivityRenderer creates duplicate iframes in strict mode
  reactStrictMode: false,
  // The API routes import @copilotkit/runtime/v2 (server-only); keep it external
  // so Next.js does not try to bundle it. Base package name covers the /v2 subpath.
  serverExternalPackages: ["@copilotkit/runtime"],
  // Note: NOT using standalone mode - hono/vercel adapter requires regular next start
};

export default nextConfig;
