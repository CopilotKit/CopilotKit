import type { NextConfig } from "next";

/**
 * Sent with every response. The CSP only forbids framing: a full policy would
 * break MapLibre (workers, blob URLs) and the inline styles the renderers set.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@copilotkit/runtime"],
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // "Watch a build" lived at /build; the folder is named `watch` because monorepos often ignore `build/` directories.
  async redirects() {
    return [{ source: "/build", destination: "/watch", permanent: true }];
  },
};

export default nextConfig;
