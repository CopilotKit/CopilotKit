import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCandidate } from "./candidate.mjs";

const revision = "a".repeat(40);
const imageId = `sha256:${"b".repeat(64)}`;
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "candidate-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const run = async (file, args, options) => {
    calls.push({ file, args, options });
    if (file === "git" && args[0] === "status") return overrides.dirty ?? "";
    if (file === "git" && args[0] === "rev-parse") return revision;
    if (
      file === "git" &&
      args[0] === "archive" &&
      overrides.lfs &&
      options.env?.GIT_LFS_SKIP_SMUDGE !== "1"
    )
      throw new Error("Private LFS download requires credentials");
    if (file === "git" && args[0] === "archive")
      await writeFile(
        args[args.indexOf("--output") + 1],
        "tracked source archive",
      );
    if (options.step === overrides.failStep)
      throw new Error("Candidate build failed");
    if (file === "docker" && args[1] === "ls") return imageId;
    if (file === "docker" && args[1] === "rm" && overrides.cleanupFails)
      throw new Error("Image removal failed");
    if (file === "docker" && args.includes("inspect")) {
      if (overrides.missing) throw new Error("No such image");
      return JSON.stringify({
        id: overrides.id ?? imageId,
        revision: overrides.label ?? revision,
      });
    }
    return "";
  };
  return { directory, source: "/private/source", run, calls };
}

test("candidate builds each committed source context and returns local image identities", async (t) => {
  const f = await fixture(t);
  const result = await buildCandidate(f);
  assert.equal(result.revision, revision);
  const builds = f.calls.filter(
    ({ file, args }) => file === "docker" && args[0] === "build",
  );
  assert.equal(builds.length, 3);
  assert.ok(
    builds.every(({ args }) =>
      args.includes(`org.opencontainers.image.revision=${revision}`),
    ),
  );
  assert.ok(
    builds.every(
      ({ options, args }) =>
        options.cwd === f.source &&
        Buffer.isBuffer(options.input) &&
        args.at(-1) === "-",
    ),
  );
  assert.ok(
    f.calls.some(({ args }) =>
      args.includes(`${revision}:apps/realtime-gateway`),
    ),
  );
  assert.deepEqual(Object.keys(result.images), [
    "appApi",
    "realtimeGateway",
    "migrations",
  ]);
  for (const image of Object.values(result.images)) {
    assert.equal(image.pullPolicy, "Never");
    assert.equal(image.digest, "");
    assert.ok(image.tag.startsWith(revision));
    assert.ok(result.dockerImages.includes(`${image.repository}:${image.tag}`));
  }
  assert.ok(
    result.imageEvidence.every(
      (image) => image.id === imageId && image.revision === revision,
    ),
  );
  assert.deepEqual(await readdir(f.directory), []);
  const again = await buildCandidate(f);
  assert.notEqual(again.images.appApi.tag, result.images.appApi.tag);
});

for (const [name, overrides, error] of [
  ["wrong image revision", { label: "c".repeat(40) }, /revision/],
  ["missing image", { missing: true }, /No such image/],
  ["missing image ID", { id: "" }, /identity/],
  ["dirty tracked source", { dirty: " M apps/app-api/src/main.ts" }, /clean/],
])
  test(`candidate rejects ${name}`, async (t) => {
    const f = await fixture(t, overrides);
    await assert.rejects(buildCandidate(f), error);
    assert.deepEqual(await readdir(f.directory), []);
    if (overrides.dirty)
      assert.equal(
        f.calls.some(({ file }) => file === "docker"),
        false,
      );
  });

test("partial candidate failure removes only attempted unique tags and keeps the original error", async (t) => {
  for (const cleanupFails of [false, true]) {
    const f = await fixture(t, {
      failStep: "candidate-build-realtime-gateway",
      cleanupFails,
    });
    await assert.rejects(buildCandidate(f), /Candidate build failed/);
    const refs = f.calls
      .filter(({ args }) => args[0] === "build")
      .map(({ args }) => args[args.indexOf("--tag") + 1]);
    const removed = f.calls
      .filter(({ args }) => args[1] === "rm")
      .map(({ args }) => args.at(-1));
    assert.equal(refs.length, 2);
    assert.deepEqual(removed, refs);
    assert.deepEqual(await readdir(f.directory), []);
  }
});

test("candidate archives do not download private LFS test fixtures", async (t) => {
  const f = await fixture(t, { lfs: true });
  const result = await buildCandidate(f);
  assert.equal(result.imageEvidence.length, 3);
});

test("interrupted candidate permits only cleanup commands and preserves cancellation", async (t) => {
  const f = await fixture(t);
  const run = f.run;
  const interruption = new Error("Smoke run interrupted by SIGINT");
  let interrupted = false;
  f.run = async (file, args, options) => {
    if (options.step === "candidate-build-realtime-gateway") interrupted = true;
    if (interrupted && !options.cleanup) throw interruption;
    return run(file, args, options);
  };
  await assert.rejects(buildCandidate(f), (error) => error === interruption);
  assert.equal(f.calls.filter(({ args }) => args[1] === "rm").length, 2);
});
