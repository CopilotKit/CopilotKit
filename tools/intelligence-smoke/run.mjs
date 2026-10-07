import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { standaloneConsumerEnv } from "../learned-skill-conformance/workspace-artifacts.mjs";
import { commandRunner } from "./process.mjs";
import { startModel, scenario } from "./model.mjs";
import { createStack } from "./stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { values } = parseArgs({
  options: {
    output: { type: "string" },
    k3d: { type: "string", default: "k3d" },
    helm: { type: "string", default: "helm" },
    "expect-reply": { type: "string" },
    "intelligence-source": { type: "string" },
  },
});
const output = resolve(values.output ?? `smoke-results-${randomUUID()}`);
await mkdir(output, { recursive: false, mode: 0o700 });
const directory = await mkdtemp(join(tmpdir(), "pe-431-"));
const secrets = [];
const run = commandRunner(output, secrets, { handleSignals: true });
const evidence = {
  status: "failed",
  startedAt: new Date().toISOString(),
  checks: { thread: "not_run", learning: "not_run", models: "not_run" },
};
let stack;
let model;
let failure;
try {
  const pins = JSON.parse(await readFile(join(here, "pins.json"), "utf8"));
  evidence.pins = pins;
  evidence.sdkSource = (
    await run("git", ["rev-parse", "HEAD"], { step: "sdk-source", cwd: root })
  ).trim();
  await run("pnpm", ["nx", "run", "@copilotkit/runtime:build"], {
    step: "sdk-build",
    cwd: root,
  });
  const consumer = join(directory, "consumer");
  await mkdir(consumer);
  // Packing uses synchronous subprocesses internally. Isolate it so the parent
  // can handle cancellation and terminate the entire packing process group.
  const artifacts = JSON.parse(
    await run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { packRuntimeWorkspace } from ${JSON.stringify(new URL("../learned-skill-conformance/workspace-artifacts.mjs", import.meta.url).href)};
     console.log(JSON.stringify(packRuntimeWorkspace(process.argv[1], process.argv[2], process.env)));`,
        root,
        join(directory, "packages"),
      ],
      { step: "sdk-pack", env: standaloneConsumerEnv() },
    ),
  );
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "intelligence-smoke-consumer",
        private: true,
        type: "module",
        dependencies: {
          ...artifacts.dependencies,
          "@copilotkit/aimock": "1.19.1",
          yaml: "2.8.3",
        },
        overrides: artifacts.overrides,
      },
      null,
      2,
    ),
  );
  await run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
    ],
    { step: "consumer-install", cwd: consumer, env: standaloneConsumerEnv() },
  );
  const require = createRequire(join(consumer, "package.json"));
  const runtimeEntry = join(
    consumer,
    "node_modules/@copilotkit/runtime/dist/v2/index.mjs",
  );
  const hash = async (file) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  assert.equal(
    await hash(runtimeEntry),
    await hash(join(root, "packages/runtime/dist/v2/index.mjs")),
    "Loaded runtime differs from candidate build",
  );
  evidence.sdkPackages = await Promise.all(
    Object.entries(artifacts.dependencies).map(async ([name, archive]) => ({
      name,
      archiveSha256: await hash(archive.slice(5)),
      version: JSON.parse(
        await readFile(
          join(consumer, "node_modules", name, "package.json"),
          "utf8",
        ),
      ).version,
    })),
  );
  evidence.runtimeSha256 = await hash(runtimeEntry);
  model = await startModel({
    aimock: require("@copilotkit/aimock"),
    host: "0.0.0.0",
  });
  stack = createStack({
    directory,
    output,
    pins,
    modelPort: model.port,
    k3d: values.k3d,
    helm: values.helm,
    yaml: require("yaml"),
    run,
    secrets,
    intelligenceSource: values["intelligence-source"],
  });
  await stack.start();
  const credentials = stack.credentials;
  secrets.push(
    credentials.serviceToken,
    credentials.apiKey,
    credentials.licenseToken,
  );
  const input = join(directory, "exercise.json");
  const result = join(output, "proof.json");
  await writeFile(
    input,
    JSON.stringify({
      consumer,
      apiUrl: stack.apiUrl,
      gatewayUrl: stack.gatewayUrl,
      ...credentials,
      modelUrl: `http://127.0.0.1:${model.port}`,
      result,
      expectedReply: values["expect-reply"] ?? scenario.reply,
    }),
    { mode: 0o600 },
  );
  evidence.checks.thread = "failed";
  await run(process.execPath, [join(here, "exercise.mjs"), input], {
    step: "proof",
    timeoutMs: 1_020_000,
    env: {
      ...standaloneConsumerEnv(),
      COPILOTKIT_TELEMETRY_DISABLED: "true",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GOOGLE_API_KEY: "",
    },
  });
  evidence.proof = JSON.parse(await readFile(result, "utf8"));
  evidence.checks.thread = "passed";
  evidence.checks.learning = "passed";
  evidence.models = model.evidence();
  assert.equal(
    evidence.models.snapshotId,
    evidence.proof.learning.snapshotId,
    "Saved Insight cites a different snapshot from the model transcript",
  );
  evidence.checks.models = "passed";
} catch (error) {
  failure = error;
} finally {
  run.beginCleanup();
  evidence.cleanup = {
    model: "not_run",
    stack: "not_run",
    temporary: "failed",
  };
  try {
    const proof = JSON.parse(
      await readFile(join(output, "proof.json"), "utf8"),
    );
    evidence.proof = proof;
    if (proof.thread) {
      evidence.checks.thread = "passed";
      evidence.checks.learning = "failed";
    }
    if (proof.learning) evidence.checks.learning = "passed";
  } catch (error) {
    if (error.code !== "ENOENT") failure ??= error;
  }
  if (model) {
    try {
      await writeFile(
        join(output, "model-requests.json"),
        JSON.stringify(model.requests(), null, 2),
      );
    } catch (error) {
      failure ??= error;
    }
    evidence.cleanup.model = "failed";
    try {
      await model.stop();
      evidence.cleanup.model = "passed";
    } catch (error) {
      failure ??= error;
    }
  }
  if (stack) {
    try {
      evidence.stack = await stack.collectEvidence();
    } catch (error) {
      failure ??= error;
    }
    evidence.cleanup.stack = "failed";
    try {
      await stack.stop();
      evidence.cleanup.stack = "passed";
    } catch (error) {
      failure ??= error;
    }
  }
  try {
    await rm(directory, { recursive: true, force: true });
    evidence.cleanup.temporary = "passed";
  } catch (error) {
    failure ??= error;
  }
  failure ??= run.interruption;
  if (run.interruption) evidence.signal = run.interruption.signal;
  evidence.finishedAt = new Date().toISOString();
  evidence.status = failure ? "failed" : "passed";
  if (failure)
    evidence.error = secrets
      .filter(Boolean)
      .reduce(
        (text, secret) => text.replaceAll(secret, "[redacted]"),
        String(failure),
      );
  // Keep the signal snapshot and final evidence write in one event-loop turn.
  writeFileSync(join(output, "result.json"), JSON.stringify(evidence, null, 2));
}
console.log(`${evidence.status}: ${join(output, "result.json")}`);
if (failure) {
  console.error(evidence.error);
  process.exitCode = run.interruption?.exitCode ?? 1;
}

run.dispose();
