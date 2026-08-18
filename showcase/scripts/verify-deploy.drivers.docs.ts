import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import type { FetchLike } from "./verify-deploy.drivers.baseline";
import { probeBaseline } from "./verify-deploy.drivers.baseline";
import { domainFor } from "./railway-envs";

const PRODUCTION_DOCS_ORIGIN = `https://${domainFor("docs", "prod")}`;
const SURFACE_TIMEOUT_MS = 30_000;

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

function validateUrls(urls: string[], label: string): string | undefined {
  if (urls.length === 0) return `${label} contains no generated URLs`;
  for (const url of urls) {
    const error = assertCanonicalUrl(url, label);
    if (error) return error;
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
      ].map((path) => fetchSurface(host, path, fetchImpl)),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `docs: canonical-host smoke fetch failed: ${message}`;
  }

  const byPath = new Map(
    surfaces.map((surface) => [surface.path, surface.body]),
  );
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
 * followed by a deployed-output smoke test for every machine-facing URL
 * surface. Staging retains the shared baseline; the production promotion
 * gate runs the canonical smoke against docs.copilotkit.ai.
 */
export async function probeDocs(target: ProbeTarget): Promise<ProbeOutcome> {
  const baseline = await probeBaseline(target, {
    driverLabel: "docs",
    healthcheckPath: "/",
  });
  if (!baseline.ok) return baseline;

  if (target.host !== domainFor("docs", "prod")) return baseline;
  const error = await checkProductionDocsCanonicalHost(target.host);
  return error ? { ok: false, error } : baseline;
}
