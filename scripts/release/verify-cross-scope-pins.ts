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
  crossScopeEdges,
  findExactCrossScopePins,
  findSupersededPublishedPins,
} from "./lib/cross-scope-pins.js";
import type { ScopedManifest } from "./lib/cross-scope-pins.js";
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

/**
 * Reads the dependency map a package carries on the registry.
 *
 * An unpublished package answers `undefined` rather than throwing: a scope
 * whose package has never shipped cannot be left behind by this release. Any
 * other registry failure throws, because a release must not be waved through by
 * a check that could not run.
 */
function readPublishedDependencies(
  packageName: string,
): Record<string, string> | undefined {
  const result = spawnSync(
    "npm",
    ["view", `${packageName}@latest`, "dependencies", "--json"],
    { encoding: "utf8", timeout: 30_000 },
  );

  if (result.status === 0) {
    const output = result.stdout.trim();
    if (output === "") return {};
    return JSON.parse(output) as Record<string, string>;
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
  const problems: string[] = [];

  for (const scope of scopes) {
    const version = getCurrentVersion(scope);
    const dependents = new Set(
      crossScopeEdges(workspace, config)
        .filter(
          (edge) =>
            edge.dependencyScope === scope && !releasing.has(edge.packageScope),
        )
        .map((edge) => edge.package),
    );

    const publishedDependencies: Record<string, Record<string, string>> = {};
    for (const name of dependents) {
      const published = readPublishedDependencies(name);
      if (published !== undefined) publishedDependencies[name] = published;
    }

    problems.push(
      ...findSupersededPublishedPins({
        config,
        publishedDependencies,
        scope,
        version,
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
