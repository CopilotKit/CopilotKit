/**
 * Verify that one release scope's version line cannot freeze another's.
 *
 * Two modes:
 *
 *   tsx scripts/release/verify-cross-scope-pins.ts
 *     Static. Fails when a published dependency crossing a scope boundary is
 *     declared as one exact version. Runs on every push.
 *
 *   tsx scripts/release/verify-cross-scope-pins.ts --registry --scope <scope>
 *     Registry-backed. Fails when the version this scope is about to publish is
 *     no longer admitted by another scope's *published* manifest, and names the
 *     scope that has to be released alongside it. Runs before a stable publish.
 *
 * Why both: the static rule stops the next instance, and the registry rule
 * catches the one already on npm. `@copilotkit/angular@0.4.0` pinned
 * `@copilotkit/core@1.69.3`; the monorepo scope then released `1.70.0` and
 * every Angular application obeying the new dependency floor resolved two
 * copies of core (OSS-1107).
 */

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, loadConfig, resolveScopes } from "./lib/config.js";
import type { ReleaseScope } from "./lib/config.js";
import {
  findExactCrossScopePins,
  findSupersededPublishedPins,
} from "./lib/cross-scope-pins.js";
import type {
  PublishedManifest,
  ScopedManifest,
} from "./lib/cross-scope-pins.js";
import { getCurrentVersion } from "./lib/versions.js";

/** Reads the manifest of every package under `packages/`. */
function readWorkspaceManifests(): readonly ScopedManifest[] {
  const packagesDir = join(ROOT, "packages");
  const manifests: ScopedManifest[] = [];

  for (const entry of readdirSync(packagesDir)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        readFileSync(join(packagesDir, entry, "package.json"), "utf8"),
      );
    } catch {
      continue;
    }
    const manifest = parsed as ScopedManifest;
    if (typeof manifest?.name === "string") manifests.push(manifest);
  }

  return manifests;
}

/** The dependency fields npm resolves for a consumer of a published package. */
const PUBLISHED_FIELD_NAMES = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Reads every consumer-facing dependency map a package carries on the registry.
 *
 * All three fields are fetched, not just `dependencies`: a cross-scope edge
 * declared as a peer or an optional dependency is resolved for a consumer just
 * the same, and reading one field let those ranges through unchecked.
 *
 * An unpublished package answers `undefined` rather than throwing: a package
 * that has never shipped cannot be left behind by this release. Any other
 * registry failure throws, because a release must not be waved through by a
 * check that could not run.
 */
function readPublishedManifest(
  packageName: string,
): PublishedManifest | undefined {
  const result = spawnSync(
    "npm",
    ["view", `${packageName}@latest`, ...PUBLISHED_FIELD_NAMES, "--json"],
    { encoding: "utf8", timeout: 30_000 },
  );

  if (result.status === 0) {
    const output = result.stdout.trim();
    if (output === "") return {};
    const parsed = JSON.parse(output) as unknown;
    // `npm view` returns the bare field value when one field is asked for and
    // an object keyed by field when several are. Guard both, because a package
    // that declares none of them answers with an empty object either way.
    if (parsed === null || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    const manifest: {
      -readonly [F in keyof PublishedManifest]: Record<string, string>;
    } = {};
    for (const field of PUBLISHED_FIELD_NAMES) {
      const value = record[field];
      if (value !== null && typeof value === "object") {
        manifest[field] = value as Record<string, string>;
      }
    }
    return manifest;
  }

  const stderr = result.stderr ?? "";
  if (stderr.includes("E404") || stderr.includes("is not in this registry")) {
    return undefined;
  }
  throw new Error(
    `npm registry check failed for ${packageName}: ${stderr.trim() || "unknown error"}`,
  );
}

/** Reports problems and sets a non-zero exit code, or reports the pass. */
function report(problems: readonly string[], passed: string): void {
  if (problems.length === 0) {
    console.log(`OK: ${passed}`);
    return;
  }
  console.error(
    `Cross-scope dependency violations:\n${problems
      .map((problem) => `  - ${problem}`)
      .join("\n")}`,
  );
  process.exitCode = 1;
}

function main(): void {
  const argv = process.argv.slice(2);
  const config = loadConfig();
  const workspace = readWorkspaceManifests();

  if (!argv.includes("--registry")) {
    report(
      findExactCrossScopePins(workspace, config),
      "every cross-scope @copilotkit dependency is declared as a range.",
    );
    return;
  }

  const scopeIndex = argv.indexOf("--scope");
  const requested = scopeIndex === -1 ? undefined : argv[scopeIndex + 1];
  if (requested === undefined) {
    throw new Error("--registry requires --scope <scope>");
  }
  const scopes: readonly ReleaseScope[] = resolveScopes(requested);

  // Every scope named in one run publishes together, so a pin one of them would
  // supersede is about to be rewritten by another. Only the scopes left out can
  // be left behind.
  const releasing = new Set(scopes);

  // Read the registry for every package of every scope left out, rather than
  // for the dependents the workspace graph still names. A cross-scope
  // dependency deleted from the tree before its own scope republished is gone
  // from that graph while the published manifest still carries it, and that
  // published range is what an installing consumer resolves.
  const candidates: string[] = [];
  for (const [scope, scopeConfig] of Object.entries(config.scopes)) {
    if (releasing.has(scope as ReleaseScope)) continue;
    candidates.push(...scopeConfig.packages);
  }

  const publishedDependencies: Record<string, PublishedManifest> = {};
  for (const name of candidates) {
    const published = readPublishedManifest(name);
    if (published !== undefined) publishedDependencies[name] = published;
  }

  const problems: string[] = [];
  for (const scope of scopes) {
    problems.push(
      ...findSupersededPublishedPins({
        config,
        publishedDependencies,
        scope,
        version: getCurrentVersion(scope),
        workspace,
      }),
    );
  }

  report(
    problems,
    `every published @copilotkit dependent still admits ${scopes.join(", ")}.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
