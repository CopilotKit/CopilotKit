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
//
import { unstable_noStore as noStore } from "next/cache";

export interface RuntimeConfig {
  /**
   * Local-dev backend overrides keyed by integration slug. These let the
   * dojo iframe a locally running integration instead of the production URL
   * baked into generated registry.json.
   */
  localBackends: Record<string, string>;
}

/**
 * Resolve the runtime config for shell-dojo. Called once per request
 * by the root layout.
 *
 * `opts.noStore` (default `true`) controls whether to call
 * `unstable_noStore()`. The Node.js server runtime needs the opt-out
 * so Next.js does not statically prerender callers and freeze any
 * future URL values into the build artifact.
 */
export function getRuntimeConfig(
  opts: { noStore?: boolean } = {},
): RuntimeConfig {
  if (opts.noStore !== false) noStore();
  return {
    localBackends: readLocalBackends(),
  };
}

function readLocalBackends(): Record<string, string> {
  const raw =
    readEnv("SHELL_DOJO_LOCAL_BACKENDS") ??
    readEnv("NEXT_PUBLIC_LOCAL_BACKENDS");
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `SHELL_DOJO_LOCAL_BACKENDS/NEXT_PUBLIC_LOCAL_BACKENDS must be JSON: ${String(err)}`,
      { cause: err },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "SHELL_DOJO_LOCAL_BACKENDS/NEXT_PUBLIC_LOCAL_BACKENDS must be a JSON object mapping integration slug -> backend URL.",
    );
  }

  const out: Record<string, string> = {};
  for (const [slug, url] of Object.entries(parsed)) {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new Error(
        `Invalid local backend slug ${JSON.stringify(slug)}; expected [a-z0-9-]+.`,
      );
    }
    if (typeof url !== "string") {
      throw new Error(
        `Local backend for ${slug} must be a string URL; got ${JSON.stringify(url)}.`,
      );
    }
    out[slug] = normalizeBackendUrl(slug, url);
  }
  return out;
}

function normalizeBackendUrl(slug: string, raw: string): string {
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (err) {
    throw new Error(
      `Local backend for ${slug} is not a parseable URL: ${JSON.stringify(raw)}.`,
      { cause: err },
    );
  }
  if (
    !/^https?:$/i.test(parsed.protocol) ||
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      `Local backend for ${slug} must be an http(s) base URL with an explicit scheme and no userinfo, query, or fragment.`,
    );
  }
  return (parsed.origin + parsed.pathname).replace(/\/+$/, "");
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
