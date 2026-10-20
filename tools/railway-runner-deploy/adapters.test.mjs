import assert from "node:assert/strict";
import test from "node:test";
import { createRailway, createRunner } from "./adapters.mjs";
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
