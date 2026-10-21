import { hasAsciiControl } from "../ascii";
import type { HttpClient, Inventory, Release } from "../types";

const ACCEPT = "application/vnd.pypi.simple.v1+json";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`PyPI ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parse(body: string, label: string): Record<string, unknown> {
  try {
    return record(JSON.parse(body), label);
  } catch {
    throw new Error(`PyPI ${label} is not valid JSON metadata`);
  }
}

function strings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item)
  ) {
    throw new Error(`PyPI ${label} must be an array of nonempty strings`);
  }
  return value;
}

function safeVersion(version: string): string {
  if (version === "." || version === ".." || hasAsciiControl(version)) {
    throw new Error("PyPI release version is invalid for a request URL");
  }
  return version;
}

function timestamp(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new Error(`PyPI ${label} has an invalid upload time`);
  }
  return value;
}

function yanked(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean" && typeof value !== "string") {
    throw new Error(`PyPI ${label} has an invalid yanked value`);
  }
  return Boolean(value);
}

function canonicalName(name: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name)) {
    throw new Error("PyPI project name is invalid");
  }
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function fileVersion(
  filename: string,
  project: string,
  versions: string[],
): string | null {
  if (filename.endsWith(".whl")) {
    const parts = filename.slice(0, -4).split("-");
    if (parts.length === 5 || parts.length === 6) {
      try {
        if (canonicalName(parts[0]) === project && versions.includes(parts[1]))
          return parts[1];
      } catch {
        // Unknown legacy filenames require release JSON confirmation.
      }
    }
    return null;
  }
  const extension = [".tar.gz", ".zip", ".tar.bz2", ".tar.xz"].find((item) =>
    filename.endsWith(item),
  );
  if (!extension) return null;
  const stem = filename.slice(0, -extension.length);
  const matches = versions.filter((version) => {
    const suffix = `-${version}`;
    if (!stem.endsWith(suffix)) return false;
    try {
      return canonicalName(stem.slice(0, -suffix.length)) === project;
    } catch {
      return false;
    }
  });
  return matches.length === 1 ? matches[0] : null;
}

interface FileFact {
  upload: string | null;
  yanked: boolean;
}

const order = (left: string, right: string): number => {
  const [leftSecond, leftFraction = ""] = left.slice(0, -1).split(".");
  const [rightSecond, rightFraction = ""] = right.slice(0, -1).split(".");
  return (
    leftSecond.localeCompare(rightSecond) ||
    leftFraction.padEnd(9, "0").localeCompare(rightFraction.padEnd(9, "0"))
  );
};

function release(version: string, files: FileFact[]): Release {
  const usable = files.filter((file) => !file.yanked);
  const known = usable
    .map((file) => file.upload)
    .filter((value): value is string => value !== null);
  return {
    version,
    timestamp:
      usable.length > 0 && known.length === usable.length
        ? known.sort(order)[0]
        : null,
    timestampKind: "published",
    eligible: usable.length > 0,
  };
}

function jsonFiles(value: unknown, label: string): FileFact[] {
  if (!Array.isArray(value)) throw new Error(`PyPI ${label} must be an array`);
  return value.map((entry, index) => {
    const file = record(entry, `${label}[${index}]`);
    return {
      upload: timestamp(file.upload_time_iso_8601, `${label}[${index}]`),
      yanked: yanked(file.yanked, `${label}[${index}]`),
    };
  });
}

/** Collect current PyPI inventory; release dates are earliest usable file uploads. */
export async function collectPypi(
  name: string,
  client: HttpClient,
): Promise<Inventory> {
  const normalized = canonicalName(name);
  const sourceUrl = `https://pypi.org/simple/${normalized}/`;
  const response = await client.get(sourceUrl, ACCEPT);
  if (response.status !== 200)
    throw new Error(`PyPI Simple Index returned HTTP ${response.status}`);
  const index = parse(response.body, "Simple Index");
  const meta = record(index.meta, "Simple Index meta");
  if (
    typeof meta["api-version"] !== "string" ||
    !/^1\.\d+$/.test(meta["api-version"])
  ) {
    throw new Error("PyPI Simple Index has an invalid API version");
  }
  if (
    index.name !== undefined &&
    (typeof index.name !== "string" || canonicalName(index.name) !== normalized)
  ) {
    throw new Error(
      "PyPI Simple Index project name does not match the request",
    );
  }
  if (!Array.isArray(index.files))
    throw new Error("PyPI Simple Index files must be an array");

  const versions =
    index.versions === undefined
      ? []
      : strings(index.versions, "Simple Index versions");
  const byVersion = new Map<string, FileFact[]>();
  const knownEmptyReleases = new Set<string>();
  for (const rawVersion of versions) {
    const version = safeVersion(rawVersion);
    if (!byVersion.has(version)) byVersion.set(version, []);
  }
  // API 1.0 lacks the versions field. A project JSON request is then needed to
  // enumerate empty releases as well as releases with unrecognized filenames.
  if (index.versions === undefined) {
    const projectUrl = `https://pypi.org/pypi/${normalized}/json`;
    const projectResponse = await client.get(projectUrl, "application/json");
    if (projectResponse.status !== 200)
      throw new Error(
        `PyPI project JSON returned HTTP ${projectResponse.status}`,
      );
    const project = parse(projectResponse.body, "project JSON");
    const releases = record(project.releases, "project JSON releases");
    for (const [rawVersion, entries] of Object.entries(releases)) {
      if (!Array.isArray(entries))
        throw new Error("PyPI project JSON release files must be arrays");
      const version = safeVersion(rawVersion);
      byVersion.set(version, []);
      if (entries.length === 0) knownEmptyReleases.add(version);
    }
  }

  const unresolvedFiles = new Set<string>();
  for (const [indexNumber, entry] of index.files.entries()) {
    const file = record(entry, `Simple Index files[${indexNumber}]`);
    if (typeof file.filename !== "string" || !file.filename) {
      throw new Error(
        `PyPI Simple Index files[${indexNumber}] has no filename`,
      );
    }
    const fact = {
      upload: timestamp(
        file["upload-time"],
        `Simple Index files[${indexNumber}]`,
      ),
      yanked: yanked(file.yanked, `Simple Index files[${indexNumber}]`),
    };
    const version = fileVersion(file.filename, normalized, [
      ...byVersion.keys(),
    ]);
    if (version === null) {
      unresolvedFiles.add(file.filename);
    } else {
      byVersion.get(version)!.push(fact);
    }
  }

  const releases: Release[] = [];
  const diagnostics: string[] = [];
  for (const [version, files] of byVersion) {
    // Project JSON already establishes these releases have no artifacts. They
    // cannot resolve an unfamiliar filename and need no per-version request.
    const knownEmpty = knownEmptyReleases.has(version) && files.length === 0;
    const needsJson =
      !knownEmpty &&
      (unresolvedFiles.size > 0 ||
        files.some((file) => !file.yanked && file.upload === null) ||
        (index.versions === undefined && files.length === 0));
    if (!needsJson) {
      releases.push(release(version, files));
      continue;
    }
    const versionUrl = `https://pypi.org/pypi/${normalized}/${encodeURIComponent(version)}/json`;
    const detail = await client.get(versionUrl, "application/json");
    if (detail.status !== 200)
      throw new Error(`PyPI release JSON returned HTTP ${detail.status}`);
    const detailBody = parse(detail.body, `release JSON for ${version}`);
    const info = record(detailBody.info, `release JSON info for ${version}`);
    if (info.version !== version)
      throw new Error(`PyPI release JSON version does not match ${version}`);
    const detailedFiles = jsonFiles(
      detailBody.urls,
      `release JSON urls for ${version}`,
    );
    for (const entry of detailBody.urls as unknown[]) {
      const filename = record(
        entry,
        `release JSON urls for ${version}`,
      ).filename;
      if (typeof filename === "string") unresolvedFiles.delete(filename);
    }
    const result = release(version, detailedFiles);
    if (result.eligible && result.timestamp === null) {
      diagnostics.push(
        `PyPI ${normalized} ${version} has an unyanked file without an upload time`,
      );
    }
    releases.push(result);
  }
  if (unresolvedFiles.size > 0) {
    diagnostics.push(
      `PyPI ${normalized} has ${unresolvedFiles.size} files with unresolved release membership`,
    );
  }
  return {
    registry: "pypi",
    name: normalized,
    sourceUrl,
    releases,
    complete: diagnostics.length === 0,
    diagnostics,
  };
}
