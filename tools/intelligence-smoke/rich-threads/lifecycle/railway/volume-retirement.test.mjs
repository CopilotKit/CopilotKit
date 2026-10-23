import test from "node:test";
import assert from "node:assert/strict";
import { observeVolumeRetirement } from "./volume-retirement.mjs";
function fixture() {
  const instance = {
    id: "vi",
    volumeId: "v",
    environmentId: "e",
    mountPath: "/data",
    serviceId: null,
    isPendingDeletion: true,
  };
  const volume = {
    id: "v",
    projectId: "p",
    volumeInstances: {
      pageInfo: { hasNextPage: false },
      edges: [{ node: instance }],
    },
  };
  const env = { id: "e", projectId: "p", volumeInstances: [instance] };
  return {
    instance,
    volume,
    env,
    args: {
      journal: { projectId: "p", environmentId: "e" },
      resource: { id: "v", mountPath: "/data" },
      receipt: {
        volumeId: "v",
        projectId: "p",
        environmentId: "e",
        outcome: "unknown",
        requestSent: true,
      },
      api: {
        list: async (kind) => (kind === "volumes" ? [volume] : [env]),
        environment: async () => env,
      },
    },
  };
}
test("unknown receipt reconciles only with independent pending and detachment evidence", async () => {
  const f = fixture();
  assert.equal(
    (await observeVolumeRetirement(f.args)).state,
    "pending-detached",
  );
});

test("acknowledged deletion with no references retains the unattached volume record for up to 48 hours", async () => {
  const f = fixture();
  f.volume.volumeInstances.edges = [];
  f.env.volumeInstances = [];
  f.args.receipt.outcome = "acknowledged";
  f.args.receipt.response = true;
  const result = await observeVolumeRetirement(f.args);
  assert.equal(result.state, "pending-detached");
  assert.equal(result.inventoryComplete, true);
  assert.deepEqual(result.instances, []);
  assert.deepEqual(result.environmentReferences, []);
  assert.deepEqual(result.inspectedEnvironmentIds, ["e"]);
});

for (const [name, alter] of [
  [
    "unknown deletion",
    (f) => {
      f.args.receipt.outcome = "unknown";
    },
  ],
  [
    "missing acknowledgement",
    (f) => {
      delete f.args.receipt.response;
    },
  ],
  [
    "unsent deletion",
    (f) => {
      f.args.receipt.requestSent = false;
    },
  ],
  [
    "incomplete references",
    (f) => {
      f.volume.volumeInstances.pageInfo.hasNextPage = true;
    },
  ],
  [
    "remaining environment reference",
    (f) => {
      f.env.volumeInstances = [f.instance];
    },
  ],
])
  test(`unattached retained volume rejects ${name}`, async () => {
    const f = fixture();
    f.volume.volumeInstances.edges = [];
    f.env.volumeInstances = [];
    f.args.receipt.outcome = "acknowledged";
    f.args.receipt.response = true;
    alter(f);
    await assert.rejects(observeVolumeRetirement(f.args));
  });
for (const [name, alter] of [
  ["unsent intent", (f) => (f.args.receipt.requestSent = false)],
  ["still attached", (f) => (f.instance.serviceId = "service")],
  ["not pending", (f) => (f.instance.isPendingDeletion = false)],
  ["foreign environment", (f) => (f.instance.environmentId = "shared")],
  ["foreign mount", (f) => (f.instance.mountPath = "/other")],
  [
    "incomplete inventory",
    (f) => (f.volume.volumeInstances.pageInfo.hasNextPage = true),
  ],
  ["marker without instance", (f) => (f.volume.volumeInstances.edges = [])],
  ["refused", (f) => (f.args.receipt.outcome = "refused")],
  ["environment inventory disagreement", (f) => (f.env.volumeInstances = [])],
])
  test(`reject ${name}`, async () => {
    const f = fixture();
    alter(f);
    await assert.rejects(observeVolumeRetirement(f.args));
  });

for (const field of ["id", "projectId"])
  test(`reject mismatched environment detail ${field}`, async () => {
    const f = fixture();
    f.args.api.environment = async () => ({ ...f.env, [field]: "wrong" });
    await assert.rejects(observeVolumeRetirement(f.args));
  });
