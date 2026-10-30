import assert from "node:assert/strict";
import test from "node:test";
import { STAGING } from "./contract.mjs";
import { verifyRemovedHandoff } from "./removal-handoff.mjs";
import { REMOVAL_HANDOFF_BASELINE } from "./adapters.mjs";

function fixture() {
  const baseline = { ...REMOVAL_HANDOFF_BASELINE };
  const row = {
    id: baseline.deploymentId,
    image: baseline.image,
    status: "REMOVED",
  };
  const provider = {
    active: null,
    latest: null,
    configuredImage: baseline.image,
    volumeId: STAGING.volumeId,
    volumeInstanceId: STAGING.volumeInstanceId,
    mountPath: STAGING.mountPath,
  };
  const rows = [row];
  const calls = [];
  const railway = {
    readDeploymentStatus: async (id) => {
      assert.equal(id, baseline.deploymentId);
      calls.push("baseline");
      return structuredClone(row);
    },
    handoffInventory: async () => {
      calls.push("inventory");
      return structuredClone(rows);
    },
    inspect: async (options) => {
      assert.deepEqual(options, {
        allowNoActive: true,
        allowMissingLatest: true,
      });
      calls.push("inspect");
      return structuredClone(provider);
    },
  };
  return {
    baseline,
    row,
    provider,
    rows,
    calls,
    railway,
    options: {
      railway,
      scope: STAGING,
      baseline,
      configuredImages: [baseline.image],
      clock: () => 0,
    },
  };
}

test("verified removal reads exact baseline, complete inventory and then fresh null-latest provider proof", async () => {
  const h = fixture();
  const result = await verifyRemovedHandoff(h.options);
  assert.deepEqual(h.calls, ["baseline", "inventory", "inspect"]);
  assert.deepEqual(result.provider, h.provider);
  assert.deepEqual(result.removalProof, {
    version: 1,
    method: "deploymentRemove",
    deploymentId: h.baseline.deploymentId,
    status: "REMOVED",
    image: h.baseline.image,
    projectId: STAGING.projectId,
    environmentId: STAGING.environmentId,
    serviceId: STAGING.serviceId,
    volumeId: STAGING.volumeId,
    volumeInstanceId: STAGING.volumeInstanceId,
    mountPath: STAGING.mountPath,
    observedAt: "1970-01-01T00:00:00.000Z",
  });
  h.provider.latest = { ...h.row };
  await verifyRemovedHandoff(h.options);
});

for (const defect of [
  "active",
  "latest-id",
  "latest-image",
  "latest-status",
  "baseline-id",
  "baseline-image",
  "baseline-status",
  "missing-baseline",
  "duplicate-baseline",
  "inventory-status",
  "inventory-image",
  "incomplete-inventory",
  "competitor",
  "configured-image",
  "volume",
  "attachment",
  "mount",
  "pending-delete",
])
  test(`removed handoff rejects ${defect}`, async () => {
    const h = fixture();
    if (defect.startsWith("latest-")) {
      h.provider.latest = { ...h.row };
      h.provider.latest[defect.slice(7) === "id" ? "id" : defect.slice(7)] =
        "other";
    }
    if (defect === "active") h.provider.active = { ...h.row };
    if (defect === "baseline-id")
      h.railway.readDeploymentStatus = async () => ({ ...h.row, id: "other" });
    if (defect === "baseline-image")
      h.railway.readDeploymentStatus = async () => ({
        ...h.row,
        image: "other",
      });
    if (defect === "baseline-status")
      h.railway.readDeploymentStatus = async () => ({
        ...h.row,
        status: "SUCCESS",
      });
    if (defect === "missing-baseline") h.rows.length = 0;
    if (defect === "duplicate-baseline") h.rows.push({ ...h.row });
    if (defect === "inventory-status") h.rows[0].status = "SUCCESS";
    if (defect === "inventory-image") h.rows[0].image = "other";
    if (defect === "incomplete-inventory")
      h.railway.handoffInventory = async () => null;
    if (defect === "competitor") h.rows.push({ id: "other", status: "QUEUED" });
    if (defect === "configured-image") h.provider.configuredImage = "other";
    if (defect === "volume") h.provider.volumeId = "other";
    if (defect === "attachment") h.provider.volumeInstanceId = "other";
    if (defect === "mount") h.provider.mountPath = "/other";
    if (defect === "pending-delete") h.provider.isPendingDeletion = true;
    await assert.rejects(verifyRemovedHandoff(h.options));
  });

test("removed handoff inspects after inventory to reject a concurrent replacement", async () => {
  const h = fixture();
  const inventory = h.railway.handoffInventory;
  h.railway.handoffInventory = async () => {
    const rows = await inventory();
    h.provider.latest = {
      id: "competitor",
      status: "SUCCESS",
      image: h.baseline.image,
    };
    return rows;
  };
  await assert.rejects(verifyRemovedHandoff(h.options));
  assert.deepEqual(h.calls, ["baseline", "inventory", "inspect"]);
});

test("removal proof binds the explicit scope and retained volume", async () => {
  const h = fixture();
  const scope = Object.fromEntries(
    Object.entries(STAGING).map(([key, value]) => [key, `fixture-${value}`]),
  );
  for (const key of ["volumeId", "volumeInstanceId", "mountPath"])
    h.provider[key] = scope[key];
  const { removalProof } = await verifyRemovedHandoff({ ...h.options, scope });
  for (const key of [
    "projectId",
    "environmentId",
    "serviceId",
    "volumeId",
    "volumeInstanceId",
    "mountPath",
  ])
    assert.equal(removalProof[key], scope[key]);
});
