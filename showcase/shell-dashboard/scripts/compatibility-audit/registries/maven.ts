import type { HttpClient, Inventory, Release } from "../types";
import { parseXml, xmlChildren, xmlText } from "../xml";
import type { XmlNode } from "../xml";

const METADATA_ORIGIN = "https://repo1.maven.org/maven2";
const SEARCH_ORIGIN = "https://central.sonatype.com/solrsearch/select";
const PAGE_ROWS = 200;
const MAX_ROWS = 20_000;
const MAX_PAGES = Math.ceil(MAX_ROWS / PAGE_ROWS);

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Maven ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function one(node: XmlNode, name: string): XmlNode {
  const matches = xmlChildren(node, name);
  if (matches.length !== 1)
    throw new Error(`Maven metadata requires one ${name} element`);
  return matches[0];
}

function requiredText(node: XmlNode, name: string): string {
  const result = xmlText(one(node, name));
  if (!result) throw new Error(`Maven metadata has an empty ${name} element`);
  return result;
}

function versions(xml: string, group: string, artifact: string): Set<string> {
  // Central repository metadata has no namespace. xml.ts intentionally exposes
  // local names only, so reject declarations before interpreting those names.
  if (/\bxmlns(?::[A-Za-z_][\w.-]*)?\s*=/.test(xml)) {
    throw new Error("Maven metadata namespaces are unsupported");
  }
  const root = parseXml(xml);
  if (
    root.name !== "metadata" ||
    requiredText(root, "groupId") !== group ||
    requiredText(root, "artifactId") !== artifact
  ) {
    throw new Error("Maven metadata coordinates do not match the request");
  }
  const entries = xmlChildren(
    one(one(root, "versioning"), "versions"),
    "version",
  );
  if (entries.length === 0) throw new Error("Maven metadata has no versions");
  const result = new Set<string>();
  for (const entry of entries) {
    if (entry.children.length || !xmlText(entry)) {
      throw new Error("Maven metadata has an invalid version");
    }
    const version = xmlText(entry)!;
    if (result.has(version))
      throw new Error("Maven metadata has duplicate versions");
    result.add(version);
  }
  return result;
}

function searchUrl(group: string, artifact: string, page: number): string {
  const url = new URL(SEARCH_ORIGIN);
  url.searchParams.set("q", `g:"${group}" AND a:"${artifact}"`);
  url.searchParams.set("core", "gav");
  url.searchParams.set("rows", String(PAGE_ROWS));
  url.searchParams.set("start", String(page));
  url.searchParams.set("wt", "json");
  return url.href;
}

function searchDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Maven Search timestamp is invalid");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Maven Search timestamp is invalid");
  return date.toISOString();
}

/** Join Central's complete metadata inventory to bounded, paginated GAV dates. */
export async function collectMaven(
  groupColonArtifact: string,
  client: HttpClient,
): Promise<Inventory> {
  const parts = groupColonArtifact.split(":");
  const [group, artifact] = parts;
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(group) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(artifact) ||
    artifact.includes("..")
  ) {
    throw new Error("Invalid Maven group:artifact coordinates");
  }
  const sourceUrl = `${METADATA_ORIGIN}/${group.replaceAll(".", "/")}/${artifact}/maven-metadata.xml`;
  const metadata = await client.get(sourceUrl, "application/xml");
  if (metadata.url !== sourceUrl || metadata.status !== 200) {
    throw new Error(`Maven metadata request returned HTTP ${metadata.status}`);
  }
  const metadataVersions = versions(metadata.body, group, artifact);
  const searchVersions = new Map<string, string | null>();
  const diagnostics: string[] = [];
  let receivedRows = 0;
  let expected: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = searchUrl(group, artifact, page);
    const response = await client.get(url, "application/json");
    if (response.url !== url || response.status !== 200) {
      throw new Error(`Maven Search request returned HTTP ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new Error("Maven Search response is not valid JSON");
    }
    const data = object(
      object(parsed, "Search response").response,
      "Search result",
    );
    const count = data.numFound;
    if (
      !Number.isSafeInteger(count) ||
      (count as number) < 0 ||
      !Array.isArray(data.docs) ||
      data.docs.length > PAGE_ROWS ||
      (data.start !== undefined && data.start !== page)
    ) {
      throw new Error("Maven Search pagination metadata is invalid");
    }
    if (expected !== undefined && count !== expected) {
      diagnostics.push("Maven Search numFound changed during pagination");
      break;
    }
    expected = count as number;
    if (expected > MAX_ROWS) {
      diagnostics.push(`Maven Search exceeds the ${MAX_ROWS} row limit`);
      break;
    }
    if (receivedRows >= expected) break;
    if (data.docs.length === 0 || receivedRows + data.docs.length > expected) {
      diagnostics.push("Maven Search ended before numFound rows were returned");
      break;
    }
    for (const item of data.docs) {
      const row = object(item, "Search GAV row");
      if (
        row.g !== group ||
        row.a !== artifact ||
        typeof row.v !== "string" ||
        !row.v
      ) {
        throw new Error("Maven Search GAV row has conflicting coordinates");
      }
      const date = searchDate(row.timestamp);
      if (searchVersions.has(row.v)) {
        if (searchVersions.get(row.v) !== date) {
          throw new Error(`Maven Search has conflicting dates for ${row.v}`);
        }
        diagnostics.push(`Maven Search repeats version ${row.v}`);
      } else {
        searchVersions.set(row.v, date);
      }
    }
    receivedRows += data.docs.length;
    if (receivedRows === expected) break;
    if (data.docs.length < PAGE_ROWS) {
      diagnostics.push("Maven Search ended before numFound rows were returned");
      break;
    }
  }
  if (
    expected !== undefined &&
    receivedRows < expected &&
    !diagnostics.some(
      (item) =>
        item.includes("row limit") ||
        item.includes("ended before") ||
        item.includes("numFound changed"),
    )
  ) {
    diagnostics.push("Maven Search pagination exceeded the page limit");
  }

  for (const version of metadataVersions) {
    if (!searchVersions.has(version))
      diagnostics.push(`Maven Search is missing metadata version ${version}`);
    else if (searchVersions.get(version) === null)
      diagnostics.push(`Maven Search has no date for ${version}`);
  }
  for (const version of searchVersions.keys()) {
    if (!metadataVersions.has(version))
      diagnostics.push(
        `Maven Search has version ${version} absent from metadata`,
      );
  }
  const releases: Release[] = [...metadataVersions].sort().map((version) => ({
    version,
    timestamp: searchVersions.get(version) ?? null,
    timestampKind: "registry-last-updated",
    eligible: true,
  }));
  return {
    registry: "maven",
    name: groupColonArtifact,
    sourceUrl,
    releases,
    complete: diagnostics.length === 0,
    diagnostics,
  };
}
