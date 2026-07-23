// Server-only runtime config reader. Reads from process.env at REQUEST
// time (not at module load) so a single built artifact can serve
// different URL values across staging vs prod by changing the Railway
// service's env vars — no rebuild required.
//
// `unstable_noStore()` opts the calling segment out of Next.js's static
// cache so reads always reflect the live env. Without it, a server
// component that uses this could be statically rendered at build time
// and freeze the URLs back into the artifact — defeating the runtime
// switch. See Next.js App Router docs on Dynamic Rendering.
//
// This module MUST NOT be imported from client components. The matching
// client-side reader lives in runtime-config.client.ts and reads from
// window.__SHOWCASE_CONFIG__ which the root layout injects.

import { unstable_noStore as noStore } from "next/cache";
import {
  DEFAULT_BACKEND_HOST_PATTERN,
  normalizeBackendHostPattern,
} from "./backend-url";

export interface RuntimeConfig {
  /**
   * Backend host pattern — `{slug}` is the only placeholder. Used to
   * derive each integration's preview-iframe backend URL at request
   * time instead of trusting the registry's `backend_url`, which is
   * baked at Docker build (freezing prod hostnames into every image, so
   * the staging dojo iframed prod integrations). Same semantics as
   * SHOWCASE_BACKEND_HOST_PATTERN in scripts/generate-registry.ts and
   * the shell's runtime config: host only, `https://` is prepended by
   * the consumer (see lib/backend-url.ts).
   */
  backendHostPattern: string;
}

/**
 * Resolve the runtime config for shell-dojo. Called once per request by
 * the root layout, which injects the result into
 * window.__SHOWCASE_CONFIG__ for the client reader.
 *
 * `opts.noStore` (default `true`) controls whether to call
 * `unstable_noStore()`. The Node.js server runtime needs the opt-out so
 * Next.js does not statically prerender callers and freeze the URL
 * values into the build artifact.
 */
export function getRuntimeConfig(
  opts: { noStore?: boolean } = {},
): RuntimeConfig {
  if (opts.noStore !== false) noStore();

  // backendHostPattern is a host *pattern*, not a URL — `{slug}` must
  // survive untouched. It IS normalized against common env misconfigs
  // (leading scheme, trailing slash, missing `{slug}`) with warn-once
  // guards — see normalizeBackendHostPattern in lib/backend-url.ts. An
  // unset var defaults to the prod pattern, so a deploy with the var
  // unset behaves byte-identically to the build-baked prod values.
  const backendHostPattern = normalizeBackendHostPattern(
    readEnvPair("SHOWCASE_BACKEND_HOST_PATTERN") ??
      DEFAULT_BACKEND_HOST_PATTERN,
  );

  return { backendHostPattern };
}

// Env-name tolerance: deploy configs in the wild use either the bare
// name (e.g. `SHOWCASE_BACKEND_HOST_PATTERN`) or the `NEXT_PUBLIC_*`-
// prefixed name. We accept either — the primary (passed-in) name wins,
// with transparent fallback to the alternate so a Railway service
// variable set under the "wrong" name still works without redeploy.
// Same semantics as the shell's runtime-config readEnvPair.
function altEnvName(envKey: string): string {
  return envKey.startsWith("NEXT_PUBLIC_")
    ? envKey.slice("NEXT_PUBLIC_".length)
    : `NEXT_PUBLIC_${envKey}`;
}

// Length-aware env coalesce: a deliberately-empty primary (an operator
// clearing the var on a Railway service) must NOT mask a populated
// alternate. Treat empty-string as "unset" and fall through to the
// alternate. Values are .trim()ed — whitespace paste artifacts would
// otherwise survive into the pattern; a whitespace-only value counts as
// unset. The dynamic `process.env[key]` reads assume a self-hosted Node
// runtime (next start / Docker).
function readEnvPair(envKey: string): string | undefined {
  const primary = process.env[envKey]?.trim();
  if (primary && primary.length > 0) return primary;
  const alt = process.env[altEnvName(envKey)]?.trim();
  if (alt && alt.length > 0) return alt;
  return undefined;
}
