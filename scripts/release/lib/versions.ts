import fs from "fs";
import path from "path";
import { loadConfig, ROOT } from "./config.js";

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
  isVersionedTogether: boolean;
  isVersionedIndependently: boolean;
}

export function getCurrentVersion(): string {
  const pkgPath = path.join(ROOT, "packages/react-core/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
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

export function getPublishablePackages(): PublishablePackage[] {
  const config = loadConfig();
  const allPackageNames = new Set([
    ...config.versionedTogether,
    ...config.versionedIndependently,
  ]);
  const packagesDir = path.join(ROOT, "packages");

  const results: PublishablePackage[] = [];
  for (const dir of fs.readdirSync(packagesDir)) {
    const pkgJsonPath = path.join(packagesDir, dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (allPackageNames.has(pkg.name)) {
      results.push({
        name: pkg.name,
        dir: path.join(packagesDir, dir),
        pkgJsonPath,
        pkg,
        isVersionedTogether: config.versionedTogether.includes(pkg.name),
        isVersionedIndependently: config.versionedIndependently.includes(
          pkg.name,
        ),
      });
    }
  }

  return results;
}

export function bumpVersionedTogetherPackages(
  newVersion: string,
): { name: string; oldVersion: string; newVersion: string }[] {
  const packages = getPublishablePackages().filter(
    (p) => p.isVersionedTogether,
  );
  const config = loadConfig();
  const togetherNames = new Set(config.versionedTogether);
  const updated: { name: string; oldVersion: string; newVersion: string }[] =
    [];

  for (const p of packages) {
    const pkg = JSON.parse(fs.readFileSync(p.pkgJsonPath, "utf8"));
    const oldVersion = pkg.version;
    pkg.version = newVersion;

    for (const depField of [
      "dependencies",
      "peerDependencies",
      "devDependencies",
    ] as const) {
      if (!pkg[depField]) continue;
      for (const depName of Object.keys(pkg[depField])) {
        if (togetherNames.has(depName)) {
          pkg[depField][depName] = newVersion;
        }
      }
    }

    fs.writeFileSync(p.pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
    updated.push({ name: p.name, oldVersion, newVersion });
  }

  return updated;
}
