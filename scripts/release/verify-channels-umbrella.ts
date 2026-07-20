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
  createConsumerManifest,
  createConsumerWorkspaceYaml,
  FAMILY,
  validatePackedManifests,
} from "./lib/channels-umbrella.js";
import type { PackedManifest } from "./lib/channels-umbrella.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface RootManifest {
  packageManager?: string;
  devDependencies?: Record<string, string>;
}

interface ListNode {
  version?: string;
  dependencies?: Record<string, ListNode>;
  devDependencies?: Record<string, ListNode>;
  optionalDependencies?: Record<string, ListNode>;
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

function packageDirectory(name: string): string {
  return join(ROOT, "packages", name.replace("@copilotkit/", ""));
}

function tarballName(manifest: PackedManifest): string {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

function packPackage(
  name: string,
  tarballDir: string,
): { manifest: PackedManifest; tarball: string } {
  const cwd = packageDirectory(name);
  const source = readJson<PackedManifest>(join(cwd, "package.json"));
  capture("pnpm", ["pack", "--pack-destination", tarballDir], cwd);

  const tarball = join(tarballDir, tarballName(source));
  const manifest = JSON.parse(
    capture("tar", ["-xOf", tarball, "package/package.json"]),
  ) as PackedManifest;

  return { manifest, tarball };
}

interface SourceManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * The Channels family depends on monorepo-versioned packages (e.g.
 * `@copilotkit/core`, `@copilotkit/shared`) via the `workspace:` protocol.
 * `pnpm pack` rewrites those ranges to the workspace's current version — which,
 * on a release PR, is the freshly-bumped version that is not on the registry
 * until this very release publishes. Packing them locally too keeps the
 * consumer install hermetic instead of racing the registry against our own
 * in-flight release. Discovered transitively via `workspace:` so the list never
 * drifts as the family's internal dependencies change.
 */
function workspaceSiblings(): string[] {
  const seen = new Set<string>(FAMILY);
  const siblings: string[] = [];
  const queue: string[] = [...FAMILY];

  while (queue.length) {
    const name = queue.shift() as string;
    const source = readJson<SourceManifest>(
      join(packageDirectory(name), "package.json"),
    );
    for (const deps of [source.dependencies, source.peerDependencies]) {
      for (const [dep, range] of Object.entries(deps ?? {})) {
        if (!dep.startsWith("@copilotkit/")) continue;
        if (!range.startsWith("workspace:")) continue;
        if (seen.has(dep)) continue;
        seen.add(dep);
        siblings.push(dep);
        queue.push(dep);
      }
    }
  }

  return siblings;
}

function packLocalFamily(tarballDir: string): {
  manifests: Map<string, PackedManifest>;
  tarballs: Map<string, string>;
} {
  const manifests = new Map<string, PackedManifest>();
  const tarballs = new Map<string, string>();

  for (const name of FAMILY) {
    const { manifest, tarball } = packPackage(name, tarballDir);
    manifests.set(name, manifest);
    tarballs.set(name, tarball);
  }

  // Pin monorepo siblings to local tarballs too (overrides only — they are not
  // part of the packed-manifest contract that `validatePackedManifests` checks).
  for (const name of workspaceSiblings()) {
    const { tarball } = packPackage(name, tarballDir);
    tarballs.set(name, tarball);
  }

  return { manifests, tarballs };
}

function loadRegistryManifest(name: string, version: string): PackedManifest {
  try {
    return JSON.parse(
      capture("npm", ["view", `${name}@${version}`, "--json"]),
    ) as PackedManifest;
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr)
        : "";
    if (stderr.includes("E404")) {
      throw new Error(
        `registry is missing ${name}@${version}; publish channels-core and every adapter before publishing @copilotkit/channels`,
        { cause: error },
      );
    }
    throw error;
  }
}

function loadRegistrySnapshot(tarballDir: string): {
  manifests: Map<string, PackedManifest>;
  tarballs: Map<string, string>;
} {
  const umbrellaName = "@copilotkit/channels";
  const { manifest: umbrella, tarball } = packPackage(umbrellaName, tarballDir);
  const manifests = new Map<string, PackedManifest>([[umbrellaName, umbrella]]);

  for (const name of FAMILY) {
    if (name === umbrellaName) continue;
    const version = umbrella.dependencies?.[name];
    if (!version) {
      throw new Error(`packed umbrella is missing ${name}`);
    }

    manifests.set(name, loadRegistryManifest(name, version));
  }

  return {
    manifests,
    tarballs: new Map([[umbrellaName, tarball]]),
  };
}

function collectVersions(
  node: ListNode,
  target: string,
  versions: Set<string>,
): void {
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const) {
    for (const [name, child] of Object.entries(node[field] ?? {})) {
      if (name === target && child.version) versions.add(child.version);
      collectVersions(child, target, versions);
    }
  }
}

