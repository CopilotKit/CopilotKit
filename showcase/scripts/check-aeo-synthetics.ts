import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AEO_CONTRACT_PATH } from "./validate-aeo-contract";

const REQUIRED_USER_AGENTS = [
  "oai-searchbot",
  "claude-searchbot",
  "perplexitybot",
  "googlebot",
] as const;
const REQUIRED_CONTRACT_FIELDS = [
  "schemaVersion",
  "policyUrl",
  "capabilitiesUrl",
  "canonicalHosts",
  "classifications",
  "compatibility",
  "responseSemantics",
  "owners",
  "surfaces",
  "syntheticMonitoring",
  "reviewChecklist",
] as const;
const ASSERTIONS = [
  "non-empty",
  "no-soft-404",
  "canonical-host",
  "open-graph-host",
  "structured-data",
  "robots-sitemap-host",
  "sitemap-host",
  "sample-links",
  "links-host",
  "required-contract-fields",
] as const;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SAMPLE_LINK_COUNT = 1;

type HostKey = "website" | "docs" | "docsMcp";
type Assertion = (typeof ASSERTIONS)[number];
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface ContractSurface {
  id: string;
  host: HostKey;
  contentTypes: string[];
}

interface SyntheticTarget {
  surfaceId: string;
  path: string;
  contentType: string;
  assertions: Assertion[];
}

