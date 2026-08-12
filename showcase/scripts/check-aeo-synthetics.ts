import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AEO_CONTRACT_PATH } from "./validate-aeo-contract";
import {
  markdownLinkUrls,
  metadataUrl,
  sitemapUrls,
  sourceUrls,
} from "./verify-deploy.drivers.docs";

// Crawler identities and provenance:
// OpenAI: https://help.openai.com/en/articles/20001243-advertiser-guidance-for-allowing-openai-web-crawlers
// Anthropic: https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
// Perplexity: https://docs.perplexity.ai/docs/resources/perplexity-crawlers
// Google: https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
const CRAWLERS = [
  { id: "oai-searchbot", value: "OAI-SearchBot" },
  { id: "claude-searchbot", value: "Claude-SearchBot" },
  {
    id: "perplexitybot",
    value:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  },
  {
    id: "googlebot",
    value:
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
] as const;

const REQUIRED_ENDPOINTS = {
  website: new Map([
    ["/", "text/html"],
    ["/robots.txt", "text/plain"],
    ["/sitemap.xml", "application/xml"],
    ["/llms.txt", "text/plain"],
    ["/llms-full.txt", "text/plain"],
  ]),
  docs: new Map([
    ["/", "text/html"],
    ["/robots.txt", "text/plain"],
    ["/sitemap.xml", "application/xml"],
    ["/llms.txt", "text/plain"],
    ["/llms-full.txt", "text/plain"],
  ]),
} as const;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

type MonitoredHost = keyof typeof REQUIRED_ENDPOINTS;

interface ContractEndpoint {
  path: string;
  contentTypes: string[];
}

interface ContractSurface {
  id: string;
  host: "website" | "docs" | "docsMcp";
  classification: string;
  endpoints: ContractEndpoint[];
}

export interface AeoSyntheticContract {
  canonicalHosts: Record<"website" | "docs" | "docsMcp", string>;
  surfaces: ContractSurface[];
}

interface SyntheticTarget {
  host: MonitoredHost;
  path: string;
  contentType: string;
}

export interface SyntheticFailure {
  userAgent: string;
  url: string;
  reason: string;
  observedStatus: number;
  observedContentType: string;
  responseSnippet: string;
}

interface RunOptions {
  timeoutMs?: number;
  maxConcurrency?: number;
  validateConfig?: boolean;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export function loadAeoSyntheticContract(
  repositoryRoot: string,
): AeoSyntheticContract {
  const path = join(repositoryRoot, AEO_CONTRACT_PATH);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AeoSyntheticContract;
  } catch (error) {
    throw new Error(
      `Unable to load AEO synthetic baseline ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function declaredEndpoints(
  contract: AeoSyntheticContract,
  host: MonitoredHost,
): Map<string, ReadonlySet<string>> {
  const endpoints = new Map<string, Set<string>>();
  for (const surface of contract.surfaces) {
    if (
      surface.host !== host ||
      surface.classification === "copilotkit-contract"
    ) {
      continue;
    }
    for (const endpoint of surface.endpoints) {
      const path = endpoint.path === "/**" ? "/" : endpoint.path;
      const types = endpoints.get(path) ?? new Set<string>();
      endpoint.contentTypes.forEach((type) => types.add(type));
      endpoints.set(path, types);
    }
  }
  return endpoints;
}

export function validateAeoSyntheticConfig(
  contract: AeoSyntheticContract,
): string[] {
  const errors: string[] = [];
  for (const host of ["website", "docs"] as const) {
    try {
      const origin = new URL(contract.canonicalHosts[host]);
      if (origin.protocol !== "https:" || origin.pathname !== "/") {
        throw new Error("not an HTTPS origin");
      }
    } catch {
      errors.push(`${host} canonical host must be an HTTPS origin`);
    }

    const declared = declaredEndpoints(contract, host);
    for (const [path, contentType] of REQUIRED_ENDPOINTS[host]) {
      const declaredTypes = declared.get(path);
      if (!declaredTypes) {
        errors.push(`${host} baseline is missing ${path}`);
      } else if (!declaredTypes.has(contentType)) {
        errors.push(`${host} ${path} must declare Content-Type ${contentType}`);
      }
    }
  }
  return errors;
}

function targetsFromContract(
  contract: AeoSyntheticContract,
): SyntheticTarget[] {
  return (["website", "docs"] as const).flatMap((host) => {
    const declared = declaredEndpoints(contract, host);
    return [...REQUIRED_ENDPOINTS[host]].flatMap(([path, contentType]) =>
      declared.has(path) ? [{ host, path, contentType }] : [],
    );
  });
}

function attributes(tag: string): Map<string, string> {
  const values = new Map<string, string>();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    values.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return values;
}

function soft404Reason(body: string, contentType: string): string | undefined {
  if (!contentType.startsWith("text/html")) return undefined;
  const noindex = (body.match(/<meta\b[^>]*>/gi) ?? []).some((tag) => {
    const attrs = attributes(tag);
    return (
      attrs.get("name")?.toLowerCase() === "robots" &&
      attrs.get("content")?.toLowerCase().includes("noindex")
    );
  });
  if (noindex) return "HTML response declares robots noindex (soft-404 signal)";
  if (/<h1[^>]*>\s*(?:404|page (?:not found|does not exist))/i.test(body)) {
    return "HTML response contains a not-found heading (soft-404 signal)";
  }
  return undefined;
}

function hostError(
  rawUrl: string | undefined,
  expectedOrigin: string,
  label: string,
): string | undefined {
  if (!rawUrl) return `${label} is missing`;
  try {
    const actualOrigin = new URL(rawUrl).origin;
    return actualOrigin === expectedOrigin
      ? undefined
      : `${label} uses ${actualOrigin}; expected ${expectedOrigin}`;
  } catch {
    return `${label} is not an absolute URL: ${rawUrl}`;
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  try {
    while (!done && size < MAX_BODY_BYTES) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        const chunk = result.value.slice(0, MAX_BODY_BYTES - size);
        chunks.push(chunk);
        size += chunk.byteLength;
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
  }
}

async function fetchSurface(
  url: string,
  userAgent: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ response: Response; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      headers: { "User-Agent": userAgent },
      signal: controller.signal,
    });
    return { response, body: await readBoundedBody(response) };
  } finally {
    clearTimeout(timer);
  }
}

function createFailure(
  crawler: string,
  url: string,
  reason: string,
  response?: Response,
  body = "",
): SyntheticFailure {
  return {
    userAgent: crawler,
    url,
    reason,
    observedStatus: response?.status ?? 0,
    observedContentType: response?.headers.get("content-type") ?? "(missing)",
    responseSnippet:
      body.replace(/\s+/g, " ").trim().slice(0, 240) || "(empty body)",
  };
}

function responseReasons(
  contract: AeoSyntheticContract,
  target: SyntheticTarget,
  response: Response,
  body: string,
): string[] {
  const origin = contract.canonicalHosts[target.host];
  const contentType = response.headers.get("content-type") ?? "";
  const reasons: string[] = [];
  if (response.status !== 200) {
    reasons.push(`expected HTTP 200, received HTTP ${response.status}`);
  }
  if (!contentType.toLowerCase().startsWith(target.contentType)) {
    reasons.push(
      `expected Content-Type ${target.contentType}, received ${contentType || "(missing)"}`,
    );
  }
  if (body.trim().length === 0) reasons.push("response body is empty");
  const soft404 = soft404Reason(body, contentType);
  if (soft404) reasons.push(soft404);

  if (target.path === "/") {
    const canonical = metadataUrl(body, "rel", "canonical", "href");
    const error = hostError(canonical, origin, "canonical URL");
    if (error) reasons.push(error);
    if (
      canonical &&
      URL.canParse(canonical) &&
      new URL(canonical).href !== `${origin}/`
    ) {
      reasons.push(`canonical URL is ${canonical}; expected ${origin}/`);
    }
  } else if (target.path === "/robots.txt") {
    const sitemap = body.match(/^Sitemap:\s*(\S+)/im)?.[1];
    const error = hostError(sitemap, origin, "robots sitemap URL");
    if (error) reasons.push(error);
  } else if (target.path === "/sitemap.xml") {
    const urls = sitemapUrls(body);
    if (urls.length === 0) reasons.push("sitemap contains no <loc> URLs");
    const error = urls
      .map((url) => hostError(url, origin, "sitemap URL"))
      .find(Boolean);
    if (error) reasons.push(error);
  } else {
    const urls =
      target.path === "/llms-full.txt"
        ? sourceUrls(body)
        : markdownLinkUrls(body);
    if (urls.length === 0)
      reasons.push("machine content contains no indexed URLs");
    const canonicalOrigins = new Set(Object.values(contract.canonicalHosts));
    for (const rawUrl of urls) {
      try {
        const parsed = new URL(rawUrl);
        if (target.path === "/llms-full.txt") {
          const error = hostError(rawUrl, origin, "llms-full source URL");
          if (error) reasons.push(error);
          if (error) break;
          continue;
        }
        const isCopilotKitHost =
          parsed.hostname === "copilotkit.ai" ||
          parsed.hostname.endsWith(".copilotkit.ai");
        if (
          (isCopilotKitHost && !canonicalOrigins.has(parsed.origin)) ||
          parsed.hostname.endsWith(".up.railway.app")
        ) {
          reasons.push(
            `machine-content URL uses non-canonical production origin ${parsed.origin}`,
          );
          break;
        }
      } catch {
        reasons.push(`machine-content URL is not absolute: ${rawUrl}`);
        break;
      }
    }
  }
  return reasons;
}

async function checkTarget(
  contract: AeoSyntheticContract,
  target: SyntheticTarget,
  crawler: (typeof CRAWLERS)[number],
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<SyntheticFailure[]> {
  const url = new URL(target.path, `${contract.canonicalHosts[target.host]}/`)
    .href;
  let fetched: { response: Response; body: string };
  try {
    fetched = await fetchSurface(url, crawler.value, fetchImpl, timeoutMs);
  } catch (error) {
    return [
      createFailure(
        crawler.id,
        url,
        `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }

  const reasons = responseReasons(
    contract,
    target,
    fetched.response,
    fetched.body,
  );
  const failures = reasons.length
    ? [
        createFailure(
          crawler.id,
          url,
          reasons.join("; "),
          fetched.response,
          fetched.body,
        ),
      ]
    : [];

  const sampleUrl =
    target.path === "/sitemap.xml" ? sitemapUrls(fetched.body)[0] : undefined;
  if (!sampleUrl) return failures;
  try {
    const sample = await fetchSurface(
      sampleUrl,
      crawler.value,
      fetchImpl,
      timeoutMs,
    );
    const sampleType = sample.response.headers.get("content-type") ?? "";
    const sampleError = soft404Reason(sample.body, sampleType);
    if (
      sample.response.status !== 200 ||
      sample.body.trim().length === 0 ||
      sampleError
    ) {
      failures.push(
        createFailure(
          crawler.id,
          sampleUrl,
          `sampled sitemap link failed: ${sampleError ?? `HTTP ${sample.response.status} or empty body`}`,
          sample.response,
          sample.body,
        ),
      );
    }
  } catch (error) {
    failures.push(
      createFailure(
        crawler.id,
        sampleUrl,
        `sampled sitemap link fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
  return failures;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("maxConcurrency must be a positive integer");
  }
  const results: R[] = [];
  results.length = values.length;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await operation(values[index]!);
      }
    }),
  );
  return results;
}

export async function runAeoSyntheticChecks(
  contract: AeoSyntheticContract,
  fetchImpl: FetchLike = globalThis.fetch,
  options: RunOptions = {},
): Promise<SyntheticFailure[]> {
  if (options.validateConfig !== false) {
    const errors = validateAeoSyntheticConfig(contract);
    if (errors.length > 0) {
      throw new Error(`Invalid AEO synthetic baseline:\n${errors.join("\n")}`);
    }
  }
  const jobs = CRAWLERS.flatMap((crawler) =>
    targetsFromContract(contract).map((target) => ({ crawler, target })),
  );
  return (
    await mapWithConcurrency(
      jobs,
      options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      ({ crawler, target }) =>
        checkTarget(
          contract,
          target,
          crawler,
          fetchImpl,
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ),
    )
  ).flat();
}

export function formatSyntheticFailure(result: SyntheticFailure): string {
  return [
    `[FAIL] ${result.userAgent} ${result.url}: ${result.reason}`,
    `  observed HTTP ${result.observedStatus} ${result.observedContentType}`,
    `  response: ${result.responseSnippet}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const contract = loadAeoSyntheticContract(repositoryRoot);
  const failures = await runAeoSyntheticChecks(contract);
  if (failures.length > 0) {
    console.error(
      `AEO synthetic checks failed (${failures.length}):\n${failures
        .map(formatSyntheticFailure)
        .join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `AEO synthetic checks passed: 10 website/docs targets × ${CRAWLERS.length} crawler user agents`,
    );
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `AEO synthetic checks crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    process.exitCode = 1;
  });
}
