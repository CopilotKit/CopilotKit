import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { adapters, validateRequest } from "./request.mjs";

test("built-in requests watch exact AI SDK and Zod versions", () => {
  assert.ok(adapters["builtin-ts"], "Built-in adapter must be registered");
  const request = {
    schemaVersion: 1,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    adapterId: "builtin-ts",
    track: "source",
    sourceSha: "a".repeat(40),
    experimental: false,
    dependencies: { ai: "6.0.104", zod: "3.25.76" },
  };
  assert.equal(validateRequest(request), request);
  assert.throws(() =>
    validateRequest({
      ...request,
      dependencies: { ai: "^6.0.104", zod: "3.25.76" },
    }),
  );
});

test("built-in consumer uses public runtime and preserves every native contract", async () => {
  const { prepareBuiltinConsumer } = await import("./builtin.mjs");
  const work = mkdtempSync(join(tmpdir(), "builtin-monitor-test-"));
  try {
    prepareBuiltinConsumer(resolve("."), work);
    const native = readFileSync(
      join(work, "learned-skills-native.test.ts"),
      "utf8",
    );
    assert.match(native, /from "@copilotkit\/runtime\/v2"/);
    assert.doesNotMatch(native, /from "\.\.\//);
    assert.match(native, /classic-single-step/);
    assert.match(native, /pauses on an interrupt/);
    assert.match(native, /server\.empty\(\)/);
    const types = readFileSync(
      join(work, "learned-skills-types.test.ts"),
      "utf8",
    );
    assert.doesNotMatch(types, /from "\.\.\//);
    assert.match(types, /@ts-expect-error/);
    assert.match(
      readFileSync(join(work, "tsconfig.json"), "utf8"),
      /learned-skills-types/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("experimental built-in overrides follow declared install rejection", async () => {
  const { installBuiltinConsumer } = await import("./builtin.mjs");
  assert.equal(typeof installBuiltinConsumer, "function");
  const { writeFileSync } = await import("node:fs");
  const work = mkdtempSync(join(tmpdir(), "builtin-install-test-"));
  try {
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({
        dependencies: { ai: "7.0.0", zod: "4.0.0" },
        overrides: { "@copilotkit/runtime": "$@copilotkit/runtime" },
      }),
    );
    const attempts = [];
    installBuiltinConsumer(
      { experimental: true, dependencies: { ai: "7.0.0", zod: "4.0.0" } },
      work,
      {},
      work,
      (plan) => {
        attempts.push({
          plan,
          manifest: JSON.parse(
            readFileSync(join(work, "package.json"), "utf8"),
          ),
        });
        if (attempts.length === 1) throw new Error("Loaded version mismatch");
      },
    );
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].manifest.overrides.ai, undefined);
    assert.equal(attempts[0].plan.experimental, false);
    assert.equal(attempts[1].manifest.overrides.ai, "$ai");
    assert.match(
      readFileSync(join(work, "declared-install-rejected.txt"), "utf8"),
      /Loaded version mismatch/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("declared built-in install failures never force dependency overrides", async () => {
  const { installBuiltinConsumer } = await import("./builtin.mjs");
  const failure = new Error("dependency conflict");
  let calls = 0;
  assert.throws(
    () =>
      installBuiltinConsumer(
        { experimental: false },
        "/unused",
        {},
        "/unused",
        () => {
          calls++;
          throw failure;
        },
      ),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});
