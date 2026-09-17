import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorPlan } from "./typescript.mjs";
test("workflow uses per-request concurrency and preserves failure evidence", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/intelligence-compatibility-monitor.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    workflow,
    /group: compatibility-\$\{\{ fromJSON\(inputs.request\).requestId \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /always\(\)/);
  assert.match(workflow, /ref: \$\{\{ steps.request.outputs.sourceSha \}\}/);
  assert.doesNotMatch(workflow, /persist-credentials: true|secrets\./);
});
test("monitor plan accepts output location but validates request payload", () => {
  const file = join(mkdtempSync(join(tmpdir(), "plan-test-")), "plan.json");
  const r = {
    schemaVersion: 1,
    requestId: "ea3bc291-5f5f-4aab-b46a-57207c717520",
    adapterId: "mastra-ts",
    track: "published",
    adapterVersion: "1.71.2",
    sourceSha: "a".repeat(40),
    dependencies: { "@mastra/core": "1.66.0" },
    experimental: false,
  };
  writeFileSync(file, JSON.stringify({ ...r, output: "/tmp/artifacts" }));
  assert.deepEqual(monitorPlan(["node", "test", "--monitor-plan", file]), r);
});
test("published native harness never reads missing workspace dist", () => {
  for (const name of ["langgraph", "mastra"]) {
    const code = readFileSync(
      new URL(
        `../../packages/intelligence-${name}/test/compatibility.mjs`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(
      code,
      /monitor\?\.track === "published"\s*\? \[\]\s*: readdirSync/,
    );
  }
});
