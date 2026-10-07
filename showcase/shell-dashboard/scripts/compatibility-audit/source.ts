import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { assertMappingCoverage } from "./mapping";
import { resolveMavenSource } from "./sources/maven";
import { resolveNpmSource } from "./sources/npm";
import { resolveNugetSource } from "./sources/nuget";
import { resolvePythonSource } from "./sources/python";
import type {
  LibraryMapping,
  SavedFileReader,
  VariantMapping,
  VersionFact,
} from "./types";

const MAX_GIT_OUTPUT = 16 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const MANIFEST = /^showcase\/integrations\/([^/]+)\/manifest\.yaml$/;

function git(repo: string, args: string[]): Buffer {
  try {
    return execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: repo,
      encoding: "buffer",
      maxBuffer: MAX_GIT_OUTPUT,
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`Pinned Git source command failed: ${args[0]}`);
  }
}

function text(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function safePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe mapped source path: ${path}`);
  }
}

/** Resolve the local remote-tracking main ref once before reading its tree. */
export function resolveOriginMain(repo: string): string {
  if (!isAbsolute(repo))
    throw new Error("Git repository path must be absolute");
  const sha = text(
    git(repo, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      "refs/remotes/origin/main^{commit}",
    ]),
    "Resolved origin/main commit",
  ).trim();
  if (!/^[a-fA-F0-9]{40}$/.test(sha))
    throw new Error("origin/main did not resolve to a full commit SHA");
  return sha;
}

/** Capture only mapped dependency files from a full committed source tree. */
export function captureSourceFiles(
  repo: string,
  fullSha: string,
  mapping: VariantMapping[],
): { path: string; body: string }[] {
  if (!isAbsolute(repo))
    throw new Error("Git repository path must be absolute");
  if (!/^[a-fA-F0-9]{40}$/.test(fullSha))
    throw new Error("Source SHA must be a full 40-digit Git commit SHA");

  const resolved = text(
    git(repo, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${fullSha}^{commit}`,
    ]),
    "Resolved commit SHA",
  ).trim();
  if (resolved.toLowerCase() !== fullSha.toLowerCase()) {
    throw new Error("Source SHA must identify a Git commit directly");
  }

  // ls-tree examines the pinned tree, not the checkout. Its mode also excludes
  // symlinks and submodules, which cannot supply ordinary source file bytes.
  const entries = text(
    git(repo, ["ls-tree", "-r", "-z", resolved, "--", "showcase/integrations"]),
    "Pinned Git tree",
  );
  const files = new Map<string, string>();
  for (const entry of entries.split("\0")) {
    if (!entry) continue;
    const match = /^(\d{6}) blob [a-f0-9]{40}\t([\s\S]+)$/.exec(entry);
    if (!match) continue;
    files.set(match[2], match[1]);
  }
  const manifests = [...files.keys()].filter((path) => MANIFEST.test(path));
  const manifestSlugs = manifests.map((path) => MANIFEST.exec(path)![1]);
  assertMappingCoverage(mapping, manifestSlugs);

  const paths = new Set<string>();
  for (const variant of mapping) {
    for (const library of variant.libraries) {
      paths.add(library.source.path);
      if (library.source.lockPath) paths.add(library.source.lockPath);
    }
  }
  return [...paths].sort().map((path) => {
    safePath(path);
    const mode = files.get(path);
    if (mode !== "100644" && mode !== "100755") {
      throw new Error(`Pinned source file is missing or not regular: ${path}`);
    }
    return {
      path,
      body: text(
        git(repo, ["show", `${resolved}:${path}`]),
        `Pinned source ${path}`,
      ),
    };
  });
}

/** Resolve a mapped library only from captured pinned source files. */
export function resolveSourceFact(
  library: LibraryMapping,
  read: SavedFileReader,
): VersionFact {
  switch (library.source.kind) {
    case "requirements":
      return resolvePythonSource(library, read);
    case "npm":
      return resolveNpmSource(library, read);
    case "csproj":
      return resolveNugetSource(library, read);
    case "pom":
      return resolveMavenSource(library, read);
  }
}
