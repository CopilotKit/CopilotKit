import { satisfies, validRange } from "semver";
import type { ReleaseConfig, ReleaseScope } from "./config.js";

/**
 * Keeping one release scope's version line from freezing another's.
 *
 * Scopes are independent on the version axis and not on the dependency axis.
 * `@copilotkit/angular` is published from the `angular` scope on a `0.x` line
 * of its own while depending on `@copilotkit/core` from the `monorepo` scope,
 * and `pnpm pack` rewrites a `workspace:*` into the exact version in the tree
 * at pack time. So `angular@0.4.0` shipped pinning `core@1.69.3`; four days
 * later the monorepo scope released `1.70.0` and every Angular application
 * obeying the new dependency floor resolved two copies of core, one of which
 * did not export what the Angular package called (OSS-1107).
 *
 * Two rules follow, and this module is both of them.
 *
 * 1. A dependency that crosses a scope boundary must be declared as a range.
 *    `workspace:^` packs as `^1.70.0`, which a later `1.x` release satisfies;
 *    `workspace:*` packs as an exact version, which nothing later satisfies.
 *    Every `channels` package already does this. Angular did not.
 * 2. A release must not ship a version that the *published* manifests of the
 *    other scopes have stopped admitting. Rule 1 prevents the next instance;
 *    rule 2 catches the one already on the registry. Its remedy is an order,
 *    not a bigger release: the stranded scope is released first, from a tree
 *    where the new version is already set, because `workspace:^` resolves
 *    against the workspace rather than against what npm currently holds.
 */

/** A workspace manifest, reduced to what these rules read. */
export interface ScopedManifest {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * Dependency fields a consumer of the published package has to resolve.
 *
 * `devDependencies` are deliberately absent: npm never installs them for a
 * consumer, so an exact one cannot split a consumer's tree.
 */
const PUBLISHED_FIELDS = ["dependencies", "peerDependencies"] as const;

/** Which published dependency field an edge was declared in. */
export type PublishedField = (typeof PUBLISHED_FIELDS)[number];

/** One dependency that crosses a release-scope boundary. */
export interface CrossScopeEdge {
  readonly package: string;
  readonly packageScope: ReleaseScope;
  readonly field: PublishedField;
  readonly dependency: string;
  readonly dependencyScope: ReleaseScope;
  readonly range: string;
}

/** Builds a package-name-to-scope index from the release configuration. */
function scopeIndex(config: ReleaseConfig): ReadonlyMap<string, ReleaseScope> {
  const index = new Map<string, ReleaseScope>();
  for (const [scope, scopeConfig] of Object.entries(config.scopes)) {
    for (const name of scopeConfig.packages) {
      index.set(name, scope as ReleaseScope);
    }
  }
  return index;
}

/**
 * Every published dependency edge that crosses a release-scope boundary.
 *
 * @param workspace - The workspace manifests to read.
 * @param config - The release configuration that assigns packages to scopes.
 * @returns The crossing edges, in manifest and field order.
 */
export function crossScopeEdges(
  workspace: readonly ScopedManifest[],
  config: ReleaseConfig,
): readonly CrossScopeEdge[] {
  const index = scopeIndex(config);
  const edges: CrossScopeEdge[] = [];

  for (const manifest of workspace) {
    const packageScope = index.get(manifest.name);
    if (packageScope === undefined) continue;

    for (const field of PUBLISHED_FIELDS) {
      for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
        const dependencyScope = index.get(dependency);
        if (dependencyScope === undefined || dependencyScope === packageScope) {
          continue;
        }
        edges.push({
          dependency,
          dependencyScope,
          field,
          package: manifest.name,
          packageScope,
          range,
        });
      }
    }
  }

  return edges;
}

/**
 * Whether a declared range admits anything other than one exact version.
 *
 * `workspace:*` and `workspace:~` are read through to what `pnpm pack` writes:
 * `*` becomes the exact version in the tree, `~` and `^` become ranges. A
 * literal `1.69.3` is the same defect already resolved.
 *
 * @param range - The declared range.
 * @returns True when a later release of the dependency can satisfy it.
 */
function admitsALaterRelease(range: string): boolean {
  if (range.startsWith("workspace:")) {
    const protocol = range.slice("workspace:".length);
    return protocol === "^" || protocol === "~";
  }
  // A range semver cannot parse belongs to some other protocol (`file:`,
  // `npm:`, a git URL) and is not this rule's business.
  if (validRange(range) === null) return true;
  return !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(range.trim());
}

/**
 * Cross-scope dependencies declared as one exact version.
 *
 * @param workspace - The workspace manifests to read.
 * @param config - The release configuration that assigns packages to scopes.
 * @returns One human-readable problem per offending edge.
 */
export function findExactCrossScopePins(
  workspace: readonly ScopedManifest[],
  config: ReleaseConfig,
): readonly string[] {
  return crossScopeEdges(workspace, config)
    .filter((edge) => !admitsALaterRelease(edge.range))
    .map(
      (edge) =>
        `${edge.package} (scope ${edge.packageScope}) declares ${edge.dependency} ` +
        `(scope ${edge.dependencyScope}) as "${edge.range}" in ${edge.field}. ` +
        `The two scopes release separately, so an exact version freezes ${edge.dependency} ` +
        `at whatever shipped last and a consumer on a newer one resolves two copies. ` +
        `Use "workspace:^".`,
    );
}

/** What {@link findSupersededPublishedPins} needs to decide. */
export interface SupersededPinInputs {
  /** The scope about to be published. */
  readonly scope: ReleaseScope;
  /** The version that scope is about to be published at. */
  readonly version: string;
  /** The workspace manifests, for finding who depends on the scope. */
  readonly workspace: readonly ScopedManifest[];
  /**
   * The dependency map each other-scope package carries **on the registry**,
   * keyed by package name. A package absent from this map is not published.
   *
   * Read from the registry rather than the workspace on purpose: the workspace
   * may already carry the fix while the last publish baked in the exact pin,
   * and only the published one can split an installing consumer's tree.
   */
  readonly publishedDependencies: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  /** The release configuration that assigns packages to scopes. */
  readonly config: ReleaseConfig;
}

/**
 * Published packages whose declared range would stop admitting this release.
 *
 * @param inputs - The scope being released and what the registry already holds.
 * @returns One human-readable problem per package that would be left behind.
 */
export function findSupersededPublishedPins(
  inputs: SupersededPinInputs,
): readonly string[] {
  const problems: string[] = [];

  for (const edge of crossScopeEdges(inputs.workspace, inputs.config)) {
    if (edge.dependencyScope !== inputs.scope) continue;
    if (edge.packageScope === inputs.scope) continue;

    const published = inputs.publishedDependencies[edge.package];
    if (published === undefined) continue;

    const range = published[edge.dependency];
    if (range === undefined || validRange(range) === null) continue;
    if (satisfies(inputs.version, range)) continue;

    problems.push(
      `Published ${edge.package} declares ${edge.dependency} as "${range}", which ` +
        `${inputs.version} does not satisfy. Releasing scope ${inputs.scope} now would ` +
        `leave every consumer of ${edge.package} resolving two copies of ` +
        `${edge.dependency}. Release scope ${edge.packageScope} first, from this tree: ` +
        `it packs ${edge.dependency} as "${edge.range}", which resolves against the ` +
        `workspace version rather than the published one, so its new release admits ` +
        `${inputs.version} before this one ships.`,
    );
  }

  return problems;
}
