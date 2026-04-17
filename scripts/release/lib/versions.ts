import fs from "fs";
import path from "path";
import {
  loadConfig,
  getScopeConfig,
  ROOT,
  type ReleaseScope,
} from "./config.js";

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
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.\-]+))?(?:\+(.+))?$/,
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

export function computePrereleaseVersion(
  currentVersion: string,
  suffix?: string,
): string {
  const v = parseSemver(currentVersion);
  const config = loadConfig();
  const tag = config.prereleaseTag;
  const id = suffix || String(Math.floor(Date.now() / 1000));
  return `${v.major}.${v.minor}.${v.patch}-${tag}.${id}`;
}

/** Get all publishable packages for a given scope. */
export function getPackagesForScope(scope: ReleaseScope): PublishablePackage[] {
  const scopeConfig = getScopeConfig(scope);
  const packageNames = new Set(scopeConfig.packages);
  const packagesDir = path.join(ROOT, "packages");

  const results: PublishablePackage[] = [];
  for (const dir of fs.readdirSync(packagesDir)) {
    const pkgJsonPath = path.join(packagesDir, dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (packageNames.has(pkg.name)) {
      results.push({
        name: pkg.name,
        dir: path.join(packagesDir, dir),
        pkgJsonPath,
        pkg,
      });
    }
  }

  return results;
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
