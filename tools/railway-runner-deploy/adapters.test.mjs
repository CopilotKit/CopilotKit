import assert from "node:assert/strict";
import test from "node:test";
import {
  createRailway,
  createRunner,
  REMOVAL_HANDOFF_BASELINE,
} from "./adapters.mjs";
import { STAGING, RUNNER_URL } from "./contract.mjs";
const image = `ghcr.io/copilotkit/rich-thread-runner@sha256:${"a".repeat(64)}`;
function data() {
  return {
    serviceInstance: {
      id: STAGING.instanceId,
      serviceId: STAGING.serviceId,
      environmentId: STAGING.environmentId,
      source: { image },
      activeDeployments: [
        {
          id: "deployment",
          status: "SUCCESS",
          projectId: STAGING.projectId,
          serviceId: STAGING.serviceId,
          environmentId: STAGING.environmentId,
          meta: {
            image,
            imageDigest: `sha256:${"a".repeat(64)}`,
            volumeMounts: ["/data"],
            serviceManifest: "secret",
          },
        },
      ],
      latestDeployment: {
        id: "deployment",
        status: "SUCCESS",
        projectId: STAGING.projectId,
        serviceId: STAGING.serviceId,
        environmentId: STAGING.environmentId,
        meta: {
          image,
          imageDigest: `sha256:${"a".repeat(64)}`,
          volumeMounts: ["/data"],
        },
      },
    },
    environment: {
      id: STAGING.environmentId,
      projectId: STAGING.projectId,
      volumeInstances: {
        pageInfo: { hasNextPage: false },
        edges: [
          {
            node: {
              id: STAGING.volumeInstanceId,
              volumeId: STAGING.volumeId,
              environmentId: STAGING.environmentId,
              serviceId: STAGING.serviceId,
              mountPath: "/data",
              isPendingDeletion: false,
            },
          },
        ],
      },
    },
  };
}
test("Railway adapter limits mutation to source image and explicit deploy; strips raw metadata", async () => {
  const calls = [];
  const railway = createRailway({
    token: "private",
    fetch: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return Response.json({
        data: {
          ...data(),
          serviceInstanceUpdate: true,
          serviceInstanceDeployV2: "new",
        },
      });
    },
  });
  const state = await railway.inspect();
  assert.equal(JSON.stringify(state).includes("secret"), false);
  await railway.setImage(image);
  assert.equal(await railway.deploy(), "new");
  const mutations = calls.filter((x) => x.body.query.startsWith("mutation"));
  assert.equal(mutations.length, 2);
  assert.deepEqual(mutations[0].body.variables.input, { source: { image } });
  for (const call of calls) {
    assert.equal(call.url, "https://backboard.railway.app/graphql/v2");
    assert.equal(call.options.headers.authorization, "Bearer private");
    assert.equal(call.options.redirect, "error");
    assert.equal(
      call.body.variables.environmentId ?? call.body.variables.e,
      STAGING.environmentId,
    );
  }
});
for (const mismatch of [
  "scope",
  "actual",
  "mount",
  "volume",
  "pagination",
  "active",
])
  test(`Railway rejects ${mismatch} ambiguity`, async () => {
    const value = data();
    if (mismatch === "scope") value.environment.projectId = "other";
    if (mismatch === "actual")
      value.serviceInstance.activeDeployments[0].meta.imageDigest = `sha256:${"b".repeat(64)}`;
    if (mismatch === "mount")
      value.serviceInstance.activeDeployments[0].meta.volumeMounts = [];
    if (mismatch === "volume")
      value.environment.volumeInstances.edges[0].node.isPendingDeletion = true;
    if (mismatch === "pagination")
      value.environment.volumeInstances.pageInfo.hasNextPage = true;
    if (mismatch === "active")
      value.serviceInstance.activeDeployments.push(
        value.serviceInstance.activeDeployments[0],
      );
    const railway = createRailway({
      token: "private",
      fetch: async () => Response.json({ data: value }),
    });
    await assert.rejects(railway.inspect());
  });
