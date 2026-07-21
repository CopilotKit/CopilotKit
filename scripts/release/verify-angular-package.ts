import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAngularConsumerManifest,
  createAngularConsumerSources,
  findPackageResolutions,
  readAngularSupportContract,
  validateAngularPackageManifest,
} from "./lib/angular-package.js";
import type { DependencyNode } from "./lib/angular-package.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ANGULAR_PACKAGE = "@copilotkit/angular";

interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface RootManifest {
  packageManager?: string;
}

function capture(command: string, args: string[], cwd = ROOT): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
  });
}

function run(command: string, args: string[], cwd = ROOT): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function readPackageManifest(path: string): PackageManifest {
  const value = readJson(path);
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("version" in value) ||
    typeof value.version !== "string"
  ) {
    throw new Error(`${path} is missing a string name or version`);
  }
  return value as PackageManifest;
}

function packageDirectory(name: string): string {
  return join(ROOT, "packages", name.replace("@copilotkit/", ""));
}

function tarballName(manifest: PackageManifest): string {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

/** Packs one already-built workspace package and returns its artifact path. */
function packPackage(name: string, tarballDir: string): string {
  const cwd = packageDirectory(name);
  const source = readPackageManifest(join(cwd, "package.json"));
  capture("pnpm", ["pack", "--pack-destination", tarballDir], cwd);
  return join(tarballDir, tarballName(source));
}

/**
 * Finds every transitively referenced local CopilotKit package. Packing and
 * overriding these siblings prevents a release-version bump from making the
 * consumer gate depend on artifacts that have not reached npm yet.
 */
function workspaceSiblings(): string[] {
  const seen = new Set<string>([ANGULAR_PACKAGE]);
  const siblings: string[] = [];
  const queue = [ANGULAR_PACKAGE];

  while (queue.length) {
    const name = queue.shift();
    if (!name) break;
    const source = readPackageManifest(
      join(packageDirectory(name), "package.json"),
    );
    for (const dependencies of [source.dependencies, source.peerDependencies]) {
      for (const [dependency, range] of Object.entries(dependencies ?? {})) {
        if (!dependency.startsWith("@copilotkit/")) continue;
        if (!range.startsWith("workspace:")) continue;
        if (seen.has(dependency)) continue;
        seen.add(dependency);
        siblings.push(dependency);
        queue.push(dependency);
      }
    }
  }

  return siblings;
}

function extractPackedManifest(tarball: string): unknown {
  return JSON.parse(
    capture("tar", ["-xOf", tarball, "package/package.json"]),
  ) as unknown;
}

function writeConsumer(
  consumerDir: string,
  manifest: Record<string, unknown>,
): void {
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const [relativePath, contents] of createAngularConsumerSources()) {
    const output = join(consumerDir, relativePath);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, contents);
  }
}

function assertFrameworkIndependent(consumerDir: string): void {
  const trees = JSON.parse(
    capture(
      "pnpm",
      ["list", "react", "react-dom", "--depth=100", "--json"],
      consumerDir,
    ),
  ) as DependencyNode[];
  const resolutions = findPackageResolutions(
    trees,
    new Set(["react", "react-dom"]),
  );
  if (resolutions.length) {
    throw new Error(
      `packed Angular dependency graph contains React: ${resolutions.join(", ")}`,
    );
  }
}

function main(): void {
  const temp = mkdtempSync(join(tmpdir(), "copilotkit-angular-package-"));
  const tarballDir = join(temp, "tarballs");
  mkdirSync(tarballDir);

  try {
    const sourceManifest = readJson(
      join(packageDirectory(ANGULAR_PACKAGE), "package.json"),
    );
    const sourceProblems = validateAngularPackageManifest(sourceManifest);
    if (sourceProblems.length) {
      throw new Error(
        `Angular source manifest violations:\n${sourceProblems
          .map((problem) => `  - ${problem}`)
          .join("\n")}`,
      );
    }

    const rootManifest = readJson(join(ROOT, "package.json"));
    if (
      typeof rootManifest !== "object" ||
      rootManifest === null ||
      !("packageManager" in rootManifest) ||
      typeof rootManifest.packageManager !== "string"
    ) {
      throw new Error("root package.json is missing packageManager");
    }
    const packageManager = (rootManifest as RootManifest).packageManager;
    if (!packageManager) throw new Error("root packageManager cannot be empty");

    const angularTarball = packPackage(ANGULAR_PACKAGE, tarballDir);
    const packedManifest = extractPackedManifest(angularTarball);
    const packedProblems = validateAngularPackageManifest(packedManifest);
    if (packedProblems.length) {
      throw new Error(
        `Packed Angular manifest violations:\n${packedProblems
          .map((problem) => `  - ${problem}`)
          .join("\n")}`,
      );
    }

    const siblingTarballs = new Map<string, string>();
    for (const name of workspaceSiblings()) {
      siblingTarballs.set(name, packPackage(name, tarballDir));
    }

    const support = readAngularSupportContract(packedManifest);
    for (const entry of support.supportedMajors) {
      const consumerDir = join(temp, `angular-${entry.major}`);
      mkdirSync(consumerDir);
      writeConsumer(
        consumerDir,
        createAngularConsumerManifest({
          angularTarball,
          packageManager,
          siblingTarballs,
          support: entry,
          rxjs: support.rxjs,
        }),
      );
      run(
        "pnpm",
        [
          "install",
          "--ignore-scripts",
          "--strict-peer-dependencies",
          "--reporter=append-only",
        ],
        consumerDir,
      );
      assertFrameworkIndependent(consumerDir);
      run(
        "pnpm",
        ["exec", "ng", "build", "--configuration=production"],
        consumerDir,
      );
      run(
        "pnpm",
        [
          "exec",
          "tsx",
          join(ROOT, "showcase/scripts/run-packed-angular-smoke.ts"),
          consumerDir,
        ],
        join(ROOT, "showcase/scripts"),
      );
      console.log(
        `OK: packed ${ANGULAR_PACKAGE} installs, SSR-renders, hydrates, and runs in a zoneless browser with Angular ${entry.angular}.`,
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
