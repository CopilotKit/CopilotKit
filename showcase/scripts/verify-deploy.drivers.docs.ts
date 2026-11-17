import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import type { FetchLike } from "./verify-deploy.drivers.baseline";
import { probeBaseline } from "./verify-deploy.drivers.baseline";
import { domainFor } from "./railway-envs";

const PRODUCTION_DOCS_ORIGIN = `https://${domainFor("docs", "prod")}`;
const SURFACE_TIMEOUT_MS = 30_000;
// Where the docs app serves the runtime config it reads from the live env
// (showcase/shell-docs/src/app/api/telemetry/config/route.ts).
export const DOCS_RUNTIME_CONFIG_PATH = "/api/telemetry/config";
const DOCS_RUNTIME_CONFIG_KEYS = [
  "posthogKey",
  "scarfPixelId",
  "googleAnalyticsTrackingId",
  "reb2bKey",
  "reoKey",
] as const;
const POSTHOG_PROJECT_KEY_PREFIX = "phc_";

interface SurfaceResponse {
  path: string;
  body: string;
}

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    out.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return out;
}

export function metadataUrl(
  html: string,
  attribute: "rel" | "property",
  value: "canonical" | "og:url",
  urlAttribute: "href" | "content",
): string | undefined {
  for (const tag of html.match(/<(?:link|meta)\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const discriminator = attrs.get(attribute)?.toLowerCase();
    if (
      discriminator === value ||
      (attribute === "rel" && discriminator?.split(/\s+/).includes(value))
    ) {
      return attrs.get(urlAttribute);
    }
  }
  return undefined;
}

function assertCanonicalUrl(
  rawUrl: string | undefined,
  label: string,
  expectedUrl?: string,
): string | undefined {
  if (!rawUrl) return `${label} is missing`;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return `${label} is not an absolute URL: "${rawUrl}"`;
  }
  if (parsed.origin !== PRODUCTION_DOCS_ORIGIN) {
    return `${label} uses ${parsed.origin}; expected ${PRODUCTION_DOCS_ORIGIN}`;
  }
  if (expectedUrl !== undefined && parsed.href !== expectedUrl) {
    return `${label} is ${parsed.href}; expected ${expectedUrl}`;
  }
  return undefined;
}

function absoluteUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>)"']+/g) ?? [];
}

export function markdownLinkUrls(text: string): string[] {
  return [...text.matchAll(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)].map(
    (match) => match[1],
  );
}

export function sourceUrls(text: string): string[] {
  return [...text.matchAll(/^## Source:\s+(https?:\/\/\S+)\s*$/gm)].map(
    (match) => match[1],
  );
}

export function sitemapUrls(text: string): string[] {
  return [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(
    (match) => match[1],
  );
}

// The curated index intentionally sends agents to the website's stable entry.
// Keep this exception exact: it does not authorize other website/preview URLs.
export function isSupportedOnboardingUrl(url: string): boolean {
  return (
    url === "https://copilotkit.ai/onboarding-prompts" ||
    url === "https://www.copilotkit.ai/onboarding-prompts"
  );
}

// The index names OpenBot by its own site and source repository for users who
// want a workspace of AI coworkers. Keep this list exact and in step with
// OPENBOT_SITE_URL and OPENBOT_SOURCE_URL in shell-docs' llms-index.ts: it
// admits these three links, not their hosts.
const SUPPORTED_OPENBOT_URLS = new Set([
  "https://open.bot",
  "https://open.bot/builders",
  "https://github.com/CopilotKit/OpenBot",
]);

export function isSupportedOpenBotUrl(url: string): boolean {
  return SUPPORTED_OPENBOT_URLS.has(url);
}

function validateUrls(
  urls: string[],
  label: string,
  allowIndexExceptions = false,
): string | undefined {
  if (urls.length === 0) return `${label} contains no generated URLs`;
  for (const url of urls) {
    if (
      allowIndexExceptions &&
      (isSupportedOnboardingUrl(url) || isSupportedOpenBotUrl(url))
    )
      continue;
    const error = assertCanonicalUrl(url, label);
    if (error) return error;
  }
  return undefined;
}

/**
 * Validate the docs app's runtime config, as served at
 * `DOCS_RUNTIME_CONFIG_PATH`: the analytics keys the app reads from the
 * Railway service's env per request (`src/lib/telemetry/config.ts`). Every key
 * must be a string; an empty one turns that channel off, which non-production
 * environments may do. Production must carry its PostHog project key, because
 * an empty one silently turns off docs analytics and the events the telemetry
 * registry catalogs.
 *
 * The docs app has no Clerk and reads no sign-up or Ops URL from the env (its
 * sign-up links name production), so there is no auth config to check. If it
 * starts reading one per environment, check it here.
 */
export function validateDocsRuntimeConfig(
  body: string,
  requirePosthogKey: boolean,
): string | undefined {
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(body);
  } catch {
    return `${DOCS_RUNTIME_CONFIG_PATH} is not valid JSON`;
  }
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return `${DOCS_RUNTIME_CONFIG_PATH} is not a JSON object`;
  }

  const config = rawConfig as Record<string, unknown>;
  for (const key of DOCS_RUNTIME_CONFIG_KEYS) {
    if (typeof config[key] !== "string") {
      return `${DOCS_RUNTIME_CONFIG_PATH} is missing ${key}`;
    }
  }

  const posthogKey = config.posthogKey as string;
  if (
    requirePosthogKey &&
    (!posthogKey.startsWith(POSTHOG_PROJECT_KEY_PREFIX) ||
      posthogKey.length <= POSTHOG_PROJECT_KEY_PREFIX.length)
  ) {
    return `${DOCS_RUNTIME_CONFIG_PATH} posthogKey must be a PostHog project key (${POSTHOG_PROJECT_KEY_PREFIX}…) in production`;
  }

  return undefined;
}

