import fs from "fs";
import path from "path";
import { loadConfig, getScopeConfig, ROOT } from "./config.js";
import type { ReleaseScope } from "./config.js";

export type BumpLevel = "patch" | "minor" | "major";

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export interface PublishablePackage {
  name: string;
  dir: string;
  pkgJsonPath: string;
  pkg: Record<string, any>;
}

/** Find a package directory by its npm name. */
function findPackageDir(packageName: string): string {
  const packagesDir = path.join(ROOT, "packages");
  for (const dir of fs.readdirSync(packagesDir)) {
    const pkgJsonPath = path.join(packagesDir, dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (pkg.name === packageName) return path.join(packagesDir, dir);
  }
  throw new Error(`Package not found: ${packageName}`);
}

/** Get the current version for a scope (reads from the scope's versionSource package). */
export function getCurrentVersion(scope: ReleaseScope): string {
  const scopeConfig = getScopeConfig(scope);
  const dir = findPackageDir(scopeConfig.versionSource);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  return pkg.version;
}

export function parseSemver(version: string): SemVer {
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+(.+))?$/,
  );
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  };
}

export function computeNextStableVersion(
  currentVersion: string,
  bumpLevel: BumpLevel,
): string {
  const v = parseSemver(currentVersion);

  if (v.prerelease) {
    return `${v.major}.${v.minor}.${v.patch}`;
  }

  switch (bumpLevel) {
    case "major":
      return `${v.major + 1}.0.0`;
    case "minor":
      return `${v.major}.${v.minor + 1}.0`;
    case "patch":
      return `${v.major}.${v.minor}.${v.patch + 1}`;
  }
}

/**
 * Resolve the identifier that separates one canary from the next: the
 * maintainer-supplied suffix, else a unix timestamp.
 *
 * Resolve this ONCE per publish run and pass it to every
 * {@link computePrereleaseVersion} call, so a multi-scope canary ships one
 * recognizable set of versions (`1.63.3-canary.1784916581` +
 * `0.2.2-canary.1784916581`) instead of per-scope timestamps that drift by
 * however long each scope took to bump.
 */
export function resolvePrereleaseId(suffix?: string): string {
  return suffix || String(Math.floor(Date.now() / 1000));
}

/**
 * Compute the version a canary publishes under: the next UNRELEASED version
 * plus `-<prereleaseTag>.<id>`.
 *
 * The base has to be the next version rather than the current one. A stable
 * release leaves the working tree sitting on the version it just published, so
 * appending `-canary` to that produces a prerelease semver sorts BELOW the
 * release it was cut from (`0.2.1-canary.17849… < 0.2.1`). Two things break as
 * a result: the `canary` dist-tag advertises something older than `latest`, and
 * no dependent range can ever resolve the canary, since npm admits prereleases
 * only for a range naming that same major.minor.patch. Bumping the patch first
 * keeps every canary above the last stable release.
 *
 * A working tree already carrying a prerelease is already sitting on an
 * unreleased version, so its base is used as-is — the same rule
 * {@link computeNextStableVersion} applies.
 */
export function computePrereleaseVersion(
  currentVersion: string,
  suffix?: string,
): string {
  const base = computeNextStableVersion(currentVersion, "patch");
  const tag = loadConfig().prereleaseTag;
  return `${base}-${tag}.${resolvePrereleaseId(suffix)}`;
}

