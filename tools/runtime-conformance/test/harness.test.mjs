import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cases } from "../cases.mjs";
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

test("entitlement conformance rejects a JSON stub without normalized authority", async () => {
  const results = await runSuite(
    [
      process.execPath,
      fileURLToPath(new URL("./broken-driver.mjs", import.meta.url)),
    ],
    { filter: "entitlements.current" },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].status, "failed");
  assert.match(
    results[0].error,
    /entitlements must match the platform contract/,
  );
});

test("missing driver executable produces a failed case without an unhandled rejection", async () => {
  const results = await runSuite(["/nonexistent/cpk-fixture-driver"], {
    filter: "connect.blank-is-read-only",
  });
  assert.equal(results[0].status, "failed");
  assert.match(results[0].error, /ENOENT/);
});

test("a stalled case fails by its deadline and still closes the driver", async () => {
  const spec = cases.find((entry) => entry.id === "connect.blank-is-read-only");
  const original = spec.run;
  spec.run = () => new Promise(() => {});
  try {
    const results = await runSuite(
      [
        process.execPath,
        fileURLToPath(new URL("./broken-driver.mjs", import.meta.url)),
      ],
      { filter: spec.id, caseTimeoutMs: 20 },
    );
    assert.equal(results[0].status, "failed");
    assert.match(
      results[0].error,
      /Case connect.blank-is-read-only exceeded 20ms/,
    );
  } finally {
    spec.run = original;
  }
});
