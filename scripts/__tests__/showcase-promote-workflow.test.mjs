import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(resolve(root, "showcase/scripts/package.json"));
const { parse } = require("yaml");
const workflow = parse(
  readFileSync(resolve(root, ".github/workflows/showcase_promote.yml"), "utf8"),
);
const promote = workflow.jobs.promote;
const enabled = (condition, inputs, needs = {}) =>
  Function(
    "inputs",
    "needs",
    "always",
    "cancelled",
    `return (${condition
      .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
      .replace(/\bneeds\.([\w-]+)/g, 'needs["$1"]')});`,
  )(
    inputs,
    needs,
    () => true,
    () => false,
  );

test("verification-only dispatch cannot execute the production mutation step", () => {
  const step = promote.steps.find((s) => s.id === "promote");
  assert.ok(step.run.includes("promote-fleet.sh"));
  assert.equal(enabled(step.if, { verify_only: true }), false);
  assert.equal(enabled(step.if, { verify_only: false }), true);
  assert.equal(enabled(step.if, { validate_registry_only: true }), false);
});

test("verification scope executes the real workflow shell without promotion output", () => {
  const step = promote.steps.find((s) => s.id === "verification-scope");
  assert.ok(step, "verification-only scope step required");
  assert.equal(enabled(step.if, { verify_only: true }), true);
  const directory = mkdtempSync(join(tmpdir(), "showcase-verify-scope-"));
  try {
    for (const held of [
      "",
      "aimock,pocketbase,dashboard,harness,harness-workers",
    ]) {
      const output = join(directory, held ? "held" : "leaf");
      const result = spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          CLOSURE_CSV: "starter-ms-agent-framework-dotnet",
          HELD_CSV: held,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: join(directory, "summary"),
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        readFileSync(output, "utf8"),
        `verify_csv=starter-ms-agent-framework-dotnet${held ? `,${held}` : ""}\n`,
      );
      assert.ok(!readFileSync(output, "utf8").includes("succeeded_csv"));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("verification-only reaches the existing production checks without promotion notifications", () => {
  assert.match(
    promote.outputs.verify_csv,
    /steps\.verification-scope\.outputs\.verify_csv/,
  );
  assert.match(
    workflow.jobs["verify-prod"].if,
    /needs\.promote\.result != 'skipped'/,
  );
  assert.equal(enabled(workflow.jobs.notify.if, { verify_only: true }), false);
  assert.equal(enabled(workflow.jobs.notify.if, { verify_only: false }), true);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.verify_only.type,
    "boolean",
  );
  assert.equal(workflow.on.workflow_dispatch.inputs.verify_only.default, false);
});

test("conflicting registry-validation and production-verification modes fail closed", () => {
  const step = promote.steps.find(
    (s) => s.name === "Reject conflicting validation modes",
  );
  assert.ok(step);
  assert.equal(
    enabled(step.if, { verify_only: true, validate_registry_only: true }),
    true,
  );
  assert.equal(
    enabled(step.if, { verify_only: true, validate_registry_only: false }),
    false,
  );
  assert.notEqual(spawnSync("bash", ["-c", step.run]).status, 0);
});

test("starter comparison receives its dedicated production URL and trigger credential", () => {
  const step = workflow.jobs["verify-prod"].steps.find(
    (s) => s.name === "Prod equivalence re-sweep gate",
  );
  assert.equal(
    step.env.PROD_HARNESS_BASE_URL,
    "${{ vars.SHOWCASE_PROD_HARNESS_BASE_URL }}",
  );
  assert.equal(
    step.env.PROD_HARNESS_TRIGGER_TOKEN,
    "${{ secrets.SHOWCASE_PROD_HARNESS_TRIGGER_TOKEN }}",
  );
});

test("default promotion and registry-only dispatch retain their existing paths", () => {
  const registry = promote.steps.find(
    (s) => s.name === "Validate registry reader without promotion",
  );
  const scope = promote.steps.find((s) => s.id === "verification-scope");
  const mutation = promote.steps.find((s) => s.id === "promote");
  for (const [inputs, expected] of [
    [{}, [true, false, false, true]],
    [{ verify_only: true }, [false, false, true, false]],
    [{ validate_registry_only: true }, [false, true, false, false]],
    [
      { verify_only: true, validate_registry_only: true },
      [false, true, false, false],
    ],
  ]) {
    assert.deepEqual(
      [mutation.if, registry.if, scope.if, workflow.jobs.notify.if].map(
        (condition) => enabled(condition, inputs),
      ),
      expected,
    );
  }
  assert.equal(promote.steps[0].name, "Reject conflicting validation modes");
});

test("verification-only skips staging while preserving the normal promotion precondition", () => {
  const staging = workflow.jobs["verify-staging-precondition"];
  assert.equal(enabled(staging.if, {}), true);
  assert.equal(enabled(staging.if, { verify_only: true }), false);
  assert.equal(enabled(staging.if, { validate_registry_only: true }), false);
  assert.equal(
    enabled(
      promote.if,
      { verify_only: true },
      {
        "resolve-targets": { result: "success" },
        "verify-staging-precondition": { result: "skipped" },
      },
    ),
    true,
  );
});

test("verification-only scope reaches compatibility, health and equivalence checks", () => {
  const needs = {
    promote: {
      result: "success",
      outputs: { verify_csv: "starter-ms-agent-framework-dotnet,harness" },
    },
  };
  for (const name of ["compatibility-refresh", "verify-prod"]) {
    assert.equal(
      enabled(workflow.jobs[name].if, { verify_only: true }, needs),
      true,
    );
    assert.equal(
      enabled(workflow.jobs[name].if, { validate_registry_only: true }, needs),
      false,
    );
  }
  assert.equal(
    workflow.jobs["compatibility-refresh"].with.services_csv,
    "${{ needs.promote.outputs.verify_csv }}",
  );
  const health = workflow.jobs["verify-prod"].steps.find(
    (s) => s.id === "verify",
  );
  const equivalence = workflow.jobs["verify-prod"].steps.find(
    (s) => s.name === "Prod equivalence re-sweep gate",
  );
  assert.equal(
    health.env.SERVICES_CSV,
    "${{ needs.promote.outputs.verify_csv }}",
  );
  assert.equal(
    equivalence.env.PROMOTED_CLOSURE_CSV,
    "${{ needs.promote.outputs.verify_csv }}",
  );
});

test("empty verification closure fails before emitting a successful scope", () => {
  const step = promote.steps.find((s) => s.id === "verification-scope");
  const directory = mkdtempSync(join(tmpdir(), "showcase-verify-empty-"));
  try {
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        CLOSURE_CSV: "",
        HELD_CSV: "harness",
        GITHUB_OUTPUT: join(directory, "output"),
        GITHUB_STEP_SUMMARY: join(directory, "summary"),
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.throws(() => readFileSync(join(directory, "output")), {
      code: "ENOENT",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