/** Get all publishable packages in the order configured for a release scope. */
export function getPackagesForScope(scope: ReleaseScope): PublishablePackage[] {
  const scopeConfig = getScopeConfig(scope);
  const packagesDir = path.join(ROOT, "packages");
  const packagesByName = new Map<string, PublishablePackage>();

  for (const dir of fs.readdirSync(packagesDir)) {
    const pkgJsonPath = path.join(packagesDir, dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    packagesByName.set(pkg.name, {
      name: pkg.name,
      dir: path.join(packagesDir, dir),
      pkgJsonPath,
      pkg,
    });
  }

  return scopeConfig.packages.map((name) => {
    const pkg = packagesByName.get(name);
    if (!pkg) {
      throw new Error(`Package not found for scope ${scope}: ${name}`);
    }
    return pkg;
  });
}

/** Bump all packages in a scope to a new version. For sharedVersion scopes, also updates internal deps. */
export function bumpPackages(
  scope: ReleaseScope,
  newVersion: string,
): { name: string; oldVersion: string; newVersion: string }[] {
  const scopeConfig = getScopeConfig(scope);
  const packages = getPackagesForScope(scope);
  const scopeNames = new Set(scopeConfig.packages);
  const updated: { name: string; oldVersion: string; newVersion: string }[] =
    [];

  for (const p of packages) {
    const pkg = JSON.parse(fs.readFileSync(p.pkgJsonPath, "utf8"));
    const oldVersion = pkg.version;
    pkg.version = newVersion;

    // For shared-version scopes, update internal dependency references —
    // but only if they use exact versions, not workspace:* protocol
    if (scopeConfig.sharedVersion) {
      for (const depField of [
        "dependencies",
        "peerDependencies",
        "devDependencies",
      ] as const) {
        if (!pkg[depField]) continue;
        for (const depName of Object.keys(pkg[depField])) {
          const depValue = pkg[depField][depName];
          if (scopeNames.has(depName) && !depValue.startsWith("workspace:")) {
            pkg[depField][depName] = newVersion;
          }
        }
      }
    }

    fs.writeFileSync(p.pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
    updated.push({ name: p.name, oldVersion, newVersion });
  }

  return updated;
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
] as const;

export type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

export interface PrereleaseDependencyPin {
  from: string;
  dep: string;
  field: DependencyField;
  previousRange: string;
  version: string;
}

export interface PrereleaseManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Exact-pin every dependency edge contained within one prerelease publish set.
 *
 * This deliberately runs only from prerelease.ts, after the publish job has
 * restored the frozen lockfile. Stable manifests keep their authored ranges.
 * Exact canary pins are necessary because a packed `workspace:^` range such as
 * `^0.4.1-canary.1785375021` can resolve a semver-higher, incompatible canary
 * like `0.4.1-canary.perfall1` instead of the version built in this run.
 */
export function pinPrereleaseDependencies(
  packages: PublishablePackage[],
): PrereleaseDependencyPin[] {
  const manifests = packages.map((p) => ({
    package: p,
    manifest: JSON.parse(
      fs.readFileSync(p.pkgJsonPath, "utf8"),
    ) as PrereleaseManifest,
  }));
  const versions = new Map(
    manifests.map(({ manifest }) => [manifest.name, manifest.version]),
  );
  const pinned: PrereleaseDependencyPin[] = [];

  for (const { package: p, manifest } of manifests) {
    let changed = false;
    for (const field of DEPENDENCY_FIELDS) {
      const deps = manifest[field];
      if (!deps) continue;
      for (const [dep, previousRange] of Object.entries(deps)) {
        const version = versions.get(dep);
        if (!version || previousRange === version) continue;
        deps[dep] = version;
        changed = true;
        pinned.push({
          from: manifest.name,
          dep,
          field,
          previousRange,
          version,
        });
      }
    }
    if (changed) {
      fs.writeFileSync(p.pkgJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
      p.pkg = manifest;
    }
  }

  return pinned;
}

/**
 * Validate the packed, publishable graph after pnpm has transformed manifests.
 * Call this for the complete publish set before the first `npm publish`.
 */
export function validatePrereleaseDependencyPins(
  manifests: ReadonlyMap<string, PrereleaseManifest>,
): string[] {
  const problems: string[] = [];

  for (const owner of manifests.values()) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dep, range] of Object.entries(owner[field] ?? {})) {
        const dependency = manifests.get(dep);
        if (!dependency || range === dependency.version) continue;
        problems.push(
          `${owner.name} ${field}.${dep} must be exactly ${dependency.version}; found ${range}`,
        );
      }
    }
  }

  return problems;
}

/** A cross-scope dependency edge whose published pin won't be this run's version. */
export interface CrossScopePin {
  /** Package being published. */
  from: string;
  /** Its dependency, owned by a different release scope. */
  dep: string;
  /** The scope that owns `dep`. */
  depScope: ReleaseScope;
  /** Version the published manifest will carry for `dep`. */
  resolvesTo: string;
  /**
   * Why the pin is stale:
   * - `unpublished-scope`: a `workspace:` range that `pnpm pack` resolves against
   *   the working tree, where `depScope` was not bumped in this run. Publishing
   *   that scope too (scope=all) fixes it.
   * - `literal-range`: a hand-written version range on a cross-scope package.
   *   The dependency's scope is not in this run, so the range cannot carry its
   *   same-run version.
   */
  reason: "unpublished-scope" | "literal-range";
}

/**
 * Find cross-scope dependency edges whose published pin will NOT be a version
 * from this run.
 *
 * The failure this exists to make visible: `pnpm pack` resolves the workspace
 * protocol against the working tree, so a canary of one scope pins the other
 * scope's packages to their last stable release — even when the commit being
 * canaried changed both sides of the contract. The artifact then only composes
 * with that release, and nothing says so until a consumer hits a runtime error.
 *
 * Two shapes qualify: a `workspace:` or literal range into a scope that isn't
 * being published. Publishing the dependency's scope in the same prerelease run
 * makes either shape exact via {@link pinPrereleaseDependencies}. Both are
 * reported, tagged by {@link CrossScopePin.reason}.
 *
 * Only `dependencies`/`peerDependencies`/`optionalDependencies` are considered —
 * devDependencies never constrain a consumer's install.
 */
export function findCrossScopePins(scopes: ReleaseScope[]): CrossScopePin[] {
  const config = loadConfig();
  const scopeByPackage = new Map<string, ReleaseScope>();
  for (const [scope, scopeConfig] of Object.entries(config.scopes)) {
    for (const name of scopeConfig.packages) {
      scopeByPackage.set(name, scope as ReleaseScope);
    }
  }

  const publishing = new Set(scopes);
  const found: CrossScopePin[] = [];

  for (const scope of scopes) {
    for (const p of getPackagesForScope(scope)) {
      for (const depField of [
        "dependencies",
        "peerDependencies",
        "optionalDependencies",
      ] as const) {
        const deps = p.pkg[depField] as Record<string, string> | undefined;
        if (!deps) continue;
        for (const [dep, range] of Object.entries(deps)) {
          const depScope = scopeByPackage.get(dep);
          if (!depScope || depScope === scope || publishing.has(depScope)) {
            continue;
          }
          const isWorkspace = range.startsWith("workspace:");
          found.push({
            from: p.name,
            dep,
            depScope,
            // A literal range is published verbatim; a workspace: range is
            // rewritten to the dependency's working-tree version.
            resolvesTo: isWorkspace
              ? JSON.parse(
                  fs.readFileSync(
                    path.join(findPackageDir(dep), "package.json"),
                    "utf8",
                  ),
                ).version
              : range,
            reason: isWorkspace ? "unpublished-scope" : "literal-range",
          });
        }
      }
    }
  }

  return found;
}
