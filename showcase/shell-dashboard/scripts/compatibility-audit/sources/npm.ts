import { createRequire } from "node:module";
import type { LibraryMapping, SavedFileReader, VersionFact } from "../types";

const GROUPS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

// Require a literal SemVer, including valid prerelease identifiers. Ranges,
// tags, leading "v"/"=", and numeric identifiers with leading zeros are not pins.
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface SemverRangeApi {
  validRange(range: string): unknown;
  satisfies(version: string, range: string): unknown;
}

function loadSemver(): SemverRangeApi {
  const loaded: unknown = createRequire(import.meta.url)("semver");
  const api = record(loaded);
  if (
    !api ||
    typeof api.validRange !== "function" ||
    typeof api.satisfies !== "function"
  ) {
    throw new Error(
      "The semver package does not expose the required range API.",
    );
  }
  return {
    validRange: api.validRange as SemverRangeApi["validRange"],
    satisfies: api.satisfies as SemverRangeApi["satisfies"],
  };
}

const semver = loadSemver();

function matchesDeclaration(version: string, spec: string): boolean {
  const range = semver.validRange(spec);
  if (range === null) {
    // A mutable dist-tag has no range to satisfy. Its already-validated root
    // association supplies the saved resolution; never look up today's tag.
    return encodeURIComponent(spec) === spec;
  }
  if (typeof range !== "string")
    throw new Error("The semver range API returned an invalid range result.");
  const matches = semver.satisfies(version, range);
  if (typeof matches !== "boolean")
    throw new Error(
      "The semver range API returned an invalid satisfaction result.",
    );
  return matches;
}

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key)
    ? value[key]
    : undefined;
}

function readJson(path: string, read: SavedFileReader) {
  // Missing/corrupt evidence from the reader must fail replay, not look like an
  // unpinned dependency. Only malformed JSON is an unknown source declaration.
  const body = read(path);
  try {
    return record(JSON.parse(body));
  } catch {
    return null;
  }
}

function exact(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    EXACT_VERSION.test(value)
  );
}

function declarations(
  project: Record<string, unknown>,
  name: string,
): (string | undefined)[] | null {
  const result: (string | undefined)[] = [];
  for (const group of GROUPS) {
    const raw = own(project, group);
    const entries = raw === undefined ? {} : record(raw);
    if (!entries) return null;
    const value = own(entries, name);
    if (value !== undefined && (typeof value !== "string" || !value.trim()))
      return null;
    result.push(value as string | undefined);
  }
  const distinct = new Set(result.filter((value) => value !== undefined));
  return distinct.size === 1 ? result : null;
}

/** Resolve captured source files, never installed state or registry metadata. */
export function resolveNpmSource(
  library: LibraryMapping,
  read: SavedFileReader,
): VersionFact {
  if (library.registry !== "npm" || library.source.kind !== "npm")
    throw new Error("npm source resolver requires an npm mapping");

  const { path, lockPath } = library.source;
  const evidence = [path];
  const unknown = (reason: string): VersionFact => ({
    version: null,
    basis: "unknown",
    evidence: [...evidence],
    reason,
  });
  if (library.source.transitive)
    return unknown(
      "Transitive npm libraries require installed version evidence.",
    );

  const project = readJson(path, read);
  if (!project) return unknown("The saved npm package manifest is invalid.");
  const declared = declarations(project, library.name);
  if (!declared)
    return unknown(
      "The npm library declaration is absent, invalid, or conflicting.",
    );
  const spec = declared.find((value) => value !== undefined)!;
  // Registry ranges and dist-tags can use the recorded root lock. Aliases,
  // Git/URL/local/workspace specs cannot establish this mapped registry identity.
  if (!/^[0-9A-Za-z_*~^<>=.+| -]+$/.test(spec) || spec !== spec.trim())
    return unknown("The npm declaration does not identify a registry library.");

  if (!lockPath) {
    return exact(spec)
      ? {
          version: spec,
          basis: "source-declared",
          evidence,
          reason: "Exact package.json pin; installed version was not observed.",
        }
      : unknown("The npm range or tag has no mapped resolving lockfile.");
  }

  evidence.push(lockPath);
  const lock = readJson(lockPath, read);
  if (!lock || ![2, 3].includes(lock.lockfileVersion as number))
    return unknown("The saved npm lockfile must use lockfileVersion 2 or 3.");
  const packages = record(own(lock, "packages"));
  const root = packages && record(own(packages, ""));
  if (!packages || !root)
    return unknown("The npm lockfile has no valid root package record.");
  for (const owner of [lock, root]) {
    for (const field of ["name", "version"]) {
      if (
        own(owner, field) !== undefined &&
        own(project, field) !== undefined &&
        own(owner, field) !== own(project, field)
      ) {
        return unknown("The npm lockfile belongs to a different root project.");
      }
    }
  }
  const lockedDeclarations = declarations(root, library.name);
  if (
    !lockedDeclarations ||
    declared.some((value, index) => value !== lockedDeclarations[index])
  ) {
    return unknown(
      "The root npm lock declaration does not match package.json.",
    );
  }

  // Nested copies may legitimately have other versions. Only the root location
  // resolves this project's direct declaration; never search arbitrary copies.
  const entry = record(own(packages, `node_modules/${library.name}`));
  if (!entry)
    return unknown("The npm lockfile has no resolving root library entry.");
  if (
    (entry.link !== undefined && entry.link !== false) ||
    (entry.name !== undefined && entry.name !== library.name)
  ) {
    return unknown(
      "The npm lock entry is linked or has a different package identity.",
    );
  }
  if (!exact(entry.version))
    return unknown(
      "The npm lock entry does not contain an exact library version.",
    );
  if (exact(spec) && entry.version !== spec)
    return unknown(
      "The npm lock version conflicts with the exact manifest pin.",
    );
  if (!matchesDeclaration(entry.version, spec))
    return unknown("The npm lock version does not satisfy the declared range.");

  return {
    version: entry.version,
    basis: "source-lock",
    evidence,
    reason:
      "Associated root package-lock version; installed version was not observed.",
  };
}
