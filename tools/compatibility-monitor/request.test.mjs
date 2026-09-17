import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRequest,
  cleanEnvironment,
  verifyResolved,
} from "./request.mjs";
const request = {
  schemaVersion: 1,
  requestId: "ea3bc291-5f5f-4aab-b46a-57207c717520",
  adapterId: "mastra-ts",
  track: "source",
  sourceSha: "a".repeat(40),
  dependencies: { "@mastra/core": "1.66.0" },
  experimental: false,
};
test("accepts exact stable and prerelease requests", () => {
  assert.deepEqual(validateRequest(request), request);
  assert.ok(
    validateRequest({
      ...request,
      dependencies: { "@mastra/core": "2.0.0-beta.1" },
    }),
  );
});
test("rejects executable, floating, unknown and partial input before commands", () => {
  for (const value of [
    "latest",
    "1.2",
    "^1.0.0",
    "file:/tmp/pkg",
    "https://example.com/pkg",
    "1.0.0; touch /tmp/pwn",
    "$(whoami)",
    "--help",
  ])
    assert.throws(() =>
      validateRequest({ ...request, dependencies: { "@mastra/core": value } }),
    );
  for (const patch of [
    { sourceSha: "main" },
    { requestId: "../../result" },
    { adapterId: "unknown" },
    { track: "published" },
    { adapterVersion: "1.0.0" },
    { dependencies: {} },
    { dependencies: { "@mastra/core": "1.0.0", evil: "1.0.0" } },
    { extra: "x" },
    { experimental: "true" },
  ])
    assert.throws(() => validateRequest({ ...request, ...patch }));
});
test("consumer environment does not inherit credentials or module injection", () => {
  const env = cleanEnvironment({
    PATH: "/bin",
    HOME: "/home/test",
    GH_TOKEN: "secret",
    OPENAI_API_KEY: "secret",
    NODE_PATH: "/workspace",
    PYTHONPATH: "/workspace",
    NODE_OPTIONS: "--import evil",
    NPM_CONFIG_USERCONFIG: "/secrets",
  });
  assert.equal(env.PATH, "/bin");
  for (const key of [
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "NODE_PATH",
    "PYTHONPATH",
    "NODE_OPTIONS",
    "NPM_CONFIG_USERCONFIG",
  ])
    assert.equal(env[key], undefined);
});
test("cannot pass if actual versions missing or different", () => {
  assert.throws(() => verifyResolved(request, {}));
  assert.throws(() => verifyResolved(request, { "@mastra/core": "1.65.0" }));
  assert.doesNotThrow(() => verifyResolved(request, request.dependencies));
});
