import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateWorkflowContext } from "./run.mjs";
const context = {
  GITHUB_REPOSITORY: "CopilotKit/CopilotKit",
  GITHUB_REPOSITORY_ID: "655515393",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "1",
};
test("only main dispatch or exact pinned bootstrap SHA receives deployment permission", () => {
  assert.doesNotThrow(() => validateWorkflowContext(context));
  assert.throws(() =>
    validateWorkflowContext({ ...context, GITHUB_REF: "refs/heads/feature" }),
  );
  assert.throws(() =>
    validateWorkflowContext({ ...context, GITHUB_EVENT_NAME: "push" }),
  );
  assert.throws(() =>
    validateWorkflowContext({ ...context, GITHUB_REPOSITORY_ID: "1" }),
  );
  const bootstrap = {
    ...context,
    GITHUB_REF: "refs/heads/fix/PNI-605-registry-activation",
    RICH_RUNNER_DEPLOY_BOOTSTRAP_SHA: context.GITHUB_SHA,
  };
  assert.doesNotThrow(() => validateWorkflowContext(bootstrap));
  assert.throws(() =>
    validateWorkflowContext({
      ...bootstrap,
      RICH_RUNNER_DEPLOY_BOOTSTRAP_SHA: "",
    }),
  );
  assert.throws(() =>
    validateWorkflowContext({ ...bootstrap, GITHUB_SHA: "b".repeat(40) }),
  );
});
test("workflow has fixed dispatch, concurrency, no environment setup, and credentials only on deploy step", async () => {
  const source = await readFile(
    ".github/workflows/intelligence-rich-threads-deploy.yml",
    "utf8",
  );
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /timeout-minutes: 240/);
  assert.match(source, /retention-days: 90/);
  assert.match(source, /ref: \$\{\{ github.sha \}\}/);
  assert.match(source, /github.sha == vars.RICH_RUNNER_DEPLOY_BOOTSTRAP_SHA/);
  assert.doesNotMatch(
    source,
    /\n\s+inputs:|\n\s+environment:|b14919f4-6417-429f-848d-c6ae2201e04f|schedule:/,
  );
  assert.equal((source.match(/secrets.RAILWAY_TOKEN/g) || []).length, 1);
  assert.equal((source.match(/secrets.RICH_RUNNER_TOKEN/g) || []).length, 1);
  assert.match(source, /node tools\/railway-runner-deploy\/run.mjs/);
});
