// Loaded by dangerfile.ts through Danger's own require hook, which resolves
// extensionless `.ts` imports but not the `.js` specifiers tsx accepts.
// Keep runtime imports extensionless and everything else `import type`.
import type { PublicApiManifest } from "./public-api-manifest";
import { isBreakingCommit } from "./release-notes";

export const PUBLIC_API_MANIFEST_PATH =
  "scripts/release/public-api/manifest.v1.json";

/** A change under either prefix gives users a way across the break. */
export const MIGRATION_PATH_PREFIXES = [
  "codemods/",
  "showcase/shell-docs/src/content/docs/migrate/",
];

const RELEASE_LINE_BRANCH = /^\d+\.\d+\.\d+$/;

export function isReleaseLineBranch(ref: string): boolean {
  return RELEASE_LINE_BRANCH.test(ref);
}

type ManifestPackage = PublicApiManifest["packages"][number];
type SourceApiEntry = PublicApiManifest["runtime"]["serviceAdapters"][number];

function leafPaths(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function compatibilityBreaks(
  base: ManifestPackage,
  head: ManifestPackage,
): string[] {
  const breaks: string[] = [];
  const name = base.name;

  for (const [engine, range] of Object.entries(
    head.compatibility.engines ?? {},
  )) {
    const before = base.compatibility.engines?.[engine];
    if (before !== range) {
      breaks.push(
        `\`${name}\` engine \`${engine}\` changed from \`${String(before ?? "none")}\` to \`${String(range)}\``,
      );
    }
  }

  const baseOptional = new Set(base.compatibility.optionalPeerDependencies);
  const headOptional = new Set(head.compatibility.optionalPeerDependencies);
  for (const [peer, range] of Object.entries(
    head.compatibility.peerDependencies ?? {},
  )) {
    const before = base.compatibility.peerDependencies?.[peer];
    if (before === undefined) {
      if (!headOptional.has(peer)) {
        breaks.push(`\`${name}\` gained the required peer \`${peer}\``);
      }
    } else if (before !== range) {
      breaks.push(
        `\`${name}\` peer \`${peer}\` changed from \`${String(before)}\` to \`${String(range)}\``,
      );
    } else if (baseOptional.has(peer) && !headOptional.has(peer)) {
      breaks.push(`\`${name}\` peer \`${peer}\` is no longer optional`);
    }
  }

  return breaks;
}

function packageBreaks(base: ManifestPackage, head: ManifestPackage): string[] {
  const breaks: string[] = [];
  const headEntrypoints = new Map(
    head.entrypoints.map((entry) => [entry.exportKey, entry]),
  );

  for (const entry of base.entrypoints) {
    const headEntry = headEntrypoints.get(entry.exportKey);
    if (!headEntry) {
      breaks.push(`\`${entry.importPath}\` was removed`);
      continue;
    }
    const headConditions = new Set(leafPaths(headEntry.conditions));
    for (const condition of leafPaths(entry.conditions)) {
      if (condition && !headConditions.has(condition)) {
        breaks.push(
          `\`${entry.importPath}\` lost the \`${condition}\` export condition`,
        );
      }
    }
  }

  return [...breaks, ...compatibilityBreaks(base, head)];
}

function sourceApiBreaks(
  kind: string,
  base: Array<{ key: string; label: string; configurationKeys: string[] }>,
  head: Array<{ key: string; label: string; configurationKeys: string[] }>,
): string[] {
  const breaks: string[] = [];
  const headByKey = new Map(head.map((entry) => [entry.key, entry]));

  for (const entry of base) {
    const headEntry = headByKey.get(entry.key);
    if (!headEntry) {
      breaks.push(`${kind} ${entry.label} was removed`);
      continue;
    }
    const headKeys = new Set(headEntry.configurationKeys);
    for (const key of entry.configurationKeys) {
      if (!headKeys.has(key)) {
        breaks.push(`${kind} ${entry.label} lost the \`${key}\` option`);
      }
    }
  }

  return breaks;
}

function sourceEntries(entries: SourceApiEntry[]) {
  return entries.map((entry) => ({
    key: `${entry.importPath}:${entry.symbol}`,
    label: `\`${entry.symbol}\` from \`${entry.importPath}\``,
    configurationKeys: entry.configurationKeys,
  }));
}

/**
 * What a consumer could lose between two public API manifests: packages,
 * entrypoints and their export conditions, runtime factories and their
 * options, and deprecated exports. Additions are never reported, and
 * provenance and versions are ignored.
 */
export function findPublicApiBreaks(
  base: PublicApiManifest,
  head: PublicApiManifest,
): string[] {
  const breaks: string[] = [];
  const headPackages = new Map(head.packages.map((pkg) => [pkg.name, pkg]));

  for (const pkg of base.packages) {
    const headPkg = headPackages.get(pkg.name);
    if (headPkg) breaks.push(...packageBreaks(pkg, headPkg));
    else breaks.push(`\`${pkg.name}\` is no longer published`);
  }

  breaks.push(
    ...sourceApiBreaks(
      "Service adapter",
      sourceEntries(base.runtime.serviceAdapters),
      sourceEntries(head.runtime.serviceAdapters),
    ),
    ...sourceApiBreaks(
      "Host factory",
      sourceEntries(base.runtime.hostFactories),
      sourceEntries(head.runtime.hostFactories),
    ),
    ...sourceApiBreaks(
      "Agent factory mode",
      base.runtime.agentFactoryModes.map((mode) => ({
        key: mode.type,
        label: `\`${mode.type}\``,
        configurationKeys: mode.configurationKeys,
      })),
      head.runtime.agentFactoryModes.map((mode) => ({
        key: mode.type,
        label: `\`${mode.type}\``,
        configurationKeys: mode.configurationKeys,
      })),
    ),
  );

  const headDeprecations = new Set(
    head.deprecations.map((entry) => `${entry.importPath}:${entry.symbol}`),
  );
  for (const entry of base.deprecations) {
    if (!headDeprecations.has(`${entry.importPath}:${entry.symbol}`)) {
      breaks.push(
        `Deprecated \`${entry.symbol}\` from \`${entry.importPath}\` was removed`,
      );
    }
  }

  return breaks;
}

export interface BreakingChangeGateInput {
  title: string;
  body: string;
  /** Full commit messages: subject line, then the body. */
  commitMessages: string[];
  changedFiles: string[];
  apiBreaks: string[];
}

export interface BreakingChangeGateResult {
  /** Why the PR counts as breaking. Empty when it does not. */
  reasons: string[];
  /** Changed files that document or automate the migration. */
  migrationFiles: string[];
}

function splitMessage(message: string): { subject: string; body: string } {
  const [subject = "", ...rest] = message.split(/\r?\n/);
  return { subject, body: rest.join("\n") };
}

export function evaluateBreakingChangeGate(
  input: BreakingChangeGateInput,
): BreakingChangeGateResult {
  const reasons: string[] = [];

  if (isBreakingCommit({ subject: input.title, body: input.body })) {
    reasons.push("The PR title or description marks a breaking change.");
  }

  const breakingCommits = input.commitMessages
    .map(splitMessage)
    .filter((commit) => isBreakingCommit(commit));
  for (const commit of breakingCommits) {
    reasons.push(`Commit \`${commit.subject}\` marks a breaking change.`);
  }

  for (const apiBreak of input.apiBreaks) {
    reasons.push(`Public API: ${apiBreak}.`);
  }

  const migrationFiles = input.changedFiles.filter((file) =>
    MIGRATION_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );

  return { reasons, migrationFiles };
}
