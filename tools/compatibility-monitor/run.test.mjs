import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeRequest } from "./run.mjs";
const request = {
  schemaVersion: 1,
  requestId: "ea3bc291-5f5f-4aab-b46a-57207c717520",
  adapterId: "mastra-ts",
  track: "source",
  sourceSha: "a".repeat(40),
  dependencies: { "@mastra/core": "1.66.0", zod: "4.6.1" },
  experimental: false,
};
test("writes blocked evidence even when installation fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-test-"));
  const result = await executeRequest(request, {
    output: dir,
    source: dir,
    driver: async () => {
      throw new Error("registry offline");
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    JSON.parse(readFileSync(join(dir, "result.json"))).status,
    "blocked",
  );
});
test("never claims success on missing loaded versions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-test-"));
  const result = await executeRequest(request, {
    output: dir,
    source: dir,
    driver: async () => ({
      resolvedDependencies: {},
      cases: [{ contractId: "native-lifecycle", status: "passed" }],
    }),
  });
  assert.equal(result.status, "blocked");
});
test("retains test failures and exact loaded versions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-test-"));
  const result = await executeRequest(request, {
    output: dir,
    source: dir,
    driver: async () => ({
      resolvedDependencies: request.dependencies,
      cases: [
        {
          contractId: "native-lifecycle",
          status: "failed",
          message: "resume failed",
        },
      ],
    }),
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.resolvedDependencies, request.dependencies);
});
test("rejects malformed request before calling any driver", async () => {
  let called = false;
  await assert.rejects(() =>
    executeRequest(
      { ...request, requestId: "../evil" },
      {
        driver: async () => {
          called = true;
        },
      },
    ),
  );
  assert.equal(called, false);
});
test("no tests is blocked rather than green", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-test-"));
  assert.equal(
    (
      await executeRequest(request, {
        output: dir,
        source: dir,
        driver: async () => ({
          resolvedDependencies: request.dependencies,
          cases: [],
        }),
      })
    ).status,
    "blocked",
  );
});

test("CLI fails the CI job when checkout validation blocks the consumer", async () => {
  const { spawnSync } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const { rmSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "monitor-cli-test-"));
  try {
    const input = join(dir, "request.json");
    writeFileSync(
      input,
      JSON.stringify({
        schemaVersion: 1,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        adapterId: "mastra-ts",
        track: "source",
        sourceSha: "a".repeat(40),
        experimental: false,
        dependencies: { "@mastra/core": "1.67.0", zod: "4.6.1" },
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        "tools/compatibility-monitor/run.mjs",
        input,
        resolve("."),
        join(dir, "output"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(
      JSON.parse(readFileSync(join(dir, "output/result.json"), "utf8")).status,
      "blocked",
    );
    assert.equal(result.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const outcome of ["passed", "failed", "blocked"]) {
  test(`forced resolution remains visible when contracts are ${outcome}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-forced-"));
    const result = await executeRequest(
      { ...request, experimental: true },
      {
        output: dir,
        source: dir,
        driver: async () => {
          writeFileSync(
            join(dir, "declared-install-rejected.txt"),
            "Resolver rejected declared graph",
          );
          if (outcome === "blocked")
            throw new Error("Forced installation also failed");
          return {
            resolvedDependencies: request.dependencies,
            cases: [{ contractId: "native-lifecycle", status: outcome }],
          };
        },
      },
    );
    assert.equal(result.status, outcome);
    const saved = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
    assert.equal(saved.experimental, true);
    assert.equal(saved.forcedResolution, true);
  });
}
test("normal resolution clears stale forced evidence in a reused output directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-normal-"));
  writeFileSync(join(dir, "declared-install-rejected.txt"), "Old rejection");
  const result = await executeRequest(
    { ...request, experimental: true },
    {
      output: dir,
      source: dir,
      driver: async () => ({
        resolvedDependencies: request.dependencies,
        cases: [{ contractId: "native-lifecycle", status: "passed" }],
      }),
    },
  );
  assert.equal(result.status, "passed");
  assert.equal(result.experimental, true);
  assert.equal(result.forcedResolution, false);
});

test("records the workflow revision independently from candidate source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-provenance-"));
  const old = process.env.GITHUB_WORKFLOW_SHA;
  process.env.GITHUB_WORKFLOW_SHA = "b".repeat(40);
  try {
    const result = await executeRequest(request, {
      output: dir,
      source: dir,
      driver: async () => ({
        resolvedDependencies: request.dependencies,
        cases: [{ contractId: "native-lifecycle", status: "passed" }],
      }),
    });
    assert.equal(result.sourceSha, "a".repeat(40));
    assert.equal(result.harnessSha, "b".repeat(40));
  } finally {
    if (old === undefined) delete process.env.GITHUB_WORKFLOW_SHA;
    else process.env.GITHUB_WORKFLOW_SHA = old;
  }
});
