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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME_DIR = join(ROOT, "packages", "runtime");
const CHANNELS_INTELLIGENCE = "@copilotkit/channels-intelligence";

interface PackageManifest {
  name: string;
  version: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
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

function tarballName(manifest: PackageManifest): string {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

function main(): void {
  const rootManifest = readJson<PackageManifest>(join(ROOT, "package.json"));
  const runtimeManifest = readJson<PackageManifest>(
    join(RUNTIME_DIR, "package.json"),
  );
  if (!rootManifest.packageManager) {
    throw new Error("root package.json is missing packageManager");
  }

  const temp = mkdtempSync(join(tmpdir(), "runtime-package-"));
  const tarballDir = join(temp, "tarballs");
  const consumerDir = join(temp, "consumer");
  mkdirSync(tarballDir);
  mkdirSync(consumerDir);

  try {
    capture("pnpm", ["pack", "--pack-destination", tarballDir], RUNTIME_DIR);
    const tarball = join(tarballDir, tarballName(runtimeManifest));
    const packedManifest = JSON.parse(
      capture("tar", ["-xOf", tarball, "package/package.json"]),
    ) as PackageManifest;
    if (!packedManifest.dependencies?.[CHANNELS_INTELLIGENCE]) {
      throw new Error(
        `packed runtime must install ${CHANNELS_INTELLIGENCE} as a dependency`,
      );
    }

    writeFileSync(
      join(consumerDir, "pnpm-workspace.yaml"),
      createConsumerWorkspaceYaml(),
    );
    writeFileSync(
      join(consumerDir, "package.json"),
      `${JSON.stringify(
        {
          name: "runtime-package-consumer",
          version: "0.0.0",
          private: true,
          type: "module",
          packageManager: rootManifest.packageManager,
          dependencies: {
            "@copilotkit/runtime": `file:${tarball}`,
          },
        },
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
