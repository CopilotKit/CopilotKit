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
  BUILT_IN_AGENT_ADAPTERS,
  BUILT_IN_AGENT_PEERS,
  CHANNELS_INTELLIGENCE,
  createRuntimeConsumerManifest,
  declaredRanges,
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
 * Script text that fails unless `load` (an expression that loads the packed
 * `/agent` entry) succeeds. `/agent` loads `@tanstack/ai` only when a classic
 * agent runs, so factory-only apps can load it without TanStack AI.
 */
function assertAgentLoads(load: string): string {
  return `await Promise.resolve().then(() => ${load});`;
}

/**
 * Script text that builds a classic `BuiltInAgent` on the OpenAI adapter, and
 * fails unless a model string is refused with the adapter hint and a run on
 * `fakeText()` streams text through TanStack AI `chat()`. Expects
 * `BuiltInAgent` and `openaiText` in scope.
 */
const CONSTRUCT_AGENT = `process.env.OPENAI_API_KEY = "verify-key";
const agent = new BuiltInAgent({ model: openaiText("gpt-5") });
if (!(agent instanceof BuiltInAgent)) throw new Error("new BuiltInAgent({ model: openaiText(...) }) must build an agent");
let refused;
try {
  new BuiltInAgent({ model: "openai/gpt-5" });
} catch (error) {
  refused = error;
}
if (!String(refused?.message).includes("Pass a TanStack AI text adapter")) {
  throw new Error("BuiltInAgent must refuse a model string with the adapter hint, got: " + refused);
}
const { fakeText } = await import("@tanstack/ai/testing");
const fake = fakeText();
fake.setResponses([{ text: "verify ok" }]);
const events = [];
await new Promise((resolve, reject) => {
  new BuiltInAgent({ model: fake })
    .run({ threadId: "t", runId: "r", messages: [{ id: "m", role: "user", content: "hi" }], tools: [], context: [], state: {}, forwardedProps: {} })
    .subscribe({ next: (event) => events.push(event.type), error: reject, complete: resolve });
});
if (!events.includes("TEXT_MESSAGE_CHUNK") || !events.includes("RUN_FINISHED")) {
  throw new Error("A classic BuiltInAgent run must stream text and finish, got: " + events.join(", "));
}`;

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
  llmPackages?: Readonly<Record<string, string>>;
}

/** Writes a consumer of the packed runtime under `temp/name` and installs it. */
function installConsumer({ name, temp, ...manifest }: ConsumerOptions) {
  const consumerDir = join(temp, name);
  mkdirSync(consumerDir);
  // `pnpm run` passes the repo's `minimum-release-age` to this install, and the
  // TanStack AI release the runtime needs (with its internal packages, such as
  // `@tanstack/openai-base`) can be under a day old. Exempt the scope in this
  // throwaway consumer only; the repo policy stays as it is.
  const installsPeers = Object.keys(manifest.llmPackages ?? {}).length > 0;
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
    // Every optional peer of the runtime (`@tanstack/ai` and `ai`), and the
    // adapter the Built-in Agent consumer installs.
    const llmPackages = [
      ...Object.keys(packedManifest.peerDependencies ?? {}),
      ...BUILT_IN_AGENT_ADAPTERS,
    ];

    // A consumer with no LLM package installed: the root entry and `/agent`
    // must load, and `/agent/ai-sdk` must resolve.
    const bareDir = installConsumer({ ...consumer, name: "bare" });
    runCjs(
      `(async () => {
const { VERSION } = require("@copilotkit/runtime");
${assertVersion(runtimeVersion)}
require.resolve("@copilotkit/runtime/agent/ai-sdk");
${assertAgentLoads('require("@copilotkit/runtime/agent")')}
})().catch((error) => { console.error(error); process.exit(1); });`,
      bareDir,
    );
    runEsm(
      `import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
${assertNotInstalled(llmPackages)}
const channelsIntelligenceUrl = import.meta.resolve(
  "${CHANNELS_INTELLIGENCE}",
  import.meta.resolve("@copilotkit/runtime/package.json"),
);
await import(channelsIntelligenceUrl);
const { VERSION } = await import("@copilotkit/runtime");
${assertVersion(runtimeVersion)}
const aiSdkEntry = fileURLToPath(import.meta.resolve("@copilotkit/runtime/agent/ai-sdk"));
if (!existsSync(aiSdkEntry)) throw new Error("@copilotkit/runtime/agent/ai-sdk resolves to a missing file: " + aiSdkEntry);
${assertAgentLoads('import("@copilotkit/runtime/agent")')}`,
      bareDir,
    );

    // A consumer that installs `@tanstack/ai` and the OpenAI adapter: the
    // packed `/agent` must load and build an agent on an adapter instance.
    const agentDir = installConsumer({
      ...consumer,
      name: "built-in-agent",
      llmPackages: {
        ...declaredRanges(
          packedManifest,
          "peerDependencies",
          BUILT_IN_AGENT_PEERS,
        ),
        ...declaredRanges(
          packedManifest,
          "devDependencies",
          BUILT_IN_AGENT_ADAPTERS,
        ),
      },
    });
    runEsm(
      `const { BuiltInAgent } = await import("@copilotkit/runtime/agent");
const { openaiText } = await import("@tanstack/ai-openai");
${CONSTRUCT_AGENT}`,
      agentDir,
    );
    runCjs(
      `(async () => {
const { BuiltInAgent } = require("@copilotkit/runtime/agent");
const { openaiText } = await import("@tanstack/ai-openai");
${CONSTRUCT_AGENT}
})().catch((error) => { console.error(error); process.exit(1); });`,
      agentDir,
    );

    console.log(
      `OK: packed runtime ${runtimeVersion} installs ${CHANNELS_INTELLIGENCE}; the root entry loads through ESM and CJS with no LLM package installed; /agent/ai-sdk resolves; /agent loads; with ${[...BUILT_IN_AGENT_PEERS, ...BUILT_IN_AGENT_ADAPTERS].join(" and ")} it builds a BuiltInAgent on openaiText("gpt-5") and runs one on fakeText() through ESM and CJS.`,
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
