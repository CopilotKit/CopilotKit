import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maxSatisfying } from "semver";
import { packPackage } from "./pack-workspace.js";

export interface RegistryResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type RegistryRunner = (packageName: string) => RegistryResult;

function runNpmView(packageName: string): RegistryResult {
  const result = spawnSync("npm", ["view", packageName, "versions", "--json"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Read every published stable-release candidate without hiding registry failures. */
export function readPublishedVersions(
  packageName: string,
  run: RegistryRunner = runNpmView,
): string[] {
  const result = run(packageName);
  if (result.status !== 0) {
    if (
      result.stderr.includes("E404") ||
      result.stderr.includes("is not in this registry")
    ) {
      return [];
    }
    throw new Error(
      `npm registry check failed for ${packageName}: ${result.stderr.trim() || "unknown error"}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `npm registry check failed for ${packageName}: invalid JSON response`,
    );
  }
  const versions = typeof parsed === "string" ? [parsed] : parsed;
  if (
    !Array.isArray(versions) ||
    versions.some((item) => typeof item !== "string")
  ) {
    throw new Error(
      `npm registry check failed for ${packageName}: invalid versions response`,
    );
  }
  return versions;
}

interface DependencyCheck {
  readonly owner: string;
  readonly dependency: string;
  readonly requiredRange: string;
  readonly publishedVersions: readonly string[];
}

/** Require one compatible stable dependency before a cross-scope release begins. */
export function assertCompatiblePublishedDependency({
  owner,
  dependency,
  requiredRange,
  publishedVersions,
}: DependencyCheck): void {
  const stableVersions = publishedVersions.filter(
    (version) => !version.includes("-"),
  );
  if (publishedVersions.length === 0) {
    throw new Error(
      `${dependency} has not been published, but ${owner} requires ${requiredRange}. ` +
        `Stop this Channels release, release schema first, then rebase or recreate the Channels release PR.`,
    );
  }
  if (!maxSatisfying(stableVersions, requiredRange)) {
    throw new Error(
      `No published ${dependency} version satisfies ${requiredRange} required by ${owner}. ` +
        `Published versions: ${stableVersions.join(", ") || "none"}. ` +
        `Stop this Channels release, release schema first, then rebase or recreate the Channels release PR.`,
    );
  }
}

/** Check the dependency range consumers will actually receive after `pnpm pack`. */
export function preflightStableReleaseDependencies(
  scope: string,
  readVersions: (
    packageName: string,
  ) => readonly string[] = readPublishedVersions,
): void {
  if (scope !== "channels") return;
  const temp = mkdtempSync(join(tmpdir(), "channels-release-preflight-"));
  try {
    const owner = "@copilotkit/channels-core";
    const dependency = "@copilotkit/schema";
    const { manifest } = packPackage(owner, temp);
    const requiredRange = manifest.dependencies?.[dependency];
    if (!requiredRange) {
      throw new Error(
        `Packed ${owner} does not declare ${dependency}; refusing the Channels release.`,
      );
    }
    assertCompatiblePublishedDependency({
      owner,
      dependency,
      requiredRange,
      publishedVersions: readVersions(dependency),
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
