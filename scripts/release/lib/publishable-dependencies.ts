/**
 * Publishability invariants for the `@copilotkit/*` workspace.
 *
 * Two things can silently make a published package uninstallable, and neither
 * was checked before this module existed:
 *
 *  1. A non-private package under `packages/` that no release scope enumerates.
 *     `publish-release.ts --scope <scope>` only publishes the packages listed in
 *     that scope, so such a package can never reach npm — while any scoped
 *     package that depends on it happily ships a specifier pointing at it.
 *     This is exactly how `@copilotkit/runtime` came to declare
 *     `"@copilotkit/intelligence": "workspace:^"` against a package no lane
 *     could publish: pnpm rewrites `workspace:` to a concrete range at pack
 *     time, so every `npm install @copilotkit/runtime` would have 404'd.
 *
 *  2. Cross-scope publish ORDER. Independently versioned scopes are released on
 *     their own cadence, so a dependency that lives in a different scope must
 *     already be on the registry at the version the rewrite will name.
 *
 * The functions here are pure so both the static CI guard (see
 * publishable-dependencies.test.ts, which runs on every PR via test_unit.yml)
 * and the live publish-time preflight in publish-release.ts can share them.
 */

import fs from "fs";
import path from "path";
import { ROOT, loadConfig } from "./config.js";
import type { ReleaseConfig, ReleaseScope } from "./config.js";

const COPILOTKIT_PREFIX = "@copilotkit/";
const WORKSPACE_PROTOCOL = "workspace:";

/**
 * The release pipeline resolves scope members by scanning `packages/` only
 * (see `getPackagesForScope` in ./versions.ts), so that is also the authoritative
 * set of "packages this repo can publish".
 */
const PACKAGES_DIR = "packages";

/** Dependency fields a consumer of a published package actually installs. */
export type DependencyField = "dependencies" | "peerDependencies";

const DEPENDENCY_FIELDS: readonly DependencyField[] = [
  "dependencies",
  "peerDependencies",
];

export interface WorkspacePackage {
  name: string;
  /** Repo-relative directory, e.g. `packages/runtime`. */
  directory: string;
  version: string;
  isPrivate: boolean;
  dependencies: Readonly<Record<string, string>>;
  peerDependencies: Readonly<Record<string, string>>;
}

function readRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/** Load every `packages/*` manifest, sorted by package name for stable output. */
export function loadWorkspacePackages(root: string = ROOT): WorkspacePackage[] {
  const packagesDir = path.join(root, PACKAGES_DIR);
  const packages: WorkspacePackage[] = [];

  for (const entry of fs.readdirSync(packagesDir).sort()) {
    const pkgJsonPath = path.join(packagesDir, entry, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof pkg.name !== "string") {
      throw new Error(`${PACKAGES_DIR}/${entry}/package.json has no name`);
    }
    packages.push({
      name: pkg.name,
      directory: `${PACKAGES_DIR}/${entry}`,
      version: typeof pkg.version === "string" ? pkg.version : "",
      isPrivate: pkg.private === true,
      dependencies: readRecord(pkg.dependencies),
      peerDependencies: readRecord(pkg.peerDependencies),
    });
  }

  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Map package name → the release scopes that enumerate it. A well-formed
 * config yields at most one scope per package; the array shape exists so
 * double-enrollment is reportable instead of silently shadowed.
 */
export function buildScopeIndex(
  config: ReleaseConfig = loadConfig(),
): Map<string, ReleaseScope[]> {
  const index = new Map<string, ReleaseScope[]>();
  for (const [scope, scopeConfig] of Object.entries(config.scopes) as [
    ReleaseScope,
    ReleaseConfig["scopes"][ReleaseScope],
  ][]) {
    for (const name of scopeConfig.packages) {
      const scopes = index.get(name);
      if (scopes) {
        if (!scopes.includes(scope)) scopes.push(scope);
      } else {
        index.set(name, [scope]);
      }
    }
  }
  return index;
}

export interface EnrollmentViolation {
  name: string;
  directory: string;
  scopes: ReleaseScope[];
}

/**
 * Non-private `packages/*` packages that no release scope enumerates. Such a
 * package is published by nothing, so anything depending on it ships a
 * dangling specifier.
 */
export function findUnenrolledPublishablePackages(
  packages: readonly WorkspacePackage[],
  scopeIndex: ReadonlyMap<string, ReleaseScope[]>,
): EnrollmentViolation[] {
  return packages
    .filter((pkg) => !pkg.isPrivate && !scopeIndex.has(pkg.name))
    .map((pkg) => ({ name: pkg.name, directory: pkg.directory, scopes: [] }));
}

/**
 * Packages enumerated by more than one scope. Two scopes publishing the same
 * package race each other's versions.
 */
export function findMultiplyEnrolledPackages(
  packages: readonly WorkspacePackage[],
  scopeIndex: ReadonlyMap<string, ReleaseScope[]>,
): EnrollmentViolation[] {
  return packages
    .map((pkg) => ({
      name: pkg.name,
      directory: pkg.directory,
      scopes: scopeIndex.get(pkg.name) ?? [],
    }))
    .filter((violation) => violation.scopes.length > 1);
}

export interface CopilotKitDependencyEdge {
  dependent: string;
  dependentScope: ReleaseScope;
  field: DependencyField;
  dependency: string;
  range: string;
  /** The scope that publishes `dependency`, or null when nothing does. */
  dependencyScope: ReleaseScope | null;
  /** The dependency's in-repo version, or null when it is not an in-repo package. */
  workspaceVersion: string | null;
}

/**
 * Every `@copilotkit/*` entry in the `dependencies`/`peerDependencies` of a
 * scope-enrolled package. `devDependencies` are excluded: consumers never
 * install them.
 */
export function collectCopilotKitDependencyEdges(
  packages: readonly WorkspacePackage[],
  scopeIndex: ReadonlyMap<string, ReleaseScope[]>,
): CopilotKitDependencyEdge[] {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const edges: CopilotKitDependencyEdge[] = [];

  for (const pkg of packages) {
    const dependentScope = scopeIndex.get(pkg.name)?.[0];
    if (!dependentScope) continue;

    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependency, range] of Object.entries(pkg[field])) {
        if (!dependency.startsWith(COPILOTKIT_PREFIX)) continue;
        const inRepo = byName.get(dependency);
        edges.push({
          dependent: pkg.name,
          dependentScope,
          field,
          dependency,
          range,
          dependencyScope: scopeIndex.get(dependency)?.[0] ?? null,
          workspaceVersion: inRepo ? inRepo.version : null,
        });
      }
    }
  }

  return edges;
}

