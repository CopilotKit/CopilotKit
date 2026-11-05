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
  BUILT_IN_AGENT_PEERS,
  CHANNELS_INTELLIGENCE,
  createRuntimeConsumerManifest,
  declaredPeerRanges,
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

/**
 * Script text that fails unless the loaded runtime reports `expected`.
 *
 * The runtime's version is injected at build time rather than imported from
 * package.json (see packages/runtime/src/runtime/core/package-info.ts).
 * Source that runs without the injection reports a placeholder, so this is
 * what proves the published build carries the real version, in each format.
 */
function assertVersion(expected: string): string {
  return `if (VERSION !== ${JSON.stringify(expected)}) {
  throw new Error("packed runtime reports VERSION " + JSON.stringify(VERSION) + ", expected ${expected}");
}`;
}

/** The model string both consumers resolve through the packed `/agent` entry. */
const MODEL = "openai/gpt-5";

/** Runs `script` as CommonJS in `cwd`. */
function runCjs(script: string, cwd: string): void {
  run("pnpm", ["exec", "node", "--eval", script], cwd);
}

/** Runs `script` as an ES module in `cwd`, with two-argument `import.meta.resolve`. */
function runEsm(script: string, cwd: string): void {
  run(
    "pnpm",
    [
      "exec",
      "node",
      "--experimental-import-meta-resolve",
      "--input-type=module",
      "--eval",
      script,
    ],
    cwd,
  );
}

/**
 * Script text (ES module) that fails unless no package in `names` resolves
 * from the installed runtime's own location, where pnpm links its peers.
 * Uses the `import` condition because the TanStack AI packages are ESM-only.
 */
function assertNotInstalled(names: readonly string[]): string {
  return `const runtimeEntry = import.meta.resolve("@copilotkit/runtime");
for (const name of ${JSON.stringify(names)}) {
  let found = false;
  try {
    import.meta.resolve(name, runtimeEntry);
    found = true;
  } catch {}
  if (found) throw new Error(name + " is installed, but this consumer must load the runtime without it");
}`;
}

interface ConsumerOptions {
  name: string;
  temp: string;
  runtimeTarball: string;
  packageManager: string;
  overrides: ReadonlyMap<string, string>;
  peers?: Readonly<Record<string, string>>;
}

/** Writes a consumer of the packed runtime under `temp/name` and installs it. */
function installConsumer({ name, temp, ...manifest }: ConsumerOptions) {
  const consumerDir = join(temp, name);
  mkdirSync(consumerDir);
  // `pnpm run` passes the repo's `minimum-release-age` to this install, and the
  // TanStack AI release the runtime needs (with its internal packages, such as
  // `@tanstack/openai-base`) can be under a day old. Exempt the scope in this
  // throwaway consumer only; the repo policy stays as it is.
  const installsPeers = Object.keys(manifest.peers ?? {}).length > 0;
  writeFileSync(
    join(consumerDir, "pnpm-workspace.yaml"),
    // Appends to the `minimumReleaseAgeExclude` list that ends the file.
    createConsumerWorkspaceYaml() +
      (installsPeers ? `  - "@tanstack/*"\n` : ""),
  );
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify(createRuntimeConsumerManifest(manifest), null, 2)}\n`,
  );
  run("pnpm", ["install", "--ignore-scripts"], consumerDir);
  return consumerDir;
}

function main(): void {
  const { packageManager } = readJson<RootManifest>(join(ROOT, "package.json"));
  if (!packageManager) {
    throw new Error("root package.json is missing packageManager");
  }

  const temp = mkdtempSync(join(tmpdir(), "runtime-package-"));
  const tarballDir = join(temp, "tarballs");
  mkdirSync(tarballDir);

  try {
    const { manifest: packedManifest, tarball } = packPackage(
      RUNTIME,
      tarballDir,
    );
    const { version: runtimeVersion } = readJson<{ version: string }>(
      join(ROOT, "packages/runtime/package.json"),
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

    const consumer = {
      temp,
      runtimeTarball: tarball,
      packageManager,
      overrides,
    };
    // Every optional peer of the runtime: TanStack AI, its adapters, and `ai`.
    const llmPeers = Object.keys(packedManifest.peerDependencies ?? {});

    // A consumer with no LLM package installed: the root entry and `/agent`
    // must still load, and a model string must fail with the install hint.
    const bareDir = installConsumer({ ...consumer, name: "bare" });
    runCjs(
      `const { VERSION } = require("@copilotkit/runtime");
