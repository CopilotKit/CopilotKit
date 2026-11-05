import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";

export const frameworks = Object.freeze([
  "langgraph-python",
  "langgraph-fastapi",
  "langgraph-js",
  "adk",
  "mastra",
  "strands-python",
  "strands-typescript",
]);
export const categories = Object.freeze([
  "user-text",
  "assistant-text",
  "reasoning",
  "chart-pie",
  "chart-bar",
  "image:data",
  "document:data",
  "audio:data",
  "video:data",
  "image:url",
  "document:url",
  "audio:url",
  "video:url",
  "image:file",
  "document:file",
  "audio:file",
  "video:file",
  "flight-card",
  "dashboard-a2ui",
  "calculator-iframe",
  "ordinary-tool",
  "mcp-tool",
  "mcp-app",
  "shared-state-read",
  "shared-state-write",
  "frontend-completed",
  "frontend-pending",
  "native-completed",
  "native-pending",
  "parallel-surfaces",
  "run-error",
]);
export const statuses = Object.freeze([
  "passed",
  "failed",
  "unvalidated",
  "blocked",
  "not-applicable",
]);
export function requireText(value, label) {
  assert.ok(
    typeof value === "string" && value.trim(),
    `${label} must be nonempty`,
  );
}
export function validateBaseline(baseline) {
  assert.ok(
    baseline && typeof baseline === "object",
    "Recorded baseline is required",
  );
  for (const name of ["copilotkit", "intelligence", "agUi"]) {
    assert.match(
      baseline.sources?.[name] ?? "",
      /^[a-f0-9]{40}$/,
      `${name} source revision required`,
    );
  }
  assert.ok(
    Object.keys(baseline.packages ?? {}).length > 0,
    "Installed package identities required",
  );
  for (const [name, version] of Object.entries(baseline.packages))
    requireText(version, name);
  requireText(baseline.fixtureProvenance, "Fixture provenance");
}
export function aggregate(checks) {
  assert.ok(
    Array.isArray(checks) && checks.length > 0,
    "Empty checks cannot pass",
  );
  for (const check of checks)
    assert.ok(
      statuses.includes(check.status),
      `Unknown check status: ${check.status}`,
    );
  for (const status of ["failed", "blocked", "unvalidated"])
    if (checks.some((check) => check.status === status)) return status;
  return checks.some((check) => check.status === "passed")
    ? "passed"
    : "unvalidated";
}
export function artifactWriter(outputDir) {
  return async (name, value) => {
    requireText(name, "Artifact name");
    const target = resolve(outputDir, name);
    const path = relative(resolve(outputDir), target);
    assert.ok(
      path && !path.startsWith("..") && !isAbsolute(path),
      "Artifact must stay inside row output",
    );
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return path;
  };
}
