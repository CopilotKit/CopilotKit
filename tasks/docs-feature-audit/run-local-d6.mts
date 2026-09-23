import { loadConfig } from "../../showcase/harness/src/cli/config.js";
import { buildFullInputs } from "../../showcase/harness/src/cli/targets.js";
import { runDriverInputs } from "../../showcase/harness/src/cli/runner.js";
import { createE2eFullDriver } from "../../showcase/harness/src/probes/drivers/d6-all-pills.js";
import { D5_REGISTRY } from "../../showcase/harness/src/probes/helpers/d5-registry.js";
import { createLogger } from "../../showcase/harness/src/logger.js";
import { glob } from "glob";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const validateOnly = args.includes("--validate");
const demoIndex = args.indexOf("--demo");
const demo = demoIndex >= 0 ? args[demoIndex + 1] : undefined;
if (demoIndex >= 0 && !demo) {
  throw new Error("--demo requires a demo id");
}
// --demos <id,id,...>: run only this subset of the manifest's features, in one
// driver call (same concurrency as a full run). Used to split a full matrix
// across fresh stack boots when the stack's memory would exceed the audit cap.
const demosIndex = args.indexOf("--demos");
const demoSubset =
  demosIndex >= 0
    ? (args[demosIndex + 1] ?? "").split(",").filter(Boolean)
    : undefined;
if (demosIndex >= 0 && (!demoSubset || demoSubset.length === 0)) {
  throw new Error("--demos requires a comma-separated list of demo ids");
}
if (demo && demoSubset) {
  throw new Error("--demo and --demos are mutually exclusive");
}
const slugs = args.filter(
  (arg, index) =>
    arg !== "--validate" &&
    arg !== "--demo" &&
    arg !== "--demos" &&
    (demoIndex < 0 || index !== demoIndex + 1) &&
    (demosIndex < 0 || index !== demosIndex + 1),
);
if (slugs.length === 0) {
  throw new Error(
    "Usage: run-local-d6.mts <integration-slug> [...] [--demo <id> | --demos <id,id,...>]",
  );
}

const logger = createLogger({ component: "docs-feature-audit-local-d6" });
const abortController = new AbortController();
const ctx = {
  now: () => new Date(),
  logger,
  env: { ...process.env, SHOWCASE_LOCAL: "1" },
  abortSignal: abortController.signal,
};
const config = loadConfig();
const driver = createE2eFullDriver();

async function loadHarnessScripts(): Promise<void> {
  const scriptsDir = path.resolve(
    process.cwd(),
    "showcase/harness/src/probes/scripts",
  );
  const scriptFiles = await glob("d5-*.ts", {
    cwd: scriptsDir,
    ignore: ["*.test.ts", "_*"],
  });
  for (const file of scriptFiles) {
    await import(pathToFileURL(path.join(scriptsDir, file)).href);
  }
  if (D5_REGISTRY.size === 0) {
    throw new Error(
      `Audit wrapper loaded ${scriptFiles.length} script files but no D5/D6 registrations`,
    );
  }
}

async function main(): Promise<void> {
  await loadHarnessScripts();
  if (validateOnly) {
    console.log(JSON.stringify({ registeredFeatureTypes: D5_REGISTRY.size }));
    return;
  }
  let failed = false;
  for (const slug of slugs) {
    let inputs = buildFullInputs({ slug, ...(demo ? { demo } : {}) }, config);
    if (demoSubset) {
      const known = new Set(inputs.flatMap((input) => input.demos));
      const unknown = demoSubset.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new Error(`--demos: not in ${slug}'s features: ${unknown.join(", ")}`);
      }
      inputs = inputs.map((input) => ({
        ...input,
        demos: input.demos.filter((id) => demoSubset.includes(id)),
      }));
    }
    const results = await runDriverInputs(
      inputs,
      driver,
      ctx,
      null,
      logger,
    );
    const summary = { slug, results };
    console.log(JSON.stringify(summary));
    failed ||= results.some((result) => result.state !== "green");
  }

  if (failed) process.exitCode = 1;
}

void main();
