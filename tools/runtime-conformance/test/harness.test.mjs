import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runSuite } from "../run.mjs";

test("conformance rejects an HTTP-200 stub without platform behavior", async () => {
  const results = await runSuite(
    [
      process.execPath,
      fileURLToPath(new URL("./broken-driver.mjs", import.meta.url)),
    ],
    { filter: "connect.blank-is-read-only" },
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "failed");
  assert.match(results[0].error, /200 !== 204/);
});

test("metadata conformance rejects a JSON stub without private cache headers", async () => {
  const results = await runSuite(
    [
      process.execPath,
      fileURLToPath(new URL("./broken-driver.mjs", import.meta.url)),
    ],
    { filter: "inspector.metadata-sanitized" },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].status, "failed");
  assert.match(results[0].error, /private metadata must disable storage/);
});

test("misspelled case filters fail instead of reporting zero passing cases", async () => {
  await assert.rejects(
    runSuite(["never-spawned"], { filter: "nonexistent-case" }),
    /No cases match/,
  );
});

test("missing driver executable produces a failed case without an unhandled rejection", async () => {
  const results = await runSuite(["/nonexistent/cpk-fixture-driver"], {
    filter: "connect.blank-is-read-only",
  });
  assert.equal(results[0].status, "failed");
  assert.match(results[0].error, /ENOENT/);
});
