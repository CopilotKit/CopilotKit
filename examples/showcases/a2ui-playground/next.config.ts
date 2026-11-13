import type { NextConfig } from "next";
import { BASE_PATH, MOVED_HOSTS, SITE_URL } from "./src/lib/site";

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
  // No includeSubDomains: open.bot serves these responses as its own, and its other subdomains are not ours to pin.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

/**
 * Every request to an address the playground moved from goes, with its path and query, to the same page on
 * open.bot as a 301. Paths from before BASE_PATH (/, /watch, /start) and paths with it map to the same place.
 */
const movedHostRedirects = MOVED_HOSTS.flatMap((host) => {
  const has = [{ type: "host" as const, value: host }];
  return [
    { source: "/", destination: SITE_URL },
    { source: BASE_PATH, destination: SITE_URL },
    { source: `${BASE_PATH}/:path+`, destination: `${SITE_URL}/:path+` },
    { source: "/:path+", destination: `${SITE_URL}/:path+` },
  ].map((r) => ({ ...r, has, basePath: false as const, statusCode: 301 }));
});

/**
 * Anywhere else (Railway's own address, which open.bot's rewrite calls, or localhost), a path from before
 * BASE_PATH moves under it on the same host, so old links and `pnpm dev`'s http://localhost:3100 still land.
 */
const oldPathRedirects = [
  { source: "/", destination: BASE_PATH },
  {
    source: `/:path((?!${BASE_PATH.slice(1)}(?:/|$)).+)`,
    destination: `${BASE_PATH}/:path`,
  },
].map((r) => ({ ...r, basePath: false as const, permanent: true }));

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  serverExternalPackages: ["@copilotkit/runtime"],
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // "Watch a build" lived at /build; the folder is named `watch` because monorepos often ignore `build/` directories.
  async redirects() {
    return [
      ...movedHostRedirects,
      ...oldPathRedirects,
      { source: "/build", destination: "/watch", permanent: true },
    ];
  },
};

export default nextConfig;