${assertVersion(runtimeVersion)}
const agent = require("@copilotkit/runtime/agent");
if (typeof agent.BuiltInAgent !== "function") throw new Error("@copilotkit/runtime/agent (CJS) must export BuiltInAgent");
require.resolve("@copilotkit/runtime/agent/ai-sdk");
agent.resolveModel(${JSON.stringify(MODEL)}, "verify-key").then(
  () => { throw new Error("resolveModel must fail without @tanstack/ai-openai"); },
  (error) => {
    if (!String(error.message).includes("Install @tanstack/ai-openai")) throw error;
  },
).catch((error) => { console.error(error); process.exit(1); });`,
      bareDir,
    );
    runEsm(
      `import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
${assertNotInstalled(llmPeers)}
const channelsIntelligenceUrl = import.meta.resolve(
  "${CHANNELS_INTELLIGENCE}",
  import.meta.resolve("@copilotkit/runtime/package.json"),
);
await import(channelsIntelligenceUrl);
const { VERSION } = await import("@copilotkit/runtime");
${assertVersion(runtimeVersion)}
const { BuiltInAgent, resolveModel } = await import("@copilotkit/runtime/agent");
if (typeof BuiltInAgent !== "function") throw new Error("@copilotkit/runtime/agent (ESM) must export BuiltInAgent");
const aiSdkEntry = fileURLToPath(import.meta.resolve("@copilotkit/runtime/agent/ai-sdk"));
if (!existsSync(aiSdkEntry)) throw new Error("@copilotkit/runtime/agent/ai-sdk resolves to a missing file: " + aiSdkEntry);
const missing = await resolveModel(${JSON.stringify(MODEL)}, "verify-key").then(() => undefined, (error) => error);
if (!String(missing?.message).includes("Install @tanstack/ai-openai")) {
  throw new Error("resolveModel must fail with the @tanstack/ai-openai install hint, got: " + missing);
}`,
      bareDir,
    );

    // A consumer that installs the Built-in Agent peers: the packed `/agent`
    // must load the OpenAI adapter from the consumer's install at run time.
    const agentDir = installConsumer({
      ...consumer,
      name: "built-in-agent",
      peers: declaredPeerRanges(packedManifest, BUILT_IN_AGENT_PEERS),
    });
    const assertAdapter = `if (adapter?.kind !== "text" || adapter?.name !== "openai") {
  throw new Error("resolveModel(${MODEL}) must return the OpenAI text adapter, got " + JSON.stringify(adapter?.name));
}`;
    runCjs(
      `require("@copilotkit/runtime/agent").resolveModel(${JSON.stringify(MODEL)}, "verify-key").then((adapter) => {
${assertAdapter}
}).catch((error) => { console.error(error); process.exit(1); });`,
      agentDir,
    );
    runEsm(
      `const { resolveModel } = await import("@copilotkit/runtime/agent");
const adapter = await resolveModel(${JSON.stringify(MODEL)}, "verify-key");
${assertAdapter}`,
      agentDir,
    );

    console.log(
      `OK: packed runtime ${runtimeVersion} installs ${CHANNELS_INTELLIGENCE}; the root and /agent entries load through ESM and CJS with no LLM package installed; /agent/ai-sdk resolves; /agent loads ${BUILT_IN_AGENT_PEERS.join(" and ")} from the consumer at run time.`,
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
