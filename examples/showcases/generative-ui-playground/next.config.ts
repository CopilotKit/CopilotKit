import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable React strict mode to prevent double-rendering issues with MCP Apps
  // The MCPAppsActivityRenderer creates duplicate iframes in strict mode
  reactStrictMode: false,
  // Note: NOT using standalone mode - hono/vercel adapter requires regular next start
};

export default nextConfig;
