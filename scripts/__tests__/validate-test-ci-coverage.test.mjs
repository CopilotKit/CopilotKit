import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkCoverage,
  globToRegExp,
  selectTestFiles,
} from "../validate-test-ci-coverage.mjs";

test("`**/` matches zero or more directories", () => {
  const glob = globToRegExp("packages/core/src/**/__tests__/*.test.ts");
  assert.equal(glob.test("packages/core/src/__tests__/a.test.ts"), true);
  assert.equal(glob.test("packages/core/src/x/y/__tests__/a.test.ts"), true);
  assert.equal(glob.test("packages/core/src/x/a.test.ts"), false);
});

test("`*` stays inside one path segment", () => {
  const glob = globToRegExp("tools/oxlint-rules/*.test.mjs");
  assert.equal(glob.test("tools/oxlint-rules/a.test.mjs"), true);
  assert.equal(glob.test("tools/oxlint-rules/nested/a.test.mjs"), false);
});

test("`{a,b}` is a choice and dots are literal", () => {
  const glob = globToRegExp("src/**/*.{test,spec}.{ts,tsx}");
  assert.equal(glob.test("src/a.test.tsx"), true);
  assert.equal(glob.test("src/a.spec.ts"), true);
  assert.equal(glob.test("src/a.bench.ts"), false);
  assert.equal(glob.test("src/aXtestXts"), false);
});

test("selectTestFiles drops fixtures and pytest config", () => {
  const files = selectTestFiles(
    [
      "pkg/src/a.test.ts",
      "pkg/src/a.ts",
      "pkg/__tests__/fixtures/broken.test.ts",
      "pkg/tests/conftest.py",
      "pkg/tests/test_api.py",
    ],
    ["**/*.test.ts", "**/test_*.py", "**/conftest.py"],
    ["**/fixtures/**", "**/conftest.py"],
  );
  assert.deepEqual(files, ["pkg/src/a.test.ts", "pkg/tests/test_api.py"]);
});

const workflows = {
  "unit.yml": "steps:\n  - run: pnpm nx run-many -t test\n",
};
const readWorkflow = (name) => workflows[name];

test("a file no rule or allowlist entry matches is unmapped", () => {
  const result = checkCoverage({
    testFiles: ["pkg/src/a.test.ts", "other/b.test.ts"],
    rules: [
      {
        workflow: "unit.yml",
        runs: "pnpm nx run-many -t test",
        files: "pkg/**/*.test.ts",
      },
    ],
    allowlist: [],
    readWorkflow,
  });
  assert.deepEqual(result.unmapped, ["other/b.test.ts"]);
  assert.deepEqual(result.brokenRules, []);
  assert.deepEqual(result.staleRules, []);
});

test("`exclude` removes files from a rule", () => {
  const result = checkCoverage({
    testFiles: ["pkg/src/a.test.ts", "pkg/src/bun/b.test.ts"],
    rules: [
      {
        workflow: "unit.yml",
        runs: "pnpm nx run-many -t test",
        files: "pkg/**/*.test.ts",
        exclude: "pkg/**/bun/**",
      },
    ],
    allowlist: [],
    readWorkflow,
  });
  assert.deepEqual(result.unmapped, ["pkg/src/bun/b.test.ts"]);
});

test("an allowlisted file is not unmapped", () => {
  const result = checkCoverage({
    testFiles: ["live/x.spec.ts"],
    rules: [],
    allowlist: [{ files: "live/*.spec.ts", reason: "needs a live server" }],
    readWorkflow,
  });
  assert.deepEqual(result.unmapped, []);
  assert.deepEqual(result.staleAllow, []);
});

test("a rule whose workflow is missing or lacks the command is broken", () => {
  const missing = {
    workflow: "gone.yml",
    runs: "pnpm test",
    files: "pkg/**/*.test.ts",
  };
  const renamed = {
    workflow: "unit.yml",
    runs: "pnpm nx run-many -t test,lint",
    files: "pkg/**/*.test.ts",
  };
  const result = checkCoverage({
    testFiles: ["pkg/a.test.ts"],
    rules: [missing, renamed],
    allowlist: [],
    readWorkflow,
  });
  assert.deepEqual(
    result.brokenRules.map(({ rule, problem }) => [rule, problem]),
    [
      [missing, "workflow gone.yml not found"],
      [renamed, 'unit.yml no longer contains "pnpm nx run-many -t test,lint"'],
    ],
  );
});

test("rules and allowlist entries that match nothing are stale", () => {
  const rule = {
    workflow: "unit.yml",
    runs: "pnpm nx run-many -t test",
    files: "deleted/**/*.test.ts",
  };
  const entry = { files: "also-deleted/*.spec.ts", reason: "old" };
  const result = checkCoverage({
    testFiles: [],
    rules: [rule],
    allowlist: [entry],
    readWorkflow,
  });
  assert.deepEqual(result.staleRules, [rule]);
  assert.deepEqual(result.staleAllow, [entry]);
});
