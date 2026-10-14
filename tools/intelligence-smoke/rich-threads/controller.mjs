import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptanceVerdict } from "./acceptance-verdict.mjs";
import { materialize } from "./materialize.mjs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    output: { type: "string" },
    mode: { type: "string", default: "acceptance" },
  },
});
assert.ok(
  values.config && values.output,
  "--config and --output required on the durable controller",
);
assert.ok(["single", "acceptance"].includes(values.mode), "Unknown run mode");
const attempts =
  values.mode === "single"
    ? ["clean-1"]
    : ["clean-1", "clean-2", "failed-run-cleanup"];
const root = resolve(values.output);
await mkdir(root, { mode: 0o700 });
const here = fileURLToPath(new URL(".", import.meta.url));
const template = JSON.parse(await readFile(resolve(values.config), "utf8"));
const results = [];
let child;
let cancelled = false;
const interrupt = () => {
  cancelled = true;
  child?.kill("SIGTERM");
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  for (const name of attempts) {
    assert.ok(!cancelled, "Acceptance sequence interrupted");
    const output = join(root, name);
    const privateDirectory = await mkdtemp(
      join(dirname(resolve(values.config)), "rich-attempt-"),
    );
    const privateConfig = join(privateDirectory, "config.json");
    await writeFile(privateConfig, JSON.stringify(materialize(template)), {
      mode: 0o600,
      flag: "wx",
    });
    const intentional = name === "failed-run-cleanup";
    // Supervisor capability validation requires this direct Node worker child.
    const args = [
      "--import",
      "tsx",
      join(here, "lifecycle/railway/supervisor.mjs"),
      "run",
      privateConfig,
      ...(intentional ? ["--expected-worker-exit=1"] : []),
      "--",
      process.execPath,
      "--import",
      "tsx",
      join(here, "run.mjs"),
      "--framework=mastra,strands-typescript",
      "--rows=1",
      `--config=${privateConfig}`,
      `--output=${output}`,
      ...(intentional ? ["--failure-control"] : []),
    ];
    const code = await new Promise((accept, reject) => {
      child = spawn(process.execPath, args, { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (exitCode) => accept(exitCode));
    });
    child = undefined;
    const report = JSON.parse(
      await readFile(join(output, "suite.json"), "utf8"),
    );
    const passed = acceptanceVerdict({
      report,
      supervisorExit: code,
      intentional,
      cancelled,
    });
    if (report.cleanup === "passed")
      await rm(privateDirectory, { recursive: true });
    results.push({
      name,
      passed,
      supervisorExit: code,
      suite: `${name}/suite.json`,
    });
    assert.ok(
      passed,
      `${name} did not satisfy hosted acceptance and verified cleanup`,
    );
  }
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await writeFile(
    join(root, "acceptance.json"),
    JSON.stringify(
      {
        milestone: "row1-text-query-data-v1",
        mode: values.mode,
        passed:
          results.length === attempts.length && results.every((r) => r.passed),
        results,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
}