export interface AeoSyntheticContract {
  schemaVersion: number;
  policyUrl: string;
  capabilitiesUrl: string;
  canonicalHosts: Record<HostKey, string>;
  surfaces: ContractSurface[];
  syntheticMonitoring: {
    cadence: string;
    alertOwner: string;
    runbook?: { repositoryPath: string; url: string };
    userAgents: Array<{ id: string; value: string; sourceUrl: string }>;
    targets: SyntheticTarget[];
  };
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
  validateConfig?: boolean;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function loadAeoSyntheticContract(
  repositoryRoot: string,
): AeoSyntheticContract {
  const path = join(repositoryRoot, AEO_CONTRACT_PATH);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AeoSyntheticContract;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load AEO synthetic baseline ${path}: ${detail}`,
      {
        cause: error,
      },
    );
  }
}

export function validateAeoSyntheticConfig(
  contract: AeoSyntheticContract,
): string[] {
  const errors: string[] = [];
  const monitoring = contract.syntheticMonitoring;
  if (!monitoring || typeof monitoring !== "object") {
    return ["syntheticMonitoring must be an object"];
  }
  if (!nonEmpty(monitoring.cadence)) {
    errors.push("syntheticMonitoring.cadence must be a non-empty string");
  }
  if (!nonEmpty(monitoring.alertOwner)) {
    errors.push("syntheticMonitoring.alertOwner must be a non-empty string");
  }
  if (
    !monitoring.runbook ||
    !nonEmpty(monitoring.runbook.repositoryPath) ||
    !nonEmpty(monitoring.runbook.url) ||
    !URL.canParse(monitoring.runbook.url) ||
    new URL(monitoring.runbook.url).protocol !== "https:"
  ) {
    errors.push("syntheticMonitoring.runbook must name a path and HTTPS URL");
  }
  if (!Array.isArray(monitoring.userAgents)) {
    errors.push("syntheticMonitoring.userAgents must be an array");
  } else {
    const ids = new Set(monitoring.userAgents.map(({ id }) => id));
    for (const required of REQUIRED_USER_AGENTS) {
      if (!ids.has(required)) {
        errors.push(`synthetic user agent is missing: ${required}`);
      }
    }
    monitoring.userAgents.forEach((agent, index) => {
      if (
        !nonEmpty(agent.id) ||
        !nonEmpty(agent.value) ||
        !nonEmpty(agent.sourceUrl)
      ) {
        errors.push(`syntheticMonitoring.userAgents[${index}] is invalid`);
      } else {
        if (!URL.canParse(agent.sourceUrl)) {
          errors.push(
            `syntheticMonitoring.userAgents[${index}].sourceUrl is not an absolute URL`,
          );
        } else if (new URL(agent.sourceUrl).protocol !== "https:") {
          errors.push(
            `syntheticMonitoring.userAgents[${index}].sourceUrl must use https`,
          );
        }
      }
    });
  }

  const surfaces = new Map(
    contract.surfaces.map((surface) => [surface.id, surface]),
  );
  if (!Array.isArray(monitoring.targets) || monitoring.targets.length === 0) {
    errors.push("syntheticMonitoring.targets must be a non-empty array");
    return errors;
  }
  const targetKeys = new Set<string>();
  for (const target of monitoring.targets) {
    const key = `${target.surfaceId}:${target.path}`;
    if (targetKeys.has(key)) errors.push(`duplicate synthetic target: ${key}`);
    targetKeys.add(key);
    const surface = surfaces.get(target.surfaceId);
    if (!surface) {
      errors.push(
        `synthetic target references unknown surface: ${target.surfaceId}`,
      );
      continue;
    }
    if (!surface.contentTypes.includes(target.contentType)) {
      errors.push(
        `synthetic target ${target.surfaceId} content type ${target.contentType} is not declared by its contract surface`,
      );
    }
    if (!nonEmpty(target.path) || !target.path.startsWith("/")) {
      errors.push(
        `synthetic target ${target.surfaceId} path must start with /`,
      );
    }
    if (!Array.isArray(target.assertions) || target.assertions.length === 0) {
      errors.push(`synthetic target ${key} must declare assertions`);
    } else {
      for (const assertion of target.assertions) {
        if (!ASSERTIONS.includes(assertion)) {
          errors.push(
            `synthetic target ${key} has unknown assertion ${assertion}`,
          );
        }
      }
    }
  }
  for (const host of ["website", "docs", "docsMcp"] as const) {
    if (
      !monitoring.targets.some(
        (target) => surfaces.get(target.surfaceId)?.host === host,
      )
    ) {
      errors.push(
        `synthetic baseline has no target for canonical host: ${host}`,
      );
    }
  }
  if (
    !monitoring.targets.some(({ assertions }) =>
      assertions.includes("sample-links"),
    )
  ) {
    errors.push("synthetic baseline must sample at least one published link");
  }
  if (
    !monitoring.targets.some(({ assertions }) =>
      assertions.includes("required-contract-fields"),
    )
  ) {
    errors.push("synthetic baseline must verify required contract fields");
  }
  return errors;
}

function attributes(tag: string): Map<string, string> {
  const values = new Map<string, string>();
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    values.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return values;
}

function metadataUrl(
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

function sitemapUrls(text: string): string[] {
  return [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(
    (match) => match[1],
  );
}

function soft404Reason(body: string, contentType: string): string | undefined {
  if (!contentType.startsWith("text/html")) return undefined;
  for (const tag of body.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    if (
      attrs.get("name")?.toLowerCase() === "robots" &&
      attrs.get("content")?.toLowerCase().includes("noindex")
    ) {
      return "HTML response declares robots noindex (soft-404 signal)";
    }
  }
  if (/<h1[^>]*>\s*(?:404|page (?:not found|does not exist))/i.test(body)) {
    return "HTML response contains a not-found heading (soft-404 signal)";
  }
  if (/page (?:not found|could not be found|doesn'?t exist)/i.test(body)) {
    return "HTML response contains a not-found message (soft-404 signal)";
  }
  return undefined;
}

function assertUrlHost(
  raw: string | undefined,
  expectedOrigin: string,
  label: string,
): string | undefined {
  if (!raw) return `${label} is missing`;
  try {
    const parsed = new URL(raw);
    if (parsed.origin !== expectedOrigin) {
      return `${label} uses ${parsed.origin}; expected ${expectedOrigin}`;
    }
  } catch {
    return `${label} is not an absolute URL: ${raw}`;
  }
  return undefined;
}

function structuredDataReason(html: string): string | undefined {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => {
      const attrs = attributes(`<script ${match[1]}>`);
      return attrs.get("type")?.toLowerCase() === "application/ld+json";
    })
    .map((match) => match[2]);
  if (blocks.length === 0) return "schema.org JSON-LD script is missing";

  for (const block of blocks) {
    try {
      const value = JSON.parse(block) as Record<string, unknown>;
      const context = value["@context"];
      if (
        context === "https://schema.org" ||
        context === "http://schema.org" ||
        (Array.isArray(context) &&
          context.some(
            (item) =>
              item === "https://schema.org" || item === "http://schema.org",
          ))
      ) {
        return undefined;
      }
    } catch {
      // A later block may still be the valid schema.org document.
    }
  }
  return "no JSON-LD block parses successfully with a schema.org @context";
}

async function readBoundedBody(
  response: Response,
  streaming: boolean,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  let done = false;
  try {
    while (!done && byteCount < MAX_BODY_BYTES) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        const remaining = MAX_BODY_BYTES - byteCount;
        chunks.push(result.value.slice(0, remaining));
        byteCount += Math.min(result.value.byteLength, remaining);
      }
      if (streaming) break;
    }
    const merged = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
  }
}

function createFailure(
  userAgent: string,
  url: string,
  reason: string,
  status: number,
  contentType: string,
  body: string,
): SyntheticFailure {
  return {
    userAgent,
    url,
    reason,
    observedStatus: status,
    observedContentType: contentType || "(missing)",
    responseSnippet:
      body.replace(/\s+/g, " ").trim().slice(0, 240) || "(empty body)",
  };
}

async function fetchTarget(
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
    const body = await readBoundedBody(
      response,
      response.headers.get("content-type")?.startsWith("text/event-stream") ??
        false,
    );
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function targetReasons(
  target: SyntheticTarget,
  body: string,
  contentType: string,
  expectedOrigin: string,
  expectedUrl: string,
  canonicalOrigins: ReadonlySet<string>,
): string[] {
  const reasons: string[] = [];
  if (target.assertions.includes("non-empty") && body.trim().length === 0) {
    reasons.push("response body is empty");
  }
  if (target.assertions.includes("no-soft-404")) {
    const reason = soft404Reason(body, contentType);
    if (reason) reasons.push(reason);
  }
  if (target.assertions.includes("canonical-host")) {
    const canonical = metadataUrl(body, "rel", "canonical", "href");
    const reason = assertUrlHost(canonical, expectedOrigin, "canonical URL");
    if (reason) reasons.push(reason);
    if (canonical) {
      try {
        if (new URL(canonical).href !== expectedUrl) {
          reasons.push(
            `canonical URL is ${canonical}; expected ${expectedUrl}`,
          );
        }
      } catch {
        // assertUrlHost already records the malformed absolute URL.
      }
    }
  }
  if (target.assertions.includes("open-graph-host")) {
    const reason = assertUrlHost(
      metadataUrl(body, "property", "og:url", "content"),
      expectedOrigin,
      "Open Graph URL",
    );
    if (reason) reasons.push(reason);
  }
  if (target.assertions.includes("structured-data")) {
    const reason = structuredDataReason(body);
    if (reason) reasons.push(reason);
  }
  if (target.assertions.includes("robots-sitemap-host")) {
    const sitemap = body.match(/^Sitemap:\s*(\S+)/im)?.[1];
    const reason = assertUrlHost(sitemap, expectedOrigin, "robots sitemap URL");
    if (reason) reasons.push(reason);
  }
  if (target.assertions.includes("sitemap-host")) {
    const urls = sitemapUrls(body);
    if (urls.length === 0) reasons.push("sitemap contains no <loc> URLs");
    for (const url of urls) {
      const reason = assertUrlHost(url, expectedOrigin, "sitemap URL");
      if (reason) {
        reasons.push(reason);
        break;
      }
    }
  }
  if (target.assertions.includes("links-host")) {
    const indexedUrls = [
      ...body.matchAll(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g),
      ...body.matchAll(/^## Source:\s+(https?:\/\/\S+)\s*$/gm),
    ].map((match) => match[1]);
    if (indexedUrls.length === 0) {
      reasons.push("machine content contains no indexed URLs");
    }
    for (const url of indexedUrls) {
      try {
        const parsed = new URL(url);
        const isCopilotKitHost =
          parsed.hostname === "copilotkit.ai" ||
          parsed.hostname.endsWith(".copilotkit.ai");
        const isDeploymentHost = parsed.hostname.endsWith(".up.railway.app");
        if (
          (isCopilotKitHost && !canonicalOrigins.has(parsed.origin)) ||
          isDeploymentHost
        ) {
          reasons.push(
            `machine-content URL uses non-canonical production origin ${parsed.origin}`,
          );
          break;
        }
      } catch {
        reasons.push(`machine-content URL is not absolute: ${url}`);
        break;
      }
    }
  }
  if (target.assertions.includes("required-contract-fields")) {
    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      for (const field of REQUIRED_CONTRACT_FIELDS) {
        if (!(field in json)) {
          reasons.push(`required contract field ${field} is missing`);
        }
      }
    } catch (error) {
      reasons.push(
        `capability response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return reasons;
}

export async function runAeoSyntheticChecks(
  contract: AeoSyntheticContract,
  fetchImpl: FetchLike = globalThis.fetch,
  options: RunOptions = {},
): Promise<SyntheticFailure[]> {
  if (options.validateConfig !== false) {
    const configErrors = validateAeoSyntheticConfig(contract);
    if (configErrors.length > 0) {
      throw new Error(
        `Invalid AEO synthetic baseline:\n${configErrors.join("\n")}`,
      );
    }
  }
  const failures: SyntheticFailure[] = [];
  const surfaces = new Map(
    contract.surfaces.map((surface) => [surface.id, surface]),
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const canonicalOrigins = new Set(Object.values(contract.canonicalHosts));

  for (const agent of contract.syntheticMonitoring.userAgents) {
    for (const target of contract.syntheticMonitoring.targets) {
      const surface = surfaces.get(target.surfaceId)!;
      const expectedOrigin = contract.canonicalHosts[surface.host];
      const url = `${expectedOrigin}${target.path}`;
      let response: Response;
      let body: string;
      try {
        ({ response, body } = await fetchTarget(
          url,
          agent.value,
          fetchImpl,
          timeoutMs,
        ));
      } catch (error) {
        failures.push(
          createFailure(
            agent.id,
            url,
            `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
            0,
            "",
            "",
          ),
        );
        continue;
      }
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
      reasons.push(
        ...targetReasons(
          target,
          body,
          contentType,
          expectedOrigin,
          new URL(target.path, `${expectedOrigin}/`).href,
          canonicalOrigins,
        ),
      );
      if (reasons.length > 0) {
        failures.push(
          createFailure(
            agent.id,
            url,
            reasons.join("; "),
            response.status,
            contentType,
            body,
          ),
        );
        continue;
      }

      if (target.assertions.includes("sample-links")) {
        for (const sampleUrl of sitemapUrls(body).slice(0, SAMPLE_LINK_COUNT)) {
          try {
            const sample = await fetchTarget(
              sampleUrl,
              agent.value,
              fetchImpl,
              timeoutMs,
            );
            const sampleType =
              sample.response.headers.get("content-type") ?? "";
            const sampleSoft404 = soft404Reason(sample.body, sampleType);
            if (
              sample.response.status !== 200 ||
              sample.body.trim().length === 0 ||
              sampleSoft404
            ) {
              failures.push(
                createFailure(
                  agent.id,
                  sampleUrl,
                  `sampled sitemap link failed: ${sampleSoft404 ?? `HTTP ${sample.response.status} or empty body`}`,
                  sample.response.status,
                  sampleType,
                  sample.body,
                ),
              );
            }
          } catch (error) {
            failures.push(
              createFailure(
                agent.id,
                sampleUrl,
                `sampled sitemap link fetch failed: ${error instanceof Error ? error.message : String(error)}`,
                0,
                "",
                "",
              ),
            );
          }
        }
      }
    }
  }
  return failures;
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
    return;
  }
  console.log(
    `AEO synthetic checks passed: ${contract.syntheticMonitoring.targets.length} targets × ${contract.syntheticMonitoring.userAgents.length} crawler user agents`,
  );
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
