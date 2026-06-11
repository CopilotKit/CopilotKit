// Runtime derivation of integration backend URLs.
//
// The registry's `backend_url` is synthesized at Docker BUILD time by
// scripts/generate-registry.ts, which bakes the production hostnames
// into every image — so a staging shell iframed prod integrations.
// These helpers derive the backend host at REQUEST time from the
// `backendHostPattern` carried in RuntimeConfig (env var
// SHOWCASE_BACKEND_HOST_PATTERN, default = the prod pattern), keeping
// registry.json as the source for non-URL metadata only.
//
// Pattern semantics are IDENTICAL to generate-registry.ts: the pattern
// is a bare host with `{slug}` as the only placeholder, and `https://`
// is prepended. Keep the two in sync — they consume the same env var.
//
// This module is import-safe from client components, server components,
// and middleware (pure functions, no next/* imports).

// Matches an explicit URL scheme prefix (e.g. `https://`, `http://`).
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

// Warn once per distinct (pattern, issue) — config is re-read every
// request, and per-request warn spam would drown real signal.
const patternWarnings = new Set<string>();

function warnPatternOnce(key: string, message: string): void {
  if (patternWarnings.has(key)) return;
  patternWarnings.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[backend-url] SHOWCASE_BACKEND_HOST_PATTERN ${message}`);
}

/**
 * Normalize a backend host pattern read from the environment. The
 * pattern contract (same as scripts/generate-registry.ts) is a bare
 * host with `{slug}` as the only placeholder — but env misconfigs are
 * easy and were previously silent:
 *
 * - a scheme-bearing value would yield `https://https://…` (consumer
 *   prepends the scheme) → strip it and warn;
 * - a trailing slash would yield `host//route` on concat → trim and warn;
 * - a missing `{slug}` placeholder silently sends EVERY integration to
 *   the same host → warn (can't fix it for the operator).
 *
 * Warnings fire once per distinct value, not per request.
 */
export function normalizeBackendHostPattern(pattern: string): string {
  let normalized = pattern;
  const scheme = SCHEME_RE.exec(normalized);
  if (scheme) {
    warnPatternOnce(
      `scheme:${pattern}`,
      `"${pattern}" includes a scheme — the consumer prepends https://; stripping "${scheme[0]}".`,
    );
    normalized = normalized.slice(scheme[0].length);
  }
  if (/\/+$/.test(normalized)) {
    warnPatternOnce(
      `trailing-slash:${pattern}`,
      `"${pattern}" has a trailing slash — route concatenation would yield "//"; trimming.`,
    );
    normalized = normalized.replace(/\/+$/, "");
  }
  if (!normalized.includes("{slug}")) {
    warnPatternOnce(
      `no-slug:${pattern}`,
      `"${pattern}" lacks the {slug} placeholder — EVERY integration will resolve to the same backend host.`,
    );
  }
  return normalized;
}

/** Substitute `{slug}` into the host pattern and prepend `https://`. */
export function backendUrlFromPattern(pattern: string, slug: string): string {
  return `https://${pattern.replaceAll("{slug}", slug)}`;
}

/**
 * Parse the NEXT_PUBLIC_LOCAL_BACKENDS map (baked at build from
 * shared/local-ports.json — local-dev only, empty in deployed images).
 * Tolerant of unset/empty/corrupt values: local dev convenience must
 * never break rendering.
 */
export function parseLocalBackends(
  raw: string | undefined,
): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Validate values instead of an unchecked `as Record<string,
      // string>` flow-through — a non-string value would otherwise
      // surface much later as a garbage iframe src.
      const backends: Record<string, string> = {};
      for (const [slug, url] of Object.entries(parsed)) {
        if (typeof url === "string") {
          backends[slug] = url;
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[backend-url] NEXT_PUBLIC_LOCAL_BACKENDS value for "${slug}" is not a string — skipping it.`,
          );
        }
      }
      return backends;
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[backend-url] NEXT_PUBLIC_LOCAL_BACKENDS is not a JSON object — ignoring it.",
    );
  } catch {
    // Treat unparseable as unset (local-dev convenience must never
    // break rendering) — but say so, instead of silently eating it.
    // eslint-disable-next-line no-console
    console.warn(
      "[backend-url] NEXT_PUBLIC_LOCAL_BACKENDS is not valid JSON — ignoring it.",
    );
  }
  return {};
}

/**
 * Resolve an integration's backend base URL: a local-dev override from
 * NEXT_PUBLIC_LOCAL_BACKENDS wins (preserving the pre-existing
 * `SHOWCASE_LOCAL=1` behavior), otherwise derive from the runtime host
 * pattern.
 */
export function resolveBackendUrl(slug: string, pattern: string): string {
  const local = parseLocalBackends(process.env.NEXT_PUBLIC_LOCAL_BACKENDS);
  // Length-aware: an empty-string override (e.g. `{"mastra": ""}`) is
  // not a usable URL — `??` would accept it and yield an empty base.
  const override = local[slug];
  if (override !== undefined && override.length > 0) return override;
  return backendUrlFromPattern(pattern, slug);
}
