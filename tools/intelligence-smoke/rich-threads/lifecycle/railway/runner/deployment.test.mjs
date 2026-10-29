import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durableJson } from "../journal.mjs";
import {
  checkStartup,
  templateDigest,
  compatibilityFiles,
} from "./deployment.mjs";
const identity = {
  protocolVersion: 1,
  sourceRevision: "a".repeat(40),
  sourceManifestSha256: "a".repeat(64),
  compatibilitySha256: "b".repeat(64),
  policySha256: "c".repeat(64),
};
const target = {
  ...identity,
  sourceRevision: "d".repeat(40),
  sourceManifestSha256: "d".repeat(64),
};
test("startup refuses changed retained configuration and metadata before any writes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runner-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = { secret: "private", version: 1 };
  await mkdir(join(root, "private"));
  await durableJson(join(root, "private/template.json"), template);
  await durableJson(join(root, "runtime.json"), {
    runtimeIdentity: identity,
    templateSha256: templateDigest(template),
  });
  const before = await readFile(join(root, "runtime.json"), "utf8");
  await assert.rejects(
    checkStartup({
      root,
      template: { ...template, secret: "changed" },
      runtimeIdentity: identity,
    }),
    /configuration/,
  );
  await assert.rejects(
    checkStartup({
      root,
      template,
      runtimeIdentity: { ...identity, compatibilitySha256: "e".repeat(64) },
    }),
    /compatibility/,
  );
  await assert.rejects(
    checkStartup({ root, template, runtimeIdentity: target }),
    /drain/,
  );
  assert.equal(await readFile(join(root, "runtime.json"), "utf8"), before);
  await durableJson(join(root, "deployment.json"), {
    version: 1,
    status: "drained",
    operationId: "deploy-1",
    baselineIdentity: identity,
    targetIdentity: target,
    templateSha256: templateDigest(template),
    requestedAt: new Date().toISOString(),
  });
  await checkStartup({ root, template, runtimeIdentity: target });
  await checkStartup({ root, template, runtimeIdentity: identity });
});
test("metadata bootstrap requires unchanged legacy template and no pending operation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runner-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = { version: 1 };
  await checkStartup({ root, template, runtimeIdentity: identity });
  await durableJson(join(root, "deployment.json"), {
    version: 1,
    status: "draining",
  });
  await assert.rejects(
    checkStartup({ root, template, runtimeIdentity: identity }),
    /metadata/,
  );
});
test("compatibility permits assertions but freezes lifecycle and all other shipped inputs", () => {
  const paths = [
    "tools/intelligence-smoke/rich-threads/controller.mjs",
    "tools/intelligence-smoke/rich-threads/scenarios/row1.mjs",
    "tools/intelligence-smoke/rich-threads/browser/session.mjs",
    "tools/intelligence-smoke/rich-threads/lifecycle/railway/runner/server.mjs",
    "tools/intelligence-smoke/rich-threads/storage/intelligence.mjs",
    "tools/intelligence-smoke/rich-threads/template.mjs",
    "package.json",
    "new-unknown-input.mjs",
  ];
  assert.deepEqual(
    compatibilityFiles(
      paths.map((path) => ({ path, sha256: "a".repeat(64) })),
    ).map((file) => file.path),
    paths.filter((path) => !path.endsWith("scenarios/row1.mjs")),
  );
});

test("real staged policy identity matches the authenticated registry policy digest", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { policyDigest } = await import("../distribution.mjs");
  const root = await mkdtemp(join(tmpdir(), "runner-policy-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await promisify(execFile)(process.execPath, [
    "tools/intelligence-smoke/rich-threads/prepare-runner.mjs",
    "--output",
    join(root, "stage"),
  ]);
  const built = JSON.parse(
    await readFile(join(root, "stage/runner-identity.json")),
  );
  assert.equal(built.policySha256, policyDigest());
  assert.equal(
    built.policySha256,
    "818e0ac6b3bef851f39c44a109cdc529cc98da104aeedce8ac84f66db543ff22",
  );
});

test("retained metadata cannot recreate a missing private template", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runner-missing-template-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = { version: 1 };
  await durableJson(join(root, "runtime.json"), {
    runtimeIdentity: identity,
    templateSha256: templateDigest(template),
  });
  await assert.rejects(
    checkStartup({ root, template, runtimeIdentity: identity }),
    /Retained configuration missing/,
  );
});

test("initialized legacy volume cannot bootstrap metadata with a missing template", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runner-legacy-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await durableJson(join(root, "initialized.json"), { serviceId: "runner" });
  await assert.rejects(
    checkStartup({ root, template: { version: 1 }, runtimeIdentity: identity }),
    /Retained configuration missing/,
  );
});
