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
import {
  packAngularArtifacts,
  readAngularArtifactSet,
} from "./lib/angular-artifacts.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ANGULAR_PACKAGE = "@copilotkit/angular";

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

  try {
    const sourceManifest = readJson(
      join(ROOT, "packages/angular/package.json"),
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

    const artifactArgument = process.argv.indexOf("--artifacts");
    const artifactDirectory =
      artifactArgument === -1 ? undefined : process.argv[artifactArgument + 1];
    if (artifactArgument !== -1 && !artifactDirectory) {
      throw new Error("--artifacts requires an artifact directory");
    }
    const artifactSet = artifactDirectory
      ? readAngularArtifactSet(artifactDirectory)
      : packAngularArtifacts(ROOT, join(temp, "tarballs"));
    const angularTarball = artifactSet.entryTarball;
    const packedManifest = extractPackedManifest(angularTarball);
    const packedProblems = validateAngularPackageManifest(packedManifest);
    if (packedProblems.length) {
      throw new Error(
        `Packed Angular manifest violations:\n${packedProblems
          .map((problem) => `  - ${problem}`)
          .join("\n")}`,
      );
    }

    const siblingTarballs = new Map(artifactSet.tarballs);
    siblingTarballs.delete(ANGULAR_PACKAGE);

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
          testedRxjs: support.testedRxjs,
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
