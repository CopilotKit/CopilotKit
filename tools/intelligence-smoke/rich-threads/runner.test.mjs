import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSuite } from "./runner.mjs";
import { aggregate, artifactWriter } from "./contract.mjs";

const baseline = {
  sources: {
    copilotkit: "a".repeat(40),
    intelligence: "b".repeat(40),
    agUi: "c".repeat(40),
  },
  packages: { runtime: "test-only" },
  fixtureProvenance: "runner lifecycle unit test, not live framework evidence",
};
const pass = {
  id: 1,
  title: "test",
  run: async () => ({
    status: "passed",
    checks: [{ name: "check", status: "passed" }],
    limitations: [],
  }),
};
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), "rich-runner-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
test("runner retains baseline, row evidence, and owned cleanup", async (t) => {
  const directory = await temporary(t);
  let stopped = 0;
  const result = await runSuite({
    framework: "mastra",
    baseline,
    outputDir: join(directory, "output"),
    rows: [pass],
    createFixture: async () => ({ cleanup: async () => stopped++ }),
  });
  assert.equal(result.status, "passed");
  assert.equal(stopped, 1);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "output/baseline.json"))),
    baseline,
  );
});
test("row failure keeps evidence and still cleans up", async (t) => {
  const directory = await temporary(t);
  let stopped = false;
  const result = await runSuite({
    framework: "strands-typescript",
    baseline,
    outputDir: join(directory, "output"),
    rows: [
      {
        ...pass,
        run: async (c) => {
          await c.writeArtifact("before.json", { persisted: false });
          throw Error("missing event");
        },
      },
    ],
    createFixture: async () => ({
      cleanup: async () => {
        stopped = true;
      },
    }),
  });
  assert.equal(result.status, "failed");
  assert.ok(stopped);
  assert.match(result.rows[0].checks[0].detail, /missing event/);
  assert.equal(
    JSON.parse(await readFile(join(directory, "output/row1/before.json")))
      .persisted,
    false,
  );
});
test("setup failure reports blocked, cleanup failure reports failed", async (t) => {
  const directory = await temporary(t);
  const args = { framework: "mastra", baseline, rows: [pass] };
  const setup = await runSuite({
    ...args,
    outputDir: join(directory, "setup"),
    createFixture: async () => {
      throw Error("backend unavailable");
    },
  });
  assert.equal(setup.status, "blocked");
  const cleanup = await runSuite({
    ...args,
    outputDir: join(directory, "cleanup"),
    createFixture: async () => ({
      cleanup: async () => {
        throw Error("owned process still running");
      },
    }),
  });
  assert.equal(cleanup.status, "failed");
  assert.equal(cleanup.cleanup, "failed");
});
test("unvalidated coverage never becomes green and false verdicts fail", async (t) => {
  assert.equal(
    aggregate([{ status: "passed" }, { status: "unvalidated" }]),
    "unvalidated",
  );
  assert.equal(aggregate([{ status: "not-applicable" }]), "unvalidated");
  assert.throws(() => aggregate([]), /Empty checks/);
  const directory = await temporary(t);
  const result = await runSuite({
    framework: "mastra",
    baseline,
    outputDir: join(directory, "output"),
    rows: [
      {
        ...pass,
        run: async () => ({
          status: "passed",
          checks: [{ status: "unvalidated" }],
        }),
      },
    ],
    createFixture: async () => ({ cleanup: async () => {} }),
  });
  assert.equal(result.status, "failed");
});
test("artifacts cannot overwrite prior evidence or escape owned directory", async (t) => {
  const directory = await temporary(t);
  const write = artifactWriter(directory);
  await assert.rejects(write("../outside.json", {}), /inside row/);
  await write("evidence.json", {});
  await assert.rejects(write("evidence.json", { modified: true }), /EEXIST/);
});
