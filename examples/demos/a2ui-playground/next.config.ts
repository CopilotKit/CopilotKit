import type { NextConfig } from "next";

/** A source `frame-ancestors` can take safely: an https origin, optionally with a `*.` subdomain wildcard and a port. */
const ORIGIN = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i;

/**
 * Who may show the playground in an iframe: CopilotKit's website and docs embed it. More origins (a preview
 * deploy, say) go in FRAME_ANCESTORS, space-separated; it is read at build time. Anything that is not a plain
 * https origin is dropped, so the variable can neither add a CSP directive (`;`) nor open framing to any site
 * (`*`, `https:`).
 */
const extraAncestors = (process.env.FRAME_ANCESTORS ?? "")
  .split(/\s+/)
  .filter(Boolean)
  .filter((source) => {
    if (ORIGIN.test(source)) return true;
    console.warn(`FRAME_ANCESTORS: ignoring "${source}", not an https origin`);
    return false;
  });
const FRAME_ANCESTORS = [
  "'self'",
  "https://copilotkit.ai",
  "https://*.copilotkit.ai",
  ...extraAncestors,
].join(" ");

/**
 * Sent with every response. The CSP only limits framing: a full policy would
 * break MapLibre (workers, blob URLs) and the inline styles the renderers set.
 * There is no X-Frame-Options, which cannot name the sites allowed to frame.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: `frame-ancestors ${FRAME_ANCESTORS}`,
  },
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
