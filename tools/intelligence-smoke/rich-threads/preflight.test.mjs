import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { preflight } from "./preflight.mjs";
import { runConfiguredSuite } from "./bootstrap.mjs";

test("preflight retains every missing row and unsupported framework without claiming parity", async () => {
  const value = await preflight({
    frameworks: ["mastra", "adk"],
    rowIds: [1, 2, 3, 4, 5, 6],
    load: async (path) => {
      if (path.includes("row2") || path.includes("import/services"))
        throw Object.assign(new Error("private diagnostic"), {
          code: "ERR_MODULE_NOT_FOUND",
        });
      return { row: { run() {} }, createServices() {} };
    },
  });
  assert.equal(value.ready, false);
  assert.deepEqual(
    value.checks.filter((c) => c.status === "blocked").map((c) => c.name),
    ["row:2", "row:3"],
  );
  assert.equal(
    value.checks.find((c) => c.name === "framework:adk").status,
    "unvalidated",
  );
  assert.equal(JSON.stringify(value).includes("private diagnostic"), false);
});

test("real bootstrap retains blocked evidence before dependencies or provider creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "rich-preflight-"));
  try {
    const outputDir = join(root, "result");
    const report = await runConfiguredSuite({
      config: {
        provider: "railway",
        purpose: "acceptance",
        dependenciesDirectory: "/must-not-load",
      },
      frameworks: ["adk"],
      rowIds: [1],
      outputDir,
    });
    assert.equal(report.status, "blocked");
    assert.equal(report.cleanup, "not-run");
    assert.equal(report.harnessSuccess, false);
    assert.equal(report.error, undefined);
    assert.deepEqual(
      JSON.parse(await readFile(join(outputDir, "suite.json"), "utf8")),
      report,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