test("runner uses exact fixed URL and rejects conflict without retrying drain", async () => {
  const calls = [];
  const runner = createRunner({
    token: "private",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response("private secret", { status: 409 });
    },
  });
  await assert.rejects(
    runner.drain({ operationId: "operation", targetIdentity: {} }),
    (error) => !error.message.includes("private"),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${RUNNER_URL}/deployment/drain`);
});
test("HTTP error does not include response or authorization", async () => {
  const railway = createRailway({
    token: "private",
    fetch: async () =>
      Response.json({ errors: [{ message: "private secret" }] }),
  });
  await assert.rejects(
    railway.inspect(),
    (error) => !error.message.includes("private"),
  );
});
test("zero active deployment is available only to the checkpoint recovery caller", async () => {
  const value = data();
  value.serviceInstance.latestDeployment = {
    ...value.serviceInstance.activeDeployments[0],
    id: "failed",
    status: "FAILED",
  };
  value.serviceInstance.activeDeployments = [];
  const railway = createRailway({
    token: "private",
    fetch: async () => Response.json({ data: value }),
  });
  await assert.rejects(railway.inspect());
  const state = await railway.inspect({ allowNoActive: true });
  assert.equal(state.active, null);
  assert.equal(state.latest.image, image);
});
test("rollback probe distinguishes temporary unavailability from auth failures without retry", async () => {
  let calls = 0;
  const runner = createRunner({
    token: "private",
    fetch: async () => {
      calls++;
      return new Response("", { status: 503 });
    },
  });
  assert.equal(await runner.probe(), null);
  assert.equal(calls, 1);
  const forbidden = createRunner({
    token: "private",
    fetch: async () => new Response("", { status: 401 }),
  });
  await assert.rejects(forbidden.probe());
});
test("early failed deployment needs pinned source image but not an unavailable pulled-image digest", async () => {
  const value = data();
  value.serviceInstance.latestDeployment = {
    ...value.serviceInstance.activeDeployments[0],
    id: "pull-failed",
    status: "FAILED",
    meta: { image },
  };
  const railway = createRailway({
    token: "private",
    fetch: async () => Response.json({ data: value }),
  });
  assert.equal((await railway.inspect()).latest.image, image);
  value.serviceInstance.latestDeployment.meta.imageDigest = `sha256:${"f".repeat(64)}`;
  await assert.rejects(railway.inspect());
});

function stoppedState(overrides = {}) {
  return {
    ...data().serviceInstance.activeDeployments[0],
    id: REMOVAL_HANDOFF_BASELINE.deploymentId,
    deploymentStopped: false,
    meta: { image: REMOVAL_HANDOFF_BASELINE.image, private: "secret" },
    ...overrides,
  };
}
function handoffAdapter(reply) {
  const calls = [];
  const railway = createRailway({
    token: "private",
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return Response.json({ data: await reply(body, calls.length) });
    },
  });
  return { railway, calls };
}
test("remove acknowledgement never substitutes for independently read stopped evidence", async () => {
  const { railway, calls } = handoffAdapter((body) =>
    body.query.startsWith("mutation")
      ? { deploymentRemove: true }
      : { deployment: stoppedState() },
  );
  assert.deepEqual(
    await railway.removeDeployment(REMOVAL_HANDOFF_BASELINE.deploymentId),
    { removeAcknowledged: true },
  );
  assert.equal(
    (await railway.readDeploymentStatus(REMOVAL_HANDOFF_BASELINE.deploymentId))
      .deploymentStopped,
    false,
  );
  await assert.rejects(
    railway.removeDeployment(REMOVAL_HANDOFF_BASELINE.deploymentId),
  );
  assert.equal(calls.filter((x) => x.query.startsWith("mutation")).length, 1);
});
for (const mismatch of [
  "id",
  "projectId",
  "environmentId",
  "serviceId",
  "image",
  "missingStatus",
])
  test(`remove rejects ${mismatch} before mutation`, async () => {
    const state = stoppedState();
    if (mismatch === "image") state.meta.image = image;
    else if (mismatch === "missingStatus") delete state.status;
    else state[mismatch] = "other";
    const { railway, calls } = handoffAdapter(() => ({ deployment: state }));
    await assert.rejects(
      railway.removeDeployment(REMOVAL_HANDOFF_BASELINE.deploymentId),
    );
    assert.equal(calls.filter((x) => x.query.startsWith("mutation")).length, 0);
    await assert.rejects(railway.removeDeployment("another-deployment"));
  });
for (const response of [false, null])
  test(`unconfirmed remove ${response} cannot be retried`, async () => {
    const { railway, calls } = handoffAdapter((body) =>
      body.query.startsWith("mutation")
        ? { deploymentRemove: response }
        : { deployment: stoppedState() },
    );
    await assert.rejects(
      railway.removeDeployment(REMOVAL_HANDOFF_BASELINE.deploymentId),
    );
    await assert.rejects(
      railway.removeDeployment(REMOVAL_HANDOFF_BASELINE.deploymentId),
    );
    assert.equal(calls.filter((x) => x.query.startsWith("mutation")).length, 1);
  });
test("inventory paginates fixed scope and retains competing pending/live evidence without metadata", async () => {
  const states = [
    stoppedState({ deploymentStopped: true }),
    stoppedState({ id: "pending", status: "QUEUED", meta: null }),
    stoppedState({ id: "competing-live" }),
  ];
  const { railway, calls } = handoffAdapter((_body, number) => ({
    deployments: {
      edges: (number === 1 ? states.slice(0, 1) : states.slice(1)).map(
        (node) => ({ node }),
      ),
      pageInfo: {
        hasNextPage: number === 1,
        endCursor: number === 1 ? "cursor" : null,
      },
    },
  }));
  const result = await railway.handoffInventory();
  assert.equal(result.length, 3);
  assert.equal(result[0].deploymentStopped, true);
  assert.deepEqual(result[1], {
    id: "pending",
    status: "QUEUED",
    image: null,
    deploymentStopped: false,
  });
  assert.equal(result[2].deploymentStopped, false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.deepEqual(calls[0].variables.input, {
    projectId: STAGING.projectId,
    environmentId: STAGING.environmentId,
    serviceId: STAGING.serviceId,
  });
  assert.equal(calls[1].variables.after, "cursor");
});
for (const defect of ["scope", "status", "cursor", "duplicate", "bound"])
  test(`inventory fails closed for ${defect}`, async () => {
    const { railway, calls } = handoffAdapter((_body, number) => {
      const state = stoppedState({
        id: defect === "duplicate" ? "same" : `deployment-${number}`,
        deploymentStopped: true,
      });
      if (defect === "scope") state.projectId = "other";
      if (defect === "status") delete state.status;
      return {
        deployments: {
          edges: [{ node: state }],
          pageInfo: {
            hasNextPage: true,
            endCursor: defect === "cursor" ? null : `cursor-${number}`,
          },
        },
      };
    });
    await assert.rejects(railway.handoffInventory());
    assert.ok(calls.length <= 20);
    if (defect === "bound") assert.equal(calls.length, 20);
  });
test("lost remove response preserves one-attempt boundary", async () => {
  const { railway, calls } = handoffAdapter((body) => {
    if (body.query.startsWith("mutation"))
      throw new Error("private transport secret");
    return { deployment: stoppedState() };
  });
  await assert.rejects(
    railway.removeDeployment(REMOVAL_HANDOFF_BASELINE.deploymentId),
    (error) => !error.message.includes("private"),
  );
  await assert.rejects(
    railway.removeDeployment(REMOVAL_HANDOFF_BASELINE.deploymentId),
  );
  assert.equal(calls.filter((x) => x.query.startsWith("mutation")).length, 1);
});

test("remove mutation is exact and readback preserves the stale stop flag without inferring finality", async () => {
  let removed = false;
  const { railway, calls } = handoffAdapter((body) => {
    if (body.query.startsWith("mutation")) {
      assert.equal(
        body.query,
        "mutation($id:String!){deploymentRemove(id:$id)}",
      );
      removed = true;
      return { deploymentRemove: true };
    }
    return {
      deployment: stoppedState({
        status: removed ? "REMOVED" : "SUCCESS",
        deploymentStopped: false,
      }),
    };
  });
  await railway.removeDeployment(REMOVAL_HANDOFF_BASELINE.deploymentId);
  const state = await railway.readDeploymentStatus(
    REMOVAL_HANDOFF_BASELINE.deploymentId,
  );
  assert.equal(state.status, "REMOVED");
  assert.equal(state.deploymentStopped, false);
  assert.equal(calls.filter((c) => c.query.startsWith("mutation")).length, 1);
});
