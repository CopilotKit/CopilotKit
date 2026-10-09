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
  // The staged CVDIAG emitter (src/cvdiag/*) uses NodeNext-style relative
  // imports with explicit `.js` extensions (e.g. `import … from "./schema.js"`).
  // These are kept verbatim from the canonical L0-A sources so
  // `showcase cvdiag-stage-ts --check` stays in sync, and `tsc` resolves
  // `.js` → `.ts`. Webpack does NOT do that by default, so teach it the same
  // extension alias; otherwise `next build` fails with
  // "Module not found: Can't resolve './schema.js'".
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
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
