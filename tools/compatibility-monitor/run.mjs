import assert from "node:assert/strict";
import {
  mkdirSync,
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  appendFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  validateRequest,
  verifyResolved,
  cleanEnvironment,
} from "./request.mjs";

export async function executeRequest(input, { output, source, driver } = {}) {
  const request = validateRequest(input);
  output = resolve(output);
  source = resolve(source);
  mkdirSync(output, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = {
    ...request,
    status: "blocked",
    resolvedDependencies: {},
    cases: [],
    startedAt,
  };
  delete result.dependencies;
  // Every driver writes this marker before attempting an experimental override.
  // Clear old evidence so a reused output directory cannot taint this run.
  const forcedMarker = join(output, "declared-install-rejected.txt");
  rmSync(forcedMarker, { force: true });
  writeFileSync(join(output, "request.json"), JSON.stringify(request, null, 2));
  try {
    const evidence = await (driver ?? defaultDriver)(request, {
      output,
      source,
    });
    Object.assign(result, evidence);
    verifyResolved(request, result.resolvedDependencies);
    assert.ok(result.cases.length, "No contracts executed");
    assert.ok(
      result.cases.every(
        (c) =>
          c.contractId && ["passed", "failed", "blocked"].includes(c.status),
      ),
      "Invalid contract evidence",
    );
    result.status = result.cases.some((c) => c.status === "blocked")
      ? "blocked"
      : result.cases.some((c) => c.status === "failed")
        ? "failed"
        : "passed";
  } catch (error) {
    result.status = "blocked";
    result.failureStage = error.stage ?? "harness";
    result.cases.push({
      contractId: "harness",
      status: "blocked",
      message: error.message,
    });
  }
  // Read even after a driver throws: a failed forced retry is evidence too.
  result.forcedResolution = existsSync(forcedMarker);
  result.harnessSha = process.env.GITHUB_WORKFLOW_SHA;
  result.completedAt = new Date().toISOString();
  result.reproduction = `node tools/compatibility-monitor/run.mjs request.json /absolute/path/to/checkout output`;
  writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
  return result;
}
export async function defaultDriver(request, { output, source }) {
  const home = mkdtempSync(join(tmpdir(), "compatibility-home-"));
  const env = { ...cleanEnvironment(), HOME: home };
  const command = (file, args, cwd = source, extra = {}) => {
    appendFileSync(join(output, "commands.log"), `${file} ${args.join(" ")}\n`);
    try {
      const stdout = execFileSync(file, args, {
        cwd,
        env: { ...env, ...extra },
        encoding: "utf8",
        timeout: 20 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
      });
      appendFileSync(join(output, "execution.log"), stdout);
      return stdout;
    } catch (error) {
      appendFileSync(
        join(output, "execution.log"),
        String(error.stdout ?? "") +
          String(error.stderr ?? "") +
          "\n" +
          error.message,
      );
      throw error;
    }
  };
  assert.equal(
    command("git", ["rev-parse", "HEAD"]).trim(),
    request.sourceSha,
    "Checkout SHA differs from request",
  );
  const { runAdapter } = await import("./drivers.mjs");
  return runAdapter(request, { output, source, command, env });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [requestFile, source, output] = process.argv.slice(2);
  const result = await executeRequest(
    JSON.parse(readFileSync(requestFile, "utf8")),
    {
      source,
      output,
    },
  );
  process.exitCode = result.status === "passed" ? 0 : 1;
}