function assertSingleResolution(consumerDir: string): void {
  const tree = JSON.parse(
    capture(
      "pnpm",
      [
        "list",
        "@copilotkit/channels-core",
        "@copilotkit/channels-ui",
        "--depth=100",
        "--json",
      ],
      consumerDir,
    ),
  ) as ListNode[];

  for (const name of ["@copilotkit/channels-core", "@copilotkit/channels-ui"]) {
    const versions = new Set<string>();
    for (const root of tree) collectVersions(root, name, versions);
    if (versions.size !== 1) {
      throw new Error(
        `${name} must resolve to one version; found ${
          versions.size ? [...versions].join(", ") : "none"
        }`,
      );
    }
  }
}

function writeConsumer(
  consumerDir: string,
  umbrellaTarball: string,
  overrides?: ReadonlyMap<string, string>,
): void {
  const root = readJson<RootManifest>(join(ROOT, "package.json"));
  const typescript = root.devDependencies?.typescript;
  const nodeTypes = root.devDependencies?.["@types/node"];
  const packageManager = root.packageManager;
  if (!typescript || !nodeTypes || !packageManager) {
    throw new Error(
      "missing root package-manager or TypeScript ranges for packed consumer",
    );
  }

  writeFileSync(
    join(consumerDir, "pnpm-workspace.yaml"),
    createConsumerWorkspaceYaml(),
  );
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      createConsumerManifest({
        umbrellaTarball,
        packageManager,
        typescript,
        nodeTypes,
        overrides,
      }),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          jsx: "react-jsx",
          jsxImportSource: "@copilotkit/channels",
        },
        include: ["smoke.tsx"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumerDir, "smoke.tsx"),
    `import { Button, createChannel, Message } from "@copilotkit/channels";
import { slack } from "@copilotkit/channels/slack";
import { teams } from "@copilotkit/channels/teams";
import { intelligenceAdapter } from "@copilotkit/channels/intelligence";
import { discord } from "@copilotkit/channels/discord";
import { telegram } from "@copilotkit/channels/telegram";
import { whatsapp } from "@copilotkit/channels/whatsapp";

const view = <Message><Button>OK</Button></Message>;
void [createChannel, slack, teams, intelligenceAdapter, discord, telegram, whatsapp, view];
`,
  );
}

function main(): void {
  const registryMode = process.argv.includes("--registry");
  const temp = mkdtempSync(join(tmpdir(), "channels-umbrella-"));
  const tarballDir = join(temp, "tarballs");
  const consumerDir = join(temp, "consumer");
  mkdirSync(tarballDir);
  mkdirSync(consumerDir);

  try {
    const { manifests, tarballs } = registryMode
      ? loadRegistrySnapshot(tarballDir)
      : packLocalFamily(tarballDir);
    const problems = validatePackedManifests(manifests);
    if (problems.length) {
      throw new Error(
        `packed Channels manifest violations:\n${problems
          .map((problem) => `  - ${problem}`)
          .join("\n")}`,
      );
    }

    const umbrellaTarball = tarballs.get("@copilotkit/channels");
    if (!umbrellaTarball) throw new Error("missing packed umbrella tarball");

    writeConsumer(
      consumerDir,
      umbrellaTarball,
      registryMode ? undefined : tarballs,
    );
    run("pnpm", ["install", "--ignore-scripts"], consumerDir);
    run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], consumerDir);
    assertSingleResolution(consumerDir);
    console.log(
      `OK: ${registryMode ? "registry-backed" : "local"} Channels snapshot is exact, compatible, singly resolved, and TSX-consumable.`,
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
