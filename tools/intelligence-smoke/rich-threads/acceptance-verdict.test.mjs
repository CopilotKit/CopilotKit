import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceVerdict } from "./acceptance-verdict.mjs";
import { milestone } from "./contract.mjs";
const report = () => ({
  milestone,
  provider: "railway",
  purpose: "acceptance",
  cleanup: "passed",
  withinLifetime: true,
  deadlineExceeded: false,
  harnessSuccess: true,
  status: "passed",
  frameworks: [
    { framework: "mastra", status: "passed" },
    { framework: "strands-typescript", status: "passed" },
  ],
});
test("supervisor failure never becomes an expected assertion success", () => {
  const value = report();
  value.status = "failed";
  value.failureControl = { injected: true, stage: "after-real-journeys" };
  assert.equal(
    acceptanceVerdict({ report: value, supervisorExit: 0, intentional: true }),
    true,
  );
  for (const supervisorExit of [1, null, 137])
    assert.equal(
      acceptanceVerdict({ report: value, supervisorExit, intentional: true }),
      false,
    );
  assert.equal(
    acceptanceVerdict({
      report: value,
      supervisorExit: 0,
      intentional: true,
      cancelled: true,
    }),
    false,
  );
});
test("both distinct real framework reports and verified cleanup are required", () => {
  assert.equal(
    acceptanceVerdict({ report: report(), supervisorExit: 0 }),
    true,
  );
  for (const change of [
    (r) => r.frameworks.pop(),
    (r) => (r.frameworks[1].framework = "mastra"),
    (r) => (r.cleanup = "failed"),
    (r) => (r.provider = "docker"),
    (r) => (r.status = "blocked"),
    (r) => (r.deadlineExceeded = true),
    (r) => (r.withinLifetime = false),
  ]) {
    const value = report();
    change(value);
    assert.equal(
      acceptanceVerdict({ report: value, supervisorExit: 0 }),
      false,
    );
  }
});
