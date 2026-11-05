import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { commandRunner } from "../../process.mjs";

/** Use the real built CLI, with credentials confined to environment and redacted logs. */
export function createImporter({
  executable = process.execPath,
  cli,
  source,
  apiUrl,
  agentMap,
  env,
  outputDir,
  secrets = [],
}) {
  const run = commandRunner(outputDir, secrets);
  return async function importSource(descriptor) {
    const args = [
      cli,
      "import",
      "--source",
      source,
      "--api-url",
      apiUrl,
      "--agent-map",
      agentMap,
      "--yes",
    ];
    const step = `import-${descriptor.id}`;
    const buildIdentity = createHash("sha256")
      .update(await readFile(cli))
      .digest("hex");
    await run(executable, args, { step, env, timeoutMs: 120_000 });
    return {
      exitCode: 0,
      dryRun: false,
      buildIdentity,
      command: [executable, ...args],
      log: `${step}.log`,
    };
  };
}
