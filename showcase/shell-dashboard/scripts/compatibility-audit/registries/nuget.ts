import { hasAsciiControl } from "../ascii";
import type { HttpClient, Inventory, Release } from "../types";

const SERVICE_INDEX = "https://api.nuget.org/v3/index.json";
const SEMVER2_RESOURCE = "RegistrationsBaseUrl/3.6.0";
const MAX_PAGES = 512;
const MAX_RELEASES = 100_000;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`NuGet ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value))
    throw new Error(`NuGet ${label} must be an array.`);
  return value;
}

function count(value: unknown, maximum: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new Error(`NuGet ${label} count is invalid or exceeds its limit.`);
  }
  return value;
}

function officialUrl(value: unknown, allowFragment = false): URL {
  try {
    if (
      typeof value !== "string" ||
      hasAsciiControl(value) ||
      value.includes(" ")
    )
      throw new Error();
    const url = new URL(value);
    if (
      url.origin !== "https://api.nuget.org" ||
      url.username ||
      url.password ||
      url.search ||
      (!allowFragment && url.hash)
    )
      throw new Error();
    return url;
  } catch {
    // Do not echo a rejected URL that could contain credentials.
    throw new Error("NuGet metadata URL is not allowed.");
  }
}

async function document(
  url: string,
  client: HttpClient,
): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await client.get(url, "application/json");
  } catch {
    throw new Error("NuGet request failed; the inventory is incomplete.");
  }
  if (response.url !== url)
    throw new Error("NuGet response URL does not match its request.");
  if (
    !Number.isInteger(response.status) ||
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new Error(`NuGet request returned HTTP ${response.status}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(response.body);
  } catch {
    throw new Error("NuGet response is not valid JSON.");
  }
  return object(value, "response");
}

interface VersionIdentity {
  core: bigint[];
  prerelease: string[] | null;
  key: string;
}

/** NuGet identity/bound comparison only; target selection belongs to releases.ts. */
function version(value: unknown): VersionIdentity {
  if (typeof value !== "string" || value.length > 256)
    throw new Error("NuGet version is invalid.");
  const match =
    /^(\d+(?:\.\d+){0,3})(?:-([a-z0-9-]+(?:\.[a-z0-9-]+)*))?(?:\+([a-z0-9-]+(?:\.[a-z0-9-]+)*))?$/i.exec(
      value,
    );
  if (!match || match[0] !== value)
    throw new Error("NuGet version is invalid.");
  const core = match[1].split(".").map((part) => BigInt(part));
  while (core.length < 4) core.push(BigInt(0));
  const prerelease =
    match[2]
      ?.toLowerCase()
      .split(".")
      .map((part) => (/^\d+$/.test(part) ? BigInt(part).toString() : part)) ??
    null;
  return {
    core,
    prerelease,
    key: `${core.join(".")}${prerelease ? `-${prerelease.join(".")}` : ""}`,
  };
}

function compare(a: VersionIdentity, b: VersionIdentity): number {
  for (let index = 0; index < 4; index++) {
    if (a.core[index] !== b.core[index])
      return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease === null) return b.prerelease === null ? 0 : 1;
  if (b.prerelease === null) return -1;
  for (
    let index = 0;
    index < Math.min(a.prerelease.length, b.prerelease.length);
    index++
  ) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (leftNumeric) return BigInt(left) < BigInt(right) ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return a.prerelease.length - b.prerelease.length;
}

function publication(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || match[0] !== value || !Number.isFinite(Date.parse(value)))
    return null;
  // Date.parse normalizes impossible calendar dates; reject those explicitly.
  const calendar = new Date(`${match[1]}Z`);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 19) !== match[1]
  )
    return null;
  return value;
}

interface Page {
  url: string;
  count: number;
  lower: VersionIdentity;
  upper: VersionIdentity;
  items?: unknown[];
}

function pageDescriptor(value: unknown, indexUrl: string): Page {
  const page = object(value, "registration page");
  const embedded = Object.prototype.hasOwnProperty.call(page, "items");
  const url = officialUrl(page["@id"], embedded).href;
  const pageCount = count(page.count, MAX_RELEASES, "page");
  if (pageCount === 0) throw new Error("NuGet page count must be positive.");
  const lower = version(page.lower);
  const upper = version(page.upper);
  if (compare(lower, upper) > 0)
    throw new Error("NuGet page bounds are inverted.");
  if (page.parent !== undefined && officialUrl(page.parent).href !== indexUrl) {
    throw new Error("NuGet page parent does not match the registration index.");
  }
  return {
    url,
    count: pageCount,
    lower,
    upper,
    ...(embedded ? { items: list(page.items, "page items") } : {}),
  };
}

