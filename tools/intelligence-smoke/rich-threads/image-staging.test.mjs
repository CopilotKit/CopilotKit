import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("committed native staging includes helper and every scanner import", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "native-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"),
    output = join(root, "output");
  await mkdir(source);
  const helpers = [
    "lifecycle/clean-scope.mjs",
    "lifecycle/railway/native-inspection.mjs",
    "lifecycle/railway/native-start.mjs",
    "lifecycle/railway/inspection-channel.mjs",
    "lifecycle/railway/journal.mjs",
    "lifecycle/railway/process-owner.mjs",
  ];
  const paths = [
    ...helpers.map((p) => "tools/intelligence-smoke/rich-threads/" + p),
    "tools/intelligence-smoke/rich-threads/application/Strands.Dockerfile",
    "showcase/integrations/strands-typescript/src/agent/server.ts",
    "showcase/integrations/strands-typescript/src/cvdiag/index.ts",
    "showcase/shared/typescript/tools/index.ts",
  ];
  for (const path of paths) {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(
      join(source, path),
      path.startsWith("tools/") ? await readFile(path) : "export {};",
    );
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
      "test: stage sources",
    ],
    { cwd: source },
  );
  await exec(process.execPath, [
    resolve("tools/intelligence-smoke/rich-threads/prepare-native.mjs"),
    "--source",
    source,
    "--output",
    output,
  ]);
  const manifest = JSON.parse(
    await readFile(join(output, "source-manifest.json")),
  );
  for (const path of helpers) {
    assert.ok(manifest.files.some((f) => f.target === "rich-threads/" + path));
    assert.equal(
      (await readFile(join(output, "rich-threads", path))).length,
      (await readFile("tools/intelligence-smoke/rich-threads/" + path)).length,
    );
  }
  const docker = await readFile(join(output, "Dockerfile"), "utf8");
  assert.match(docker, /FROM node:24\./);
  assert.match(docker, /COPY rich-threads \/app\/rich-threads/);
  assert.match(docker, /native-start.mjs/);
});
