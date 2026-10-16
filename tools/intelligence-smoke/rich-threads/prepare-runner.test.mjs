import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
test("runner staging binds committed source, compatibility, and policy identities", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runner-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"),
    output = join(root, "output");
  await mkdir(source);
  const files = {
    "package.json": '{"type":"module"}',
    "tools/intelligence-smoke/rich-threads/lifecycle/railway/runner/Dockerfile":
      "FROM node:24\n",
    "showcase/scripts/railway-envs.ts":
      "export const DISPOSABLE_LIFECYCLE_POLICY = {version:1};\n",
    "tools/intelligence-smoke/rich-threads/scenarios/row1.mjs":
      "export const assertion = true;\n",
  };
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), bytes);
  }
  await exec("git", ["init", "-q"], { cwd: source });
  await exec("git", ["add", "."], { cwd: source });
  await exec(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "test: sources",
    ],
    { cwd: source },
  );
  await writeFile(
    join(source, "showcase/scripts/railway-envs.ts"),
    "dirty data must not be staged",
  );
  await exec(process.execPath, [
    resolve("tools/intelligence-smoke/rich-threads/prepare-runner.mjs"),
    "--source",
    source,
    "--output",
    output,
  ]);
  const manifestBytes = await readFile(join(output, "source-manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const identity = JSON.parse(
    await readFile(join(output, "runner-identity.json")),
  );
  assert.equal(identity.protocolVersion, 1);
  assert.equal(identity.sourceRevision, manifest.revision);
  assert.equal(
    identity.sourceManifestSha256,
    createHash("sha256").update(manifestBytes).digest("hex"),
  );
  assert.equal(
    identity.policySha256,
    createHash("sha256")
      .update(JSON.stringify({ version: 1 }))
      .digest("hex"),
  );
  assert.equal(
    manifest.compatibilityFiles.some((file) =>
      file.path.endsWith("scenarios/row1.mjs"),
    ),
    false,
  );
  assert.equal(
    manifest.compatibilityFiles.some((file) =>
      file.path.endsWith("runner/Dockerfile"),
    ),
    true,
  );
  assert.equal(
    identity.compatibilitySha256,
    createHash("sha256")
      .update(JSON.stringify(manifest.compatibilityFiles))
      .digest("hex"),
  );
});
