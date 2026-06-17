import type { NextConfig } from "next";

// React needs 'unsafe-eval' only in development (for enhanced error stacks); it's
// not required in production. See node_modules/next/dist/docs/.../content-security-policy.md
const isDev = process.env.NODE_ENV !== "production";

// A pragmatic CSP for the cookbook. The strong directives (object-src 'none',
// frame-ancestors 'none', base-uri 'self') are the high-value wins. We keep
// 'unsafe-inline' for the inline styles/scripts Next emits without a nonce. For a
// hardened production app, move to nonce-based CSP per Next's CSP guide.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "connect-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // HSTS only takes effect over HTTPS; harmless on http://localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
