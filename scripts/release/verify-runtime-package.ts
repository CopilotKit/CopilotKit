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
import { createConsumerWorkspaceYaml } from "./lib/channels-umbrella.js";
import {
  CHANNELS_INTELLIGENCE,
  createRuntimeConsumerManifest,
  packPackage,
  packWorkspaceClosure,
  RUNTIME,
} from "./lib/pack-workspace.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface RootManifest {
  packageManager?: string;
}

function run(command: string, args: string[], cwd = ROOT): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  const { packageManager } = readJson<RootManifest>(join(ROOT, "package.json"));
  if (!packageManager) {
    throw new Error("root package.json is missing packageManager");
  }

  const temp = mkdtempSync(join(tmpdir(), "runtime-package-"));
  const tarballDir = join(temp, "tarballs");
  const consumerDir = join(temp, "consumer");
  mkdirSync(tarballDir);
  mkdirSync(consumerDir);

  try {
    const { manifest: packedManifest, tarball } = packPackage(
      RUNTIME,
      tarballDir,
    );
    if (!packedManifest.dependencies?.[CHANNELS_INTELLIGENCE]) {
      throw new Error(
        `packed runtime must install ${CHANNELS_INTELLIGENCE} as a dependency`,
      );
    }

    // Resolve every first-party `workspace:` dependency from a local tarball.
    // On a release PR the packed ranges name freshly-bumped versions that this
    // very release is about to publish, so the registry cannot serve them yet.
    const overrides = packWorkspaceClosure([RUNTIME], tarballDir);
    if (!overrides.has(CHANNELS_INTELLIGENCE)) {
      throw new Error(
        `${CHANNELS_INTELLIGENCE} must be a workspace dependency of the runtime so the packed consumer installs it locally instead of from the registry`,
      );
    }

    writeFileSync(
      join(consumerDir, "pnpm-workspace.yaml"),
      createConsumerWorkspaceYaml(),
    );
    writeFileSync(
      join(consumerDir, "package.json"),
      `${JSON.stringify(
        createRuntimeConsumerManifest({
          runtimeTarball: tarball,
          packageManager,
          overrides,
        }),
        null,
        2,
      )}\n`,
    );

    run("pnpm", ["install", "--ignore-scripts"], consumerDir);

    run(
      "pnpm",
      [
        "exec",
        "node",
        "--eval",
        `require("@copilotkit/runtime");
require("@copilotkit/runtime/v2");`,
      ],
      consumerDir,
    );
    run(
      "pnpm",
      [
        "exec",
        "node",
        "--experimental-import-meta-resolve",
        "--input-type=module",
        "--eval",
        `const runtimePackageUrl = import.meta.resolve("@copilotkit/runtime/package.json");
const channelsIntelligenceUrl = import.meta.resolve(
  "${CHANNELS_INTELLIGENCE}",
  runtimePackageUrl,
);
await import(channelsIntelligenceUrl);`,
      ],
      consumerDir,
    );

    console.log(
      `OK: packed runtime installs ${CHANNELS_INTELLIGENCE} and loads through ESM and CJS.`,
    );
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
