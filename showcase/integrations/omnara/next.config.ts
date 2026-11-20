import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  // Omnara's SDK and runtime use Node APIs; load them in the server process.
  serverExternalPackages: ["@copilotkit/runtime", "@ag-ui/omnara"],
  async rewrites() {
    return [
      { source: "/angular/:path*", destination: "/angular/index.html" },
      { source: "/vue/:path*", destination: "/vue/index.html" },
    ];
  },
  experimental: { cpus: 2 },
};
export default config;
