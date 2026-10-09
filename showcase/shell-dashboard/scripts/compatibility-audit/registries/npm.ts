import type { HttpClient, Inventory, Release } from "../types";

const ORIGIN = "https://registry.npmjs.org";
const PART = "[a-z0-9][a-z0-9._~-]*";
const PACKAGE_NAME = new RegExp(`^(?:${PART}|@${PART}/${PART})$`);
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function publishedAt(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_TIME.test(value)) return false;
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

/** Read the full npm packument; only current version objects establish membership. */
export async function collectNpm(
  name: string,
  client: HttpClient,
): Promise<Inventory> {
  if (!PACKAGE_NAME.test(name)) throw new Error("Invalid npm package name.");
  const encoded = encodeURIComponent(name).replace(/^%40/, "@");
  const sourceUrl = `${ORIGIN}/${encoded}`;
  const response = await client.get(sourceUrl, "application/json");
  if (
    response.url !== sourceUrl ||
    !Number.isInteger(response.status) ||
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new Error(`npm metadata request returned HTTP ${response.status}.`);
  }
  let packument: unknown;
  try {
    packument = JSON.parse(response.body);
  } catch {
    throw new Error("npm packument is not valid JSON.");
  }
  if (!record(packument)) throw new Error("npm packument must be an object.");
  if (packument.name !== name)
    throw new Error("npm package identity does not match the request.");
  if (
    !record(packument.versions) ||
    Object.keys(packument.versions).length === 0
  ) {
    throw new Error("npm packument has no current versions.");
  }
  if (!record(packument.time))
    throw new Error("npm packument has no publication time map.");

  const releases: Release[] = [];
  for (const version of Object.keys(packument.versions).sort()) {
    const metadata = packument.versions[version];
    if (
      !version ||
      !record(metadata) ||
      (metadata.version !== undefined && metadata.version !== version)
    ) {
      throw new Error("npm version metadata is malformed.");
    }
    const timestamp = packument.time[version];
    if (!publishedAt(timestamp)) {
      throw new Error("npm release publication time is missing or invalid.");
    }
    releases.push({
      version,
      timestamp,
      timestampKind: "published",
      eligible: true,
    });
  }

  return {
    registry: "npm",
    name,
    sourceUrl,
    releases,
    complete: true,
    diagnostics: [],
  };
}
