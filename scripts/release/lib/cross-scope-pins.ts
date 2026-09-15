import { minVersion, satisfies, subset, validRange } from "semver";
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
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * Dependency fields a consumer of the published package has to resolve.
 *
 * `devDependencies` are deliberately absent: npm never installs them for a
 * consumer, so an exact one cannot split a consumer's tree.
 *
 * `optionalDependencies` are present: npm installs one unless the consumer
 * opts out, so an exact one splits the tree exactly like a normal dependency.
 * `versions.ts` already treats them as consumer-facing for the same reason.
 */
const PUBLISHED_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

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
 * The workspace protocol is read through to what `pnpm pack` writes. Bare
 * `workspace:*` becomes the exact version in the tree; bare `workspace:^` and
 * `workspace:~` become ranges; `workspace:^1.70.0` keeps the range it carries.
 *
 * Everything else is decided by semver rather than by spelling, so `1.69.3`,
 * `=1.69.3` and `1.69.3+build` are all recognised as the one exact pin they
 * are, and `>=1.70.0` is recognised as the range it is.
 *
 * @param range - The declared range.
 * @returns True when a later release of the dependency can satisfy it.
 */
function admitsALaterRelease(range: string): boolean {
  let declared = range.trim();

  if (declared.startsWith("workspace:")) {
    const protocol = declared.slice("workspace:".length);
    if (protocol === "*") return false;
    if (protocol === "^" || protocol === "~") return true;
    // A version-carrying workspace range packs as the range it carries.
    declared = protocol;
  }

  // A range semver cannot parse belongs to some other protocol (`file:`,
  // `npm:`, a git URL) and is not this rule's business.
  const parsed = validRange(declared);
  if (parsed === null) return true;

  // A range is an exact pin when the only version it admits is its own floor,
  // however that range is spelled.
  const floor = minVersion(parsed);
  if (floor === null) return true;
  return !subset(parsed, `=${floor.version}`);
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

/**
 * The consumer-facing dependency maps one package carries on the registry.
 *
 * Keyed by field, because a cross-scope edge can be declared as a normal, a
 * peer or an optional dependency, and every one of them is resolved for a
 * consumer. Reading only `dependencies` let a published peer range through.
 */
export type PublishedManifest = Readonly<
  Partial<Record<PublishedField, Readonly<Record<string, string>>>>
>;

/** What {@link findSupersededPublishedPins} needs to decide. */
export interface SupersededPinInputs {
  /** The scope about to be published. */
  readonly scope: ReleaseScope;
  /** The version that scope is about to be published at. */
  readonly version: string;
  /**
   * The workspace manifests. Used only to describe the remedy, because the
   * range the tree would pack is what makes releasing the stranded scope
   * first work.
   */
  readonly workspace: readonly ScopedManifest[];
  /**
   * What each other-scope package declares **on the registry**, keyed by
   * package name. A package absent from this map is not published.
   *
   * These, not the workspace edges, decide the outcome. A cross-scope
   * dependency dropped from the tree before its own scope republished is
   * still on the registry, still resolved by every consumer, and would go
   * unchecked if the edges came from the workspace graph.
   */
  readonly publishedDependencies: Readonly<Record<string, PublishedManifest>>;
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
  const index = scopeIndex(inputs.config);
  const problems: string[] = [];

  // What the tree would pack for each edge, so the remedy can name it.
  const workspaceRanges = new Map<string, string>();
  for (const edge of crossScopeEdges(inputs.workspace, inputs.config)) {
    workspaceRanges.set(`${edge.package}\u0000${edge.dependency}`, edge.range);
  }

  for (const [packageName, published] of Object.entries(
    inputs.publishedDependencies,
  )) {
    const packageScope = index.get(packageName);
    if (packageScope === undefined || packageScope === inputs.scope) continue;

    for (const field of PUBLISHED_FIELDS) {
      for (const [dependency, range] of Object.entries(
        published[field] ?? {},
      )) {
        if (index.get(dependency) !== inputs.scope) continue;
        if (validRange(range) === null) continue;
        if (satisfies(inputs.version, range)) continue;

        const workspaceRange = workspaceRanges.get(
          `${packageName}\u0000${dependency}`,
        );
        const remedy =
          workspaceRange === undefined
            ? `Release scope ${packageScope} first: this tree no longer declares ` +
              `${dependency} on ${packageName}, so its next release drops the ` +
              `superseded range altogether.`
            : `Release scope ${packageScope} first, from this tree: it packs ` +
              `${dependency} as "${workspaceRange}", which resolves against the ` +
              `workspace version rather than the published one, so its new release ` +
              `admits ${inputs.version} before this one ships.`;

        problems.push(
          `Published ${packageName} declares ${dependency} as "${range}" in ${field}, ` +
            `which ${inputs.version} does not satisfy. Releasing scope ${inputs.scope} ` +
            `now would leave every consumer of ${packageName} resolving two copies of ` +
            `${dependency}. ${remedy}`,
        );
      }
    }
  }

  return problems;
}
