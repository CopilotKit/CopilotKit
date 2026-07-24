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

/** A published dependency edge that leaves the set of scopes being published. */
export interface CrossScopeDependency {
  /** Package being published. */
  from: string;
  /** Its `workspace:` dependency, owned by a scope that is NOT being published. */
  dep: string;
  /** The scope that owns `dep`. */
  depScope: ReleaseScope;
  /** Version `pnpm pack` will rewrite the workspace protocol to. */
  resolvesTo: string;
}

/**
 * Find dependency edges that leave `scopes`: a package being published whose
 * `workspace:` dependency belongs to a scope that ISN'T.
 *
 * `pnpm pack` resolves the workspace protocol against the working tree, so every
 * such edge is pinned to the dependency's CURRENT version — for a scope that was
 * not bumped in this run, its last stable release. The published artifact then
 * only composes with that release, even when the commit being canaried changed
 * both sides of the edge. Callers surface these so the pin is a visible choice
 * rather than a silent one.
 *
 * Only `dependencies`/`peerDependencies`/`optionalDependencies` are considered —
 * devDependencies never constrain a consumer's install.
 */
export function findCrossScopeWorkspaceDeps(
  scopes: ReleaseScope[],
): CrossScopeDependency[] {
  const config = loadConfig();
  const scopeByPackage = new Map<string, ReleaseScope>();
  for (const [scope, scopeConfig] of Object.entries(config.scopes)) {
    for (const name of scopeConfig.packages) {
      scopeByPackage.set(name, scope as ReleaseScope);
    }
  }

  const publishing = new Set(scopes);
  const found: CrossScopeDependency[] = [];

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
          if (!range.startsWith("workspace:")) continue;
          const depScope = scopeByPackage.get(dep);
          if (!depScope || publishing.has(depScope)) continue;
          found.push({
            from: p.name,
            dep,
            depScope,
            resolvesTo: JSON.parse(
              fs.readFileSync(
                path.join(findPackageDir(dep), "package.json"),
                "utf8",
              ),
            ).version,
          });
        }
      }
    }
  }

  return found;
}
