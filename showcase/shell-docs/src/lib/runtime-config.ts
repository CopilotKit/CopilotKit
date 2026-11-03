// Server-only: this deployment's site hosts (src/lib/site-hosts.ts), read
// from the environment when a page renders, with production as the default.
// They can't be build-time constants: one image serves staging and then
// production (docs_promote.yml promotes the staging digest). The env var
// names are the ones shell-docs and the showcase shell read, and keys are
// computed so Next can't inline them at build.
//
// Every docs page renders per request. A route Next prerenders (`/ask`)
// gets the build's values, which are the production defaults.
//
// Client components read the same values from `useSiteHosts()`
// (src/components/site-hosts.tsx), which the `(d)` layout fills from here.

import { PRODUCTION_SITE_HOSTS, type SiteHosts } from "./site-hosts";

export function getSiteHosts(): SiteHosts {
  return {
    showcaseUrl: readOrigin(
      "NEXT_PUBLIC_SHELL_URL",
      PRODUCTION_SITE_HOSTS.showcaseUrl,
    ),
    dashboardUrl: readOrigin(
      "NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL",
      PRODUCTION_SITE_HOSTS.dashboardUrl,
    ),
    demoHostPattern: readHostPattern(
      "SHOWCASE_BACKEND_HOST_PATTERN",
      PRODUCTION_SITE_HOSTS.demoHostPattern,
    ),
  };
}

/** An http(s) URL, without a trailing slash. */
function readOrigin(envKey: string, fallback: string): string {
  const value = readEnvPair(envKey)?.replace(/\/+$/, "");
  if (!value) return fallback;
  try {
    if (/^https?:$/.test(new URL(value).protocol)) return value;
  } catch {
    // Reported below.
  }
  return invalid(envKey, value, fallback);
}

/**
 * A bare host with `{slug}` in it, as the showcase reads it
 * (showcase/scripts/generate-registry.ts): a scheme or trailing slash is
 * dropped, and a pattern that can't form a URL falls back.
 */
function readHostPattern(envKey: string, fallback: string): string {
  const value = readEnvPair(envKey)
    ?.replace(/^([a-z][a-z0-9+.-]*:\/\/)+/i, "")
    .replace(/\/+$/, "");
  if (!value) return fallback;
  try {
    const probe = new URL(`https://${value.replaceAll("{slug}", "probe")}`);
    if (value.includes("{slug}") && probe.pathname === "/" && !probe.search)
      return value;
  } catch {
    // Reported below.
  }
  return invalid(envKey, value, fallback);
}

const warned = new Set<string>();
function invalid(envKey: string, value: string, fallback: string): string {
  if (!warned.has(envKey)) {
    warned.add(envKey);
    console.warn(
      `[runtime-config] ${envKey}=${JSON.stringify(value)} is not usable; using ${fallback}.`,
    );
  }
  return fallback;
}

// Deploy configs in the wild set either `X` or `NEXT_PUBLIC_X`; accept both,
// primary first. An empty value counts as unset.
function readEnvPair(envKey: string): string | undefined {
  const alt = envKey.startsWith("NEXT_PUBLIC_")
    ? envKey.slice("NEXT_PUBLIC_".length)
    : `NEXT_PUBLIC_${envKey}`;
  for (const key of [envKey, alt]) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}
