import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { resolveVerifyMatrix } from "../resolve-verify-matrix";

const workflow = parse(
  readFileSync(
    new URL("../../../.github/workflows/showcase_deploy.yml", import.meta.url),
    "utf8",
  ),
);
const run = workflow.jobs["resolve-matrix"].steps.find(
  (step: { id?: string }) => step.id === "redeploy-gate",
).run;
const skip = {
  service: "skipped",
  status: "skipped",
  reason: "superseded",
  supersededBy: "e".repeat(40),
  supersedingImageDigest: `sha256:${"e".repeat(64)}`,
};
function gate(records: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "superseded-gate-"));
  try {
    mkdirSync(join(directory, ".redeploy"));
    writeFileSync(
      join(directory, ".redeploy/summary.json"),
      JSON.stringify(records),
    );
    const output = join(directory, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", run], {
      cwd: directory,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    return {
      ...result,
      outputs: Object.fromEntries(
        readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split("=")),
      ),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function matrix(ok: string) {
  return resolveVerifyMatrix({
    eventName: "workflow_run",
    summaryPresent: "true",
    okFromRedeploy: ok,
    dispatchService: "all",
    ssotServices: ["skipped", "successful", "failed"].map((name) => ({
      name,
      dispatchName: name,
      probe: { staging: true },
    })),
  });
}
describe("superseded summary workflow consumer", () => {
  it("accepts proven skipped-only artifacts and produces no verify probes", () => {
    const result = gate([skip]);
    expect(result.status).toBe(0);
    expect(result.outputs).toMatchObject({
      redeploy_red: "false",
      ok_services: "",
      skipped_services: "skipped",
      failed_services: "",
    });
    expect(matrix(result.outputs.ok_services)).toMatchObject({
      hasServices: false,
      servicesCsv: "",
    });
  });
  it("keeps mixed errors red and probes only successful services", () => {
    const result = gate([
      skip,
      { service: "successful", status: "ok" },
      { service: "failed", status: "error", error: "broken" },
    ]);
    expect(result.status).toBe(0);
    expect(result.outputs).toMatchObject({
      redeploy_red: "true",
      ok_services: "successful",
      skipped_services: "skipped",
      failed_services: "failed",
    });
    expect(matrix(result.outputs.ok_services).servicesCsv).toBe("successful");
  });
  it.each([
    { ...skip, reason: "unknown" },
    { ...skip, supersededBy: "short" },
    { ...skip, supersedingImageDigest: "invalid" },
    { service: "missing", status: "skipped" },
    { service: "unknown", status: "neutral" },
  ])("rejects malformed skipped or unknown statuses: %j", (row) => {
    expect(gate([{ service: "valid", status: "ok" }, row]).status).not.toBe(0);
  });
});
