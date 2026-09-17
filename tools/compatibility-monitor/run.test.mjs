import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
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
