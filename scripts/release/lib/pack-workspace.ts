import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type { PackedManifest } from "./channels-umbrella.js";
import type { PackedManifest } from "./channels-umbrella.js";

export interface SourceManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export function packageDirectory(name: string): string {
  return join(ROOT, "packages", name.replace("@copilotkit/", ""));
}

export function tarballName(manifest: PackedManifest): string {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

function capture(command: string, args: string[], cwd = ROOT): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
  });
}

function readSourceManifest(name: string): SourceManifest {
  return JSON.parse(
    readFileSync(join(packageDirectory(name), "package.json"), "utf8"),
  ) as SourceManifest;
}

export function packPackage(
  name: string,
  tarballDir: string,
): { manifest: PackedManifest; tarball: string } {
  const cwd = packageDirectory(name);
  const source = JSON.parse(
    readFileSync(join(cwd, "package.json"), "utf8"),
  ) as PackedManifest;
  capture("pnpm", ["pack", "--pack-destination", tarballDir], cwd);

  const tarball = join(tarballDir, tarballName(source));
  const manifest = JSON.parse(
    capture("tar", ["-xOf", tarball, "package/package.json"]),
  ) as PackedManifest;

  return { manifest, tarball };
}

/**
 * Every monorepo package reachable from `roots` through the `workspace:`
 * protocol, excluding the roots themselves.
 *
 * `pnpm pack` rewrites `workspace:` ranges to the workspace's current version —
 * which, on a release PR, is the freshly-bumped version that is not on the
 * registry until this very release publishes. Packing the whole closure locally
 * and pinning it through pnpm `overrides` keeps a packed-consumer install
 * hermetic instead of racing the registry against our own in-flight release.
 * Discovered transitively so the list never drifts as internal dependencies
 * change.
 */
export function workspaceDependencyClosure(
  roots: readonly string[],
  readManifest: (name: string) => SourceManifest = readSourceManifest,
): string[] {
  const seen = new Set<string>(roots);
  const closure: string[] = [];
  const queue: string[] = [...roots];

  while (queue.length) {
    const name = queue.shift() as string;
    const source = readManifest(name);
    for (const deps of [source.dependencies, source.peerDependencies]) {
      for (const [dep, range] of Object.entries(deps ?? {})) {
        if (!dep.startsWith("@copilotkit/")) continue;
        if (!range.startsWith("workspace:")) continue;
        if (seen.has(dep)) continue;
        seen.add(dep);
        closure.push(dep);
        queue.push(dep);
      }
    }
  }

  return closure;
}

/**
 * Packs `workspaceDependencyClosure(roots)` and returns a name → tarball map
 * suitable for pnpm `overrides`.
 */
export function packWorkspaceClosure(
  roots: readonly string[],
  tarballDir: string,
): Map<string, string> {
  const tarballs = new Map<string, string>();
  for (const name of workspaceDependencyClosure(roots)) {
    tarballs.set(name, packPackage(name, tarballDir).tarball);
  }
  return tarballs;
}

export function toFileOverrides(
  tarballs: ReadonlyMap<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    [...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]),
  );
}

export const RUNTIME = "@copilotkit/runtime";
export const CHANNELS_INTELLIGENCE = "@copilotkit/channels-intelligence";

interface RuntimeConsumerOptions {
  runtimeTarball: string;
  packageManager: string;
  overrides: ReadonlyMap<string, string>;
}

export function createRuntimeConsumerManifest({
  runtimeTarball,
  packageManager,
  overrides,
}: RuntimeConsumerOptions): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    name: "runtime-package-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    packageManager,
    dependencies: {
      [RUNTIME]: `file:${runtimeTarball}`,
    },
  };

  if (overrides.size) {
    manifest.pnpm = { overrides: toFileOverrides(overrides) };
  }

  return manifest;
}