/**
 * Edges whose dependency cannot be published by any lane: either it is an
 * in-repo `packages/*` package outside every scope, or it uses the
 * `workspace:` protocol (which pnpm can only rewrite for a workspace member)
 * while not being a publishable `packages/*` package at all.
 *
 * A plain semver range on a name that is NOT an in-repo package is fine — that
 * is an ordinary registry dependency (e.g. `@copilotkit/license-verifier`),
 * and `pnpm install --frozen-lockfile` already proves it resolves.
 */
export function findUnpublishableDependencyEdges(
  edges: readonly CopilotKitDependencyEdge[],
): CopilotKitDependencyEdge[] {
  return edges.filter(
    (edge) =>
      edge.dependencyScope === null &&
      (edge.workspaceVersion !== null ||
        edge.range.startsWith(WORKSPACE_PROTOCOL)),
  );
}

/** Edges that cross a release-scope boundary (both sides publishable). */
export function findCrossScopeDependencyEdges(
  edges: readonly CopilotKitDependencyEdge[],
): CopilotKitDependencyEdge[] {
  return edges.filter(
    (edge) =>
      edge.dependencyScope !== null &&
      edge.dependencyScope !== edge.dependentScope,
  );
}

export interface CrossScopeReleaseRequirement {
  dependency: string;
  dependencyScope: ReleaseScope;
  /**
   * The in-repo version of the dependency. pnpm rewrites `workspace:*` to
   * exactly this version and `workspace:^` / `workspace:~` to a range floored
   * at it, so this version must exist on the registry for the published
   * specifier to resolve as intended.
   */
  requiredVersion: string;
  dependents: string[];
}

/**
 * What must already be on npm before `scope` may publish. Restricted to
 * `dependencies` using the `workspace:` protocol — those are the specifiers
 * pnpm rewrites, and therefore the ones that break `npm install` outright.
 * Cross-scope peer ranges are left to the static guard above, which requires
 * the peer target to be enrolled in some scope.
 */
export function collectCrossScopeReleaseRequirements(
  scope: ReleaseScope,
  edges: readonly CopilotKitDependencyEdge[],
): CrossScopeReleaseRequirement[] {
  const requirements = new Map<string, CrossScopeReleaseRequirement>();

  for (const edge of edges) {
    if (edge.dependentScope !== scope) continue;
    if (edge.field !== "dependencies") continue;
    if (!edge.range.startsWith(WORKSPACE_PROTOCOL)) continue;
    if (edge.dependencyScope === null || edge.dependencyScope === scope) {
      continue;
    }
    if (!edge.workspaceVersion) {
      throw new Error(
        `${edge.dependent} depends on ${edge.dependency} via "${edge.range}" but no ${PACKAGES_DIR}/* manifest provides its version`,
      );
    }

    const existing = requirements.get(edge.dependency);
    if (existing) {
      if (!existing.dependents.includes(edge.dependent)) {
        existing.dependents.push(edge.dependent);
      }
      continue;
    }
    requirements.set(edge.dependency, {
      dependency: edge.dependency,
      dependencyScope: edge.dependencyScope,
      requiredVersion: edge.workspaceVersion,
      dependents: [edge.dependent],
    });
  }

  return [...requirements.values()].sort((left, right) =>
    left.dependency.localeCompare(right.dependency),
  );
}

/**
 * Requirements the registry does not satisfy. A missing map entry is treated
 * as "not published" so a 404 and an unknown package fail identically.
 */
export function findUnsatisfiedCrossScopeRequirements(
  requirements: readonly CrossScopeReleaseRequirement[],
  publishedVersions: ReadonlyMap<string, readonly string[]>,
): CrossScopeReleaseRequirement[] {
  return requirements.filter((requirement) => {
    const versions = publishedVersions.get(requirement.dependency);
    return !versions || !versions.includes(requirement.requiredVersion);
  });
}

export function formatUnsatisfiedCrossScopeRequirements(
  scope: ReleaseScope,
  unsatisfied: readonly CrossScopeReleaseRequirement[],
): string {
  const lines = unsatisfied.map(
    (requirement) =>
      `  ${requirement.dependency}@${requirement.requiredVersion} ` +
      `(scope "${requirement.dependencyScope}") — required by ${requirement.dependents.join(", ")}`,
  );
  return [
    `Refusing to publish scope "${scope}": cross-scope dependencies are not on npm yet.`,
    ...lines,
    "",
    `pnpm rewrites "workspace:" specifiers to concrete versions at pack time, so`,
    `publishing now would ship a dependency range that resolves to nothing.`,
    `Release the scope(s) listed above first, then re-run this release.`,
  ].join("\n");
}