async function fetchSurface(
  host: string,
  path: string,
  fetchImpl: FetchLike,
): Promise<SurfaceResponse> {
  const url = `https://${host}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SURFACE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": "verify-deploy" },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel?.();
      throw new Error(`${url} returned HTTP ${response.status} (expected 200)`);
    }
    return { path, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate the deployed production crawler surfaces against the canonical
 * docs origin. The expected origin comes from the Railway service/domain
 * SSOT, while every emitted URL is read from the deployed response.
 */
export async function checkProductionDocsCanonicalHost(
  host: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<string | undefined> {
  let surfaces: SurfaceResponse[];
  try {
    surfaces = await Promise.all(
      [
        "/",
        "/quickstart",
        "/robots.txt",
        "/sitemap.xml",
        "/llms.txt",
        "/llms-full.txt",
        DOCS_RUNTIME_CONFIG_PATH,
      ].map((path) => fetchSurface(host, path, fetchImpl)),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `docs: canonical-host smoke fetch failed: ${message}`;
  }

  const byPath = new Map(
    surfaces.map((surface) => [surface.path, surface.body]),
  );
  const configError = validateDocsRuntimeConfig(
    byPath.get(DOCS_RUNTIME_CONFIG_PATH) ?? "",
    true,
  );
  if (configError) return `docs: ${configError}`;

  for (const path of ["/", "/quickstart"] as const) {
    const html = byPath.get(path) ?? "";
    const expectedUrl = `${PRODUCTION_DOCS_ORIGIN}${path}`;
    const canonicalError = assertCanonicalUrl(
      metadataUrl(html, "rel", "canonical", "href"),
      `${path} canonical URL`,
      expectedUrl,
    );
    if (canonicalError) return `docs: ${canonicalError}`;
    const ogError = assertCanonicalUrl(
      metadataUrl(html, "property", "og:url", "content"),
      `${path} Open Graph URL`,
      expectedUrl,
    );
    if (ogError) return `docs: ${ogError}`;
  }

  const robots = byPath.get("/robots.txt") ?? "";
  const robotsError = validateUrls(absoluteUrls(robots), "robots.txt URL");
  if (robotsError) return `docs: ${robotsError}`;
  if (!robots.includes(`Sitemap: ${PRODUCTION_DOCS_ORIGIN}/sitemap.xml`)) {
    return `docs: robots.txt is missing Sitemap: ${PRODUCTION_DOCS_ORIGIN}/sitemap.xml`;
  }

  const sitemapError = validateUrls(
    sitemapUrls(byPath.get("/sitemap.xml") ?? ""),
    "sitemap.xml <loc>",
  );
  if (sitemapError) return `docs: ${sitemapError}`;

  const llmsError = validateUrls(
    markdownLinkUrls(byPath.get("/llms.txt") ?? ""),
    "llms.txt link",
    true,
  );
  if (llmsError) return `docs: ${llmsError}`;

  const llmsFullError = validateUrls(
    sourceUrls(byPath.get("/llms-full.txt") ?? ""),
    "llms-full.txt source",
  );
  if (llmsFullError) return `docs: ${llmsFullError}`;

  return undefined;
}

/**
 * Production docs verifier: Railway deployment-SUCCESS + HTTP 200 baseline,
 * followed by a deployed runtime-config smoke in every environment.
 * The production promotion gate additionally requires the PostHog key and
 * validates every machine-facing URL surface against docs.copilotkit.ai.
 */
export async function probeDocs(target: ProbeTarget): Promise<ProbeOutcome> {
  const baseline = await probeBaseline(target, {
    driverLabel: "docs",
    healthcheckPath: "/",
  });
  if (!baseline.ok) return baseline;

  let error: string | undefined;
  if (target.host === domainFor("docs", "prod")) {
    error = await checkProductionDocsCanonicalHost(target.host);
  } else {
    try {
      const config = await fetchSurface(
        target.host,
        DOCS_RUNTIME_CONFIG_PATH,
        globalThis.fetch,
      );
      const configError = validateDocsRuntimeConfig(config.body, false);
      error = configError ? `docs: ${configError}` : undefined;
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : String(caught);
      error = `docs: runtime-config smoke fetch failed: ${message}`;
    }
  }
  return error ? { ok: false, error } : baseline;
}
