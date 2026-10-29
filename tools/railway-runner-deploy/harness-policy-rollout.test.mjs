import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  createHarnessPolicyRollout,
  projectHarnessConfig,
} from "./harness-policy-rollout.mjs";
import { templateSha256 } from "./template-transition.mjs";
import { retainedHarnessJournal } from "./harness-journal.mjs";
import { STAGING } from "./contract.mjs";
import {
  HARNESS_SCOPE,
  HARNESS_BASELINE,
} from "../../showcase/scripts/rollout-harness-policy.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "harness-adapter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseline = JSON.parse(
    await readFile(
      new URL("./releases/harness-policy-baseline.json", import.meta.url),
    ),
  );
  baseline.variablesSha256 = templateSha256({ TEST_KEY: "test-only-secret" });
  baseline.sharedVariablesSha256 = templateSha256({});
  const {
    variablesSha256: _v,
    sharedVariablesSha256: _s,
    ...serviceConfig
  } = baseline;
  const config = structuredClone(serviceConfig);
  config.variables = { TEST_KEY: "test-only-secret" };
  const targetImage = `ghcr.io/copilotkit/showcase-harness@sha256:${"a".repeat(64)}`;
  const state = {
    config,
    patch: {},
    volumes: [],
    latest: { ...HARNESS_BASELINE },
    calls: [],
    failDeploy: false,
    failSource: false,
  };
  const raw = (row) => ({
    ...row,
    ...HARNESS_SCOPE,
    meta: { image: row.image, imageDigest: row.image.split("@")[1] },
  });
  const graphql = async (query, vars) => {
    if (query.startsWith("query"))
      return {
        environment: {
          id: HARNESS_SCOPE.environmentId,
          projectId: HARNESS_SCOPE.projectId,
          config: {
            services: { [HARNESS_SCOPE.serviceId]: state.config },
            sharedVariables: {},
          },
          volumeInstances: {
            pageInfo: { hasNextPage: false },
            edges: state.volumes.map((node) => ({ node })),
          },
        },
        environmentStagedChanges: { patch: state.patch },
        serviceInstance: {
          serviceId: HARNESS_SCOPE.serviceId,
          environmentId: HARNESS_SCOPE.environmentId,
          latestDeployment: raw(state.latest),
          activeDeployments: [raw(state.latest)],
        },
      };
    assert.equal(vars.s, HARNESS_SCOPE.serviceId);
    assert.equal(vars.e, HARNESS_SCOPE.environmentId);
    if (query.includes("serviceInstanceUpdate")) {
      state.calls.push("source");
      assert.deepEqual(vars.input, { source: { image: targetImage } });
      state.config.source.image = targetImage;
      if (state.failSource) throw Error("lost source response");
      return { serviceInstanceUpdate: true };
    }
    assert.ok(query.includes("serviceInstanceDeployV2"));
    state.calls.push("deploy");
    state.latest = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      image: targetImage,
      status: "SUCCESS",
    };
    if (state.failDeploy) throw Error("lost deploy response");
    return { serviceInstanceDeployV2: state.latest.id };
  };
  const options = {
    graphql,
    intent: {
      image: targetImage,
      baselineConfigSha256: templateSha256(baseline),
    },
    deadline: Date.now() + 120000,
    operationId: "github-655515393-123",
    journalPath: join(root, "journal.json"),
    save: async () => {},
    loadBaseline: async () => baseline,
    execute: async (_command, args) => {
      state.calls.push(args);
    },
    env: {
      RAILWAY_TOKEN: "test-provider-secret",
      RAILWAY_SSH_IDENTITY_FILE: "/fixture/identity",
    },
  };
  const durableRoot = await realpath(
    await mkdtemp(join(tmpdir(), "retained-volume-")),
  );
  t.after(() => rm(durableRoot, { recursive: true, force: true }));
  const context = {
    runner: STAGING,
    deploymentId: "runner-candidate",
    releaseSha256: "f".repeat(64),
    operationId: options.operationId,
    harnessImage: targetImage,
  };
  const journalOptions = {
    root: durableRoot,
    env: {
      RAILWAY_PROJECT_ID: STAGING.projectId,
      RAILWAY_ENVIRONMENT_ID: STAGING.environmentId,
      RAILWAY_SERVICE_ID: STAGING.serviceId,
      RAILWAY_DEPLOYMENT_ID: context.deploymentId,
    },
    mountInfo: "1 2 0:1 / /data rw - ext4 volume rw",
  };
  options.durableJournal = Object.fromEntries(
    ["load", "claim", "save"].map((action) => [
      action,
      (receipt) =>
        retainedHarnessJournal({ action, context, receipt }, journalOptions),
    ]),
  );
  return { state, options, adapter: createHarnessPolicyRollout(options) };
}
test("adapter preserves configuration and writes durable ownership before exact source/deploy mutations", async (t) => {
  const f = await fixture(t);
  await f.adapter.preflight();
  const result = await f.adapter.rollout({
    assertCandidateDrained: async () => {},
  });
  assert.deepEqual(f.state.calls, ["source", "deploy"]);
  assert.equal(
    JSON.parse(await readFile(f.options.journalPath)).phase,
    "verified",
  );
  await f.adapter.invokeReader({
    deploymentId: result.deploymentId,
    policySha256: "e".repeat(64),
  });
  const args = f.state.calls.at(-1);
  assert.ok(args.includes(result.deploymentId));
  assert.equal(
    args.some((arg) => arg.includes("test-provider-secret")),
    false,
  );
  assert.deepEqual(await f.adapter.read(), {
    id: result.deploymentId,
    image: f.options.intent.image,
    status: "SUCCESS",
  });
  const count = f.state.calls.length;
  await rm(dirname(f.options.journalPath), { recursive: true, force: true });
  const replacement = createHarnessPolicyRollout(f.options);
  assert.deepEqual(
    await replacement.rollout({ assertCandidateDrained: async () => {} }),
    result,
  );
  assert.equal(
    f.state.calls.length,
    count,
    "Verified remote receipt permits no repeated mutation",
  );
});
test("unknown source/deploy outcomes keep the durable blocker and never resend", async (t) => {
  for (const failure of ["failSource", "failDeploy"]) {
    const f = await fixture(t);
    f.state[failure] = true;
    await assert.rejects(
      f.adapter.rollout({ assertCandidateDrained: async () => {} }),
    );
    const count = f.state.calls.length;
    // Simulate total loss of GitHub RUNNER_TEMP and create a fresh controller.
    // The authoritative volume is independent and must block the fresh worker.
    await rm(dirname(f.options.journalPath), { recursive: true, force: true });
    const replacement = createHarnessPolicyRollout({
      ...f.options,
      journalPath: `${f.options.journalPath}-new-worker`,
    });
    await assert.rejects(
      replacement.rollout({ assertCandidateDrained: async () => {} }),
      /Incomplete harness mutation receipt/,
    );
    assert.equal(f.state.calls.length, count);
  }
});
test("a lost durable checkpoint response prevents provider mutation and blocks a fresh worker", async (t) => {
  const f = await fixture(t);
  const durableJournal = {
    ...f.options.durableJournal,
    claim: async (value) => {
      await f.options.durableJournal.claim(value);
      throw Error("SSH response lost after fsync");
    },
  };
  await assert.rejects(
    createHarnessPolicyRollout({ ...f.options, durableJournal }).rollout({
      assertCandidateDrained: async () => {},
    }),
  );
  assert.deepEqual(f.state.calls, []);
  await assert.rejects(
    f.adapter.rollout({ assertCandidateDrained: async () => {} }),
    /Incomplete harness mutation receipt/,
  );
  assert.deepEqual(f.state.calls, []);
});
test("staged changes, secret-variable drift and mounts fail before source mutation", async (t) => {
  for (const change of [
    (s) => {
      s.patch = { services: {} };
    },
    (s) => {
      s.config.variables.TEST_KEY = "changed";
    },
    (s) => {
      s.volumes = [{ id: "new-volume", serviceId: HARNESS_SCOPE.serviceId }];
    },
  ]) {
    const f = await fixture(t);
    change(f.state);
    await assert.rejects(
      f.adapter.rollout({ assertCandidateDrained: async () => {} }),
    );
    assert.deepEqual(f.state.calls, []);
  }
});
test("configuration projection never returns variable values", () => {
  const config = projectHarnessConfig({
    services: {
      [HARNESS_SCOPE.serviceId]: {
        build: {},
        deploy: {},
        networking: {},
        source: {},
        variables: { KEY: "test-secret" },
      },
    },
    sharedVariables: { SHARED: "test-shared-secret" },
  });
  assert.equal(JSON.stringify(config).includes("test-secret"), false);
  assert.equal(JSON.stringify(config).includes("test-shared-secret"), false);
});
