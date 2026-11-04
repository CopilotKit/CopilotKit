import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_MUTANTS_FOR_RANKING,
  renderMarkdown,
  summarizeReport,
} from "../mutation/summarize.mjs";

function mutants(status, n, killedBy = []) {
  return Array.from({ length: n }, () => ({ status, killedBy }));
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
        ...mutants("Survived", 10),
        ...mutants("NoCoverage", 5),
        // Not part of the score.
        ...mutants("CompileError", 7),
        ...mutants("Ignored", 3),
      ],
    },
    "src/tiny.ts": { mutants: mutants("Survived", 1) },
  },
  testFiles: {
    "src/a.test.ts": { tests: [{ id: "a1" }, { id: "a2" }] },
    "src/b.test.ts": { tests: [{ id: "b1" }] },
    "src/c.test.ts": { tests: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] },
  },
};

test("scores count timeouts as detected and skip compile errors", () => {
  const s = summarizeReport(report);
  assert.deepEqual(s.total, { detected: 25, survived: 11, noCoverage: 5 });
  assert.equal(s.score.toFixed(2), ((25 / 41) * 100).toFixed(2));
  assert.equal(s.coveredScore.toFixed(2), ((25 / 36) * 100).toFixed(2));
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
  assert.match(md, /\| `@copilotkit\/x` \| \*\*61\.0%\*\* \|/);
  assert.match(md, /- `src\/c\.test\.ts` \(3 tests\)/);
  assert.match(md, /\*\*1 of 3\*\*/);
});
