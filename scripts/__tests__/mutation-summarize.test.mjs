import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_MUTANTS_FOR_RANKING,
  mergeReports,
  parsePackageSpec,
  renderIdleTests,
  renderMarkdown,
  summarizeReport,
} from "../mutation/summarize.mjs";

function mutants(status, n, killedBy = [], coveredBy = killedBy) {
  return Array.from({ length: n }, () => ({ status, killedBy, coveredBy }));
}

const report = {
  files: {
    "src/strong.ts": {
      mutants: [
        ...mutants("Killed", 18, ["a1"]),
        ...mutants("Timeout", 2, ["a1", "b1"]),
      ],
    },
    "src/weak.ts": {
      mutants: [
        ...mutants("Killed", 5, ["a1", "b1"]),
        // a2 runs code that survives: likely rot.
        ...mutants("Survived", 10, [], ["a2"]),
        ...mutants("NoCoverage", 5),
        // Not part of the score. Running an ignored mutant does not count.
        ...mutants("CompileError", 7),
        ...mutants("Ignored", 3, [], ["c3"]),
      ],
    },
    // Timeouts never say which test caused them.
    "src/tiny.ts": { mutants: mutants("Timeout", 1, [], ["c1"]) },
  },
  testFiles: {
    "src/a.test.ts": {
      tests: [
        { id: "a1", name: "a kills", location: { start: { line: 3 } } },
        { id: "a2", name: "a | idle", location: { start: { line: 9 } } },
      ],
    },
    "src/b.test.ts": { tests: [{ id: "b1", name: "b kills" }] },
    "src/c.test.ts": {
      tests: [
        { id: "c1", name: "c timeout", location: { start: { line: 1 } } },
        { id: "c2", name: "c types", location: { start: { line: 2 } } },
        { id: "c3", name: "c static", location: { start: { line: 3 } } },
      ],
    },
  },
};

test("scores count timeouts as detected and skip compile errors", () => {
  const s = summarizeReport(report);
  assert.deepEqual(s.total, {
    detected: 26,
    timedOut: 3,
    survived: 10,
    noCoverage: 5,
  });
  assert.equal(s.score.toFixed(2), ((26 / 41) * 100).toFixed(2));
  assert.equal(s.coveredScore.toFixed(2), ((26 / 36) * 100).toFixed(2));
});

test("ranks files worst first and drops files under the mutant floor", () => {
  const s = summarizeReport(report);
  assert.ok(MIN_MUTANTS_FOR_RANKING > 1);
  assert.deepEqual(
    s.worstFiles.map((f) => [f.path, f.score]),
    [
      ["src/weak.ts", 25],
      ["src/strong.ts", 100],
    ],
  );
});

test("finds test files that kill nothing and files with no unique kill", () => {
  const s = summarizeReport(report);
  assert.equal(s.testFileCount, 3);
  assert.deepEqual(
    s.zeroKillTests.map((t) => t.path),
    ["src/c.test.ts"],
  );
  // b only kills mutants that a also kills.
  assert.deepEqual(
    s.redundantTests.map((t) => [t.path, t.kills]),
    [["src/b.test.ts", 7]],
  );
});

test("counts single tests that kill nothing, per test file", () => {
  const s = summarizeReport(report);
  // a2 never kills; every test in c is idle.
  assert.equal(s.testCount, 6);
  assert.equal(s.idleTestCount, 4);
  assert.deepEqual(
    s.idleTests.map((t) => [t.path, t.idle]),
    [
      ["src/c.test.ts", 3],
      ["src/a.test.ts", 1],
    ],
  );
});

test("a report with no test data yields no test-file findings", () => {
  const s = summarizeReport({ files: { "src/x.ts": { mutants: [] } } });
  assert.equal(s.score, null);
  assert.equal(s.testFileCount, 0);
  assert.deepEqual(s.zeroKillTests, []);
});

test("markdown lists the package score and the zero-kill test file", () => {
  const md = renderMarkdown([
    { name: "@copilotkit/x", summary: summarizeReport(report) },
  ]);
  assert.match(md, /\| `@copilotkit\/x` \| \*\*63\.4%\*\* \|/);
  assert.match(md, /\| 26 \(3\) \| 10 \| 5 \| 41 \|/);
  assert.match(
    md,
    /\*\*4 of 6\*\* \(`runs-code` 1, `timeout` 1, `no-code` 2\)/,
  );
  assert.match(md, /- `src\/c\.test\.ts` \(3 tests\)/);
  assert.match(md, /\*\*1 of 3\*\*/);
});

test("gives each idle test a name, a line and a reason", () => {
  const s = summarizeReport(report);
  assert.deepEqual(s.idleByReason, {
    "runs-code": 1,
    timeout: 1,
    "no-code": 2,
  });
  assert.deepEqual(s.idleTests.find((t) => t.path === "src/c.test.ts").list, [
    { name: "c timeout", line: 1, reason: "timeout" },
    { name: "c types", line: 2, reason: "no-code" },
    { name: "c static", line: 3, reason: "no-code" },
  ]);
});

test("idle list puts likely rot first and can keep only some reasons", () => {
  const packages = [
    { name: "@copilotkit/x", summary: summarizeReport(report) },
  ];
  const all = renderIdleTests(packages);
  assert.ok(all.indexOf("### `runs-code` (1)") < all.indexOf("### `timeout`"));
  assert.ok(all.indexOf("### `timeout`") < all.indexOf("### `no-code` (2)"));
  // Pipes in test names must not break the table.
  assert.match(all, /\| `src\/a\.test\.ts` \| 9 \| a \\\| idle \|/);

  const rot = renderIdleTests(packages, { reasons: ["runs-code"] });
  assert.match(rot, /a \\\| idle/);
  assert.doesNotMatch(rot, /c types|c timeout|`no-code`:/);
});

function testCase(id, name) {
  return { id, name, location: { start: { line: 1 } } };
}

test("merged shards count a test that kills only in another shard", () => {
  // Each shard numbers its tests differently.
  const shardA = {
    files: { "src/a.ts": { mutants: mutants("Killed", 2, ["0"]) } },
    testFiles: {
      "src/x.test.ts": { tests: [testCase("0", "x"), testCase("1", "y")] },
    },
  };
  const shardB = {
    files: { "src/b.ts": { mutants: mutants("Killed", 3, ["0"]) } },
    testFiles: {
      "src/x.test.ts": { tests: [testCase("0", "y"), testCase("1", "x")] },
    },
  };
  // In shard A alone, y looks idle.
  assert.equal(summarizeReport(shardA).idleTestCount, 1);

  const merged = mergeReports([shardA, shardB]);
  assert.deepEqual(Object.keys(merged.files), ["src/a.ts", "src/b.ts"]);
  const s = summarizeReport(merged);
  assert.equal(s.testCount, 2);
  assert.equal(s.idleTestCount, 0);
  assert.equal(s.total.detected, 5);
});

test("merging refuses shards that mutate the same file", () => {
  const shard = { files: { "src/a.ts": { mutants: [] } }, testFiles: {} };
  assert.throws(() => mergeReports([shard, shard]), /src\/a\.ts/);
});

test("a package argument can name its shard reports", () => {
  assert.deepEqual(parsePackageSpec("packages/core"), {
    dir: "packages/core",
    reports: ["packages/core/reports/mutation/mutation.json"],
  });
  assert.deepEqual(parsePackageSpec("packages/react-core=a.json,b.json"), {
    dir: "packages/react-core",
    reports: ["a.json", "b.json"],
  });
});
