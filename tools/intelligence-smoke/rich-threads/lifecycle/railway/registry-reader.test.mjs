import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { digest, policyDigest } from "./distribution.mjs";
import { policy } from "./contract.mts";
const { readRailwayLifecycleEvidence } = createRequire(import.meta.url)(
  "../../../../../showcase/harness/src/shared/railway-lifecycle-records.ts",
);
test("HTTPS registry reader checks policy/digest and acknowledges actual consumption, never falls back", async (t) => {
  const originalFetch = globalThis.fetch;
  const before = {
    token: process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN,
    consumer: process.env.SHOWCASE_REGISTRY_CONSUMER,
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN", before.token],
      ["SHOWCASE_REGISTRY_CONSUMER", before.consumer],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN = "private-test-token";
  process.env.SHOWCASE_REGISTRY_CONSUMER = "harness";
  const bytes = JSON.stringify({ schemaVersion: 1, runs: [] });
  let acknowledged = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, "error");
    if (options.method === "POST") {
      acknowledged = true;
      assert.equal(
        JSON.parse(options.body).recordsFile,
        "https://runner.example/registry",
      );
      assert.equal(
        JSON.parse(options.body).reader,
        "railway-lifecycle-records-v1",
      );
      return new Response("{}");
    }
    return new Response(bytes, {
      headers: {
        "x-snapshot-sha256": digest(bytes),
        "x-policy-sha256": policyDigest(),
      },
    });
  };
  assert.equal(
    (
      await readRailwayLifecycleEvidence(
        "https://runner.example/registry",
        policy,
        new Date(),
      )
    ).status,
    "valid",
  );
  assert.equal(acknowledged, true);
  globalThis.fetch = async () =>
    new Response(bytes, {
      headers: {
        "x-snapshot-sha256": "wrong",
        "x-policy-sha256": policyDigest(),
      },
    });
  assert.equal(
    (
      await readRailwayLifecycleEvidence(
        "https://runner.example/registry",
        policy,
        new Date(),
      )
    ).status,
    "invalid",
  );
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(
    (
      await readRailwayLifecycleEvidence(
        "https://runner.example/registry",
        policy,
        new Date(),
      )
    ).status,
    "invalid",
  );
});

test("distribution verifies current publication independently of prior consumer activation", async (t) => {
  const { registrySend } = await import("./distribution.mjs");
  const old = globalThis.fetch;
  const token = process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN;
  t.after(() => {
    globalThis.fetch = old;
    if (token === undefined)
      delete process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN;
    else process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN = token;
  });
  process.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN = "private";
  const bytes = JSON.stringify({ schemaVersion: 1, runs: [] });
  let override = {};
  let published = bytes;
  globalThis.fetch = async (url) =>
    String(url).includes("/consumers/")
      ? new Response(
          JSON.stringify({
            consumer: "harness",
            reader: "railway-lifecycle-records-v1",
            sha256: "a".repeat(64),
            recordsFile: "https://runner.example/registry",
            policySha256: policyDigest(),
            at: "2026-01-01T00:00:00Z",
            ...override,
          }),
        )
      : new Response(published, {
          headers: {
            "x-policy-sha256": policyDigest(),
            "x-snapshot-sha256": digest(published),
          },
        });
  const target = {
    transport: "https",
    consumer: "harness",
    recordsFile: "https://runner.example/registry",
  };
  const request = { sha256: digest(bytes), policySha256: policyDigest() };
  assert.equal((await registrySend(target, request)).sha256, digest(bytes));
  override = { recordsFile: "https://other.example/registry" };
  await assert.rejects(registrySend(target, request), /another transport/);
  override = { policySha256: "old-policy" };
  await assert.rejects(registrySend(target, request), /incompatible/);
  override = { consumer: "image-gate" };
  await assert.rejects(registrySend(target, request), /incompatible/);
  override = {};
  published = "different bytes";
  await assert.rejects(registrySend(target, request));
});