/** Collect a complete SemVer2 registration inventory without choosing a score. */
export async function collectNuget(
  name: string,
  client: HttpClient,
): Promise<Inventory> {
  if (
    typeof name !== "string" ||
    name.trim() !== name ||
    !/^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9_])?$/.test(name)
  ) {
    throw new Error("NuGet package ID is invalid.");
  }
  const service = await document(SERVICE_INDEX, client);
  const resources = list(service.resources, "service resources");
  if (resources.length > MAX_PAGES)
    throw new Error("NuGet service resource count exceeds its limit.");
  const bases = new Set<string>();
  for (const value of resources) {
    const resource = object(value, "service resource");
    const resourceTypes = resource["@type"];
    const types = Array.isArray(resourceTypes)
      ? resourceTypes
      : [resourceTypes];
    if (!types.includes(SEMVER2_RESOURCE)) continue;
    const base = officialUrl(resource["@id"]);
    if (!base.pathname.endsWith("/"))
      throw new Error("NuGet registration base URL must end with a slash.");
    bases.add(base.href);
  }
  if (bases.size !== 1)
    throw new Error(
      "NuGet service index must identify one SemVer2 registration base.",
    );
  const base = [...bases][0];
  const indexUrl = new URL(`${name.toLowerCase()}/index.json`, base).href;
  const index = await document(indexUrl, client);
  if (
    index["@id"] !== undefined &&
    officialUrl(index["@id"]).href !== indexUrl
  ) {
    throw new Error(
      "NuGet registration index identity does not match the request.",
    );
  }
  const descriptors = list(index.items, "index pages");
  if (count(index.count, MAX_PAGES, "index page") !== descriptors.length) {
    throw new Error("NuGet index page count does not match its items.");
  }
  const pages = descriptors.map((value) => pageDescriptor(value, indexUrl));
  if (new Set(pages.map((page) => page.url)).size !== pages.length) {
    throw new Error("NuGet registration contains duplicate page identities.");
  }
  if (pages.reduce((sum, page) => sum + page.count, 0) > MAX_RELEASES) {
    throw new Error("NuGet registration release count exceeds its limit.");
  }

  const releases: Release[] = [];
  const identities = new Set<string>();
  const diagnostics: string[] = [];
  for (const page of pages) {
    let items = page.items;
    if (items === undefined) {
      const external = await document(page.url, client);
      // Some valid NuGet page documents omit @id; the request still binds them.
      const loaded = pageDescriptor(
        { ...external, "@id": external["@id"] ?? page.url },
        indexUrl,
      );
      if (
        loaded.url !== page.url ||
        loaded.count !== page.count ||
        compare(loaded.lower, page.lower) !== 0 ||
        compare(loaded.upper, page.upper) !== 0
      ) {
        throw new Error(
          "NuGet fetched page bounds/count contradict the index.",
        );
      }
      items = loaded.items;
    }
    if (!items || items.length !== page.count)
      throw new Error("NuGet page count does not match its items.");
    let observedLower = false;
    let observedUpper = false;
    for (const value of items) {
      const leaf = object(value, "registration leaf");
      officialUrl(leaf["@id"]);
      const entry = object(leaf.catalogEntry, "catalog entry");
      if (
        typeof entry.id !== "string" ||
        entry.id.toLowerCase() !== name.toLowerCase()
      ) {
        throw new Error("NuGet catalog package ID does not match the request.");
      }
      const identity = version(entry.version);
      if (identities.has(identity.key))
        throw new Error(
          "NuGet registration contains a duplicate version identity.",
        );
      identities.add(identity.key);
      if (
        compare(identity, page.lower) < 0 ||
        compare(identity, page.upper) > 0
      ) {
        throw new Error("NuGet release falls outside its page bounds.");
      }
      observedLower ||= compare(identity, page.lower) === 0;
      observedUpper ||= compare(identity, page.upper) === 0;
      if (entry.listed !== undefined && typeof entry.listed !== "boolean") {
        throw new Error("NuGet catalog listed status must be a boolean.");
      }
      const date = publication(entry.published);
      const sentinel = date?.startsWith("1900-") ?? false;
      const eligible = entry.listed !== false && !sentinel;
      const timestamp = sentinel ? null : date;
      if (eligible && timestamp === null) {
        diagnostics.push(
          `NuGet publication date is unavailable for ${entry.version as string}.`,
        );
      }
      releases.push({
        version: entry.version as string,
        timestamp,
        timestampKind: "published",
        eligible,
      });
    }
    if (!observedLower || !observedUpper)
      throw new Error("NuGet page bounds are not represented in its records.");
  }
  releases.sort((a, b) => compare(version(a.version), version(b.version)));
  diagnostics.sort();
  return {
    registry: "nuget",
    name,
    sourceUrl: `https://www.nuget.org/packages/${encodeURIComponent(name)}`,
    releases,
    complete: diagnostics.length === 0,
    diagnostics,
  };
}
