import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHarnessPolicyRollout,
  projectHarnessConfig,
} from "./harness-policy-rollout.mjs";
import { templateSha256 } from "./template-transition.mjs";
import {
  HARNESS_SCOPE,
  HARNESS_BASELINE,
} from "../../showcase/scripts/rollout-harness-policy.mjs";

const candidateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const targetImage = `ghcr.io/copilotkit/showcase-harness@sha256:${"a".repeat(64)}`;
const success = () => ({
  ...HARNESS_SCOPE,
  id: candidateId,
  status: "SUCCESS",
  meta: { image: targetImage, imageDigest: targetImage.split("@")[1] },
});

async function fixture(t, rows) {
  const directory = await mkdtemp(join(tmpdir(), "pending-harness-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stored = JSON.parse(
    await readFile(
      new URL("./releases/harness-policy-baseline.json", import.meta.url),
    ),
  );
  const { variablesSha256: _v, sharedVariablesSha256: _s, ...service } = stored;
  service.variables = {};
  const environmentConfig = {
    services: { [HARNESS_SCOPE.serviceId]: service },
    sharedVariables: {},
  };
  const baseline = projectHarnessConfig(environmentConfig);
  const state = { deployed: false, index: 0, calls: [], reads: [] };
  const journalPath = join(directory, "rollout.json");
  let retainedReceipt = null;
  const adapter = createHarnessPolicyRollout({
    intent: {
      image: targetImage,
      baselineConfigSha256: templateSha256(baseline),
    },
    deadline: Date.now() + 30000,
    operationId: "github-655515393-123",
    journalPath,
    durableJournal: {
      load: async () => structuredClone(retainedReceipt),
      claim: async (value) => {
        assert.equal(retainedReceipt, null, "Journal already claimed");
        retainedReceipt = structuredClone(value);
      },
      save: async (value) => {
        assert.notEqual(retainedReceipt, null, "Journal must be claimed first");
        retainedReceipt = structuredClone(value);
      },
    },
    save: async () => {},
    loadBaseline: async () => baseline,
    graphql: async (query) => {
      if (query.includes("serviceInstanceUpdate(")) {
        state.calls.push("source");
        service.source.image = targetImage;
        return { serviceInstanceUpdate: true };
      }
      if (query.includes("serviceInstanceDeployV2(")) {
        state.calls.push("deploy");
        state.deployed = true;
        return { serviceInstanceDeployV2: candidateId };
      }
      const latest = state.deployed
        ? rows[Math.min(state.index++, rows.length - 1)]
        : {
            ...HARNESS_SCOPE,
            ...HARNESS_BASELINE,
            meta: {
              image: "ghcr.io/copilotkit/showcase-harness:latest",
              imageDigest: HARNESS_BASELINE.image.split("@")[1],
            },
          };
      state.reads.push(latest.status);
      return {
        environment: {
          id: HARNESS_SCOPE.environmentId,
          projectId: HARNESS_SCOPE.projectId,
          config: structuredClone(environmentConfig),
          volumeInstances: { pageInfo: { hasNextPage: false }, edges: [] },
        },
        environmentStagedChanges: { patch: {} },
        serviceInstance: {
          serviceId: HARNESS_SCOPE.serviceId,
          environmentId: HARNESS_SCOPE.environmentId,
          latestDeployment: latest,
          activeDeployments: latest.status === "SUCCESS" ? [latest] : [],
        },
      };
    },
  });
  return {
    adapter,
    state,
    journalPath,
    setTarget: () => {
      state.deployed = true;
      service.source.image = targetImage;
    },
  };
}

test("provider pending states with nullable metadata progress to exact acknowledged successful deployment", async (t) => {
  const states = ["WAITING", "QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING"];
  const rows = states.map((status, index) => ({
    ...HARNESS_SCOPE,
    id: candidateId,
    status,
    ...(index === 0
      ? {}
      : {
          meta: index === 1 ? null : { image: targetImage, imageDigest: null },
        }),
  }));
  const f = await fixture(t, [...rows, success()]);
  const result = await f.adapter.rollout({
    assertCandidateDrained: async () => {},
  });
  assert.equal(result.phase, "verified");
  assert.equal(result.deploymentId, candidateId);
  assert.deepEqual(f.state.calls, ["source", "deploy"]);
  assert.deepEqual(f.state.reads.slice(2), [...states, "SUCCESS"]);
});

test("pending source image without pulled digest remains explicitly unknown", async (t) => {
  const pending = {
    ...HARNESS_SCOPE,
    id: candidateId,
    status: "BUILDING",
    meta: { image: targetImage },
  };
  const f = await fixture(t, [pending]);
  f.setTarget();
  assert.deepEqual(await f.adapter.read(), {
    id: candidateId,
    status: "BUILDING",
    image: null,
  });
  assert.deepEqual(f.state.calls, []);
});

for (const [name, mutate] of [
  [
    "missing success digest",
    (row) => {
      delete row.meta.imageDigest;
    },
  ],
  [
    "wrong digest",
    (row) => {
      row.meta.imageDigest = `sha256:${"b".repeat(64)}`;
    },
  ],
  [
    "foreign scope",
    (row) => {
      row.environmentId = "foreign";
    },
  ],
  [
    "wrong acknowledged ID",
    (row) => {
      row.id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    },
  ],
  [
    "malformed pending digest",
    (row) => {
      row.status = "QUEUED";
      row.meta.imageDigest = "not-a-digest";
    },
  ],
  [
    "mismatching pending image",
    (row) => {
      row.status = "BUILDING";
      row.meta = { image: "ghcr.io/copilotkit/showcase-harness:latest" };
    },
  ],
  [
    "unexpected terminal state",
    (row) => {
      row.status = "FAILED";
    },
  ],
]) {
  test(`pending rollout rejects ${name} and retains acknowledgement without repeating mutations`, async (t) => {
    const row = success();
    mutate(row);
    const f = await fixture(t, [row]);
    await assert.rejects(
      f.adapter.rollout({ assertCandidateDrained: async () => {} }),
    );
    assert.deepEqual(f.state.calls, ["source", "deploy"]);
    assert.equal(
      JSON.parse(await readFile(f.journalPath)).phase,
      "deploy-acknowledged",
    );
  });
}
