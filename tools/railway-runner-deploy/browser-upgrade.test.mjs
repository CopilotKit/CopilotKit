import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STAGING } from "./contract.mjs";
import { binding, upgradeBrowser } from "./browser-upgrade.mjs";
const reviewed = JSON.parse(
  await readFile(new URL("./releases/browser-upgrade.json", import.meta.url)),
);
function fixture() {
  const intent = structuredClone(reviewed),
    calls = [],
    receipts = [];
  const recovery = {
    status: "watching",
    operationId: "old-owner",
    lifecycleRunId: "retained",
    runnerRunId: "failed",
    oldJournalSha256: "a".repeat(64),
    watches: intent.watches.map((w) => ({ ...w, providerFinality: "unknown" })),
  };
  intent.recoveryBindingSha256 = binding(recovery);
  const live = {
    runtimeIdentity: intent.baseline.runtimeIdentity,
    templateSha256: intent.targetTemplateSha256,
    recovery,
    volumeCreateRecovery: structuredClone(intent.volumeWatch),
    phase: "running",
    busy: false,
    active: null,
    blocked: false,
    operation: { operationId: intent.baselineOperationId, status: "resumed" },
  };
  let image = intent.baseline.image,
    removed = false,
    deployed = false,
    now = 0;
  const old = () => ({
    id: intent.removalBaseline.deploymentId,
    image: intent.baseline.image,
    status: removed ? "REMOVED" : "SUCCESS",
  });
  const current = () =>
    deployed
      ? { id: "new", image: intent.candidate.image, status: "SUCCESS" }
      : removed
        ? null
        : old();
  const provider = () => ({
    active: current(),
    latest: current() ?? old(),
    configuredImage: image,
    volumeId: STAGING.volumeId,
    volumeInstanceId: STAGING.volumeInstanceId,
    mountPath: "/data",
    isPendingDeletion: false,
  });
  const options = {
    intent,
    operationId: "new-operation",
    deadline: 10000,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    save: async (r) => receipts.push(r),
    verifyProvenance: async () => calls.push("provenance"),
    verifyReceipts: async () => calls.push("receipts"),
    setUpgrade: async (auth) => {
      calls.push("authorization");
      assert.equal(auth.removalProof.status, "REMOVED");
    },
    railway: {
      inspect: async () => provider(),
      readDeploymentStatus: async () => old(),
      handoffInventory: async () =>
        [old(), ...(deployed ? [current()] : [])].map((row) => ({
          ...row,
          deploymentStopped: false,
        })),
      removeDeployment: async () => {
        calls.push("remove");
        removed = true;
      },
      setImage: async (value) => {
        calls.push("image");
        image = value;
      },
      deploy: async () => {
        calls.push("deploy");
        deployed = true;
        live.runtimeIdentity = intent.candidate.runtimeIdentity;
        return "new";
      },
      deployment: async () => ({ status: "SUCCESS" }),
    },
    runner: {
      get: async () => structuredClone(live),
      probe: async () => structuredClone(live),
      drain: async ({ operationId, targetIdentity }) => {
        calls.push("drain");
        assert.deepEqual(targetIdentity, intent.baseline.runtimeIdentity);
        live.phase = "drained";
        live.operation = { operationId, status: "drained" };
      },
      resume: async () => {
        calls.push("resume");
        live.phase = "running";
        live.operation.status = "resumed";
      },
    },
  };
  return { options, live, calls, receipts };
}
test("reviewed browser upgrade drains same image, proves removal and preserves watches before resume", async () => {
  const f = fixture();
  const result = await upgradeBrowser(f.options);
  assert.equal(result.finalState.verified, true);
  assert.equal(result.outcome, "deployed");
  assert.deepEqual(
    f.calls.filter((c) => c !== "receipts"),
    [
      "provenance",
      "drain",
      "remove",
      "authorization",
      "image",
      "deploy",
      "resume",
    ],
  );
  assert.equal(f.calls.filter((c) => c === "receipts").length, 4);
  assert.ok(
    f.receipts.find(
      (r) => r.stage === "removal-requested" && r.removalOutcome === "unknown",
    ),
  );
});
for (const defect of [
  "busy",
  "blocked",
  "watch",
  "volume-watch",
  "template",
  "baseline",
])
  test(`refuses ${defect} before a live transition`, async () => {
    const f = fixture();
    if (defect === "busy" || defect === "blocked") f.live[defect] = true;
    if (defect === "watch")
      f.live.recovery.watches[0].originalStatus = "passed";
    if (defect === "volume-watch")
      f.live.volumeCreateRecovery.bindingSha256 = "bad";
    if (defect === "template") f.live.templateSha256 = "bad";
    if (defect === "baseline")
      f.live.runtimeIdentity = f.options.intent.candidate.runtimeIdentity;
    await assert.rejects(upgradeBrowser(f.options));
    assert.deepEqual(f.calls, ["provenance"]);
  });
test("unknown removal is never resent and cannot configure without independent removal", async () => {
  const f = fixture();
  f.options.railway.removeDeployment = async () => {
    f.calls.push("remove");
    throw Error("lost response");
  };
  await assert.rejects(upgradeBrowser(f.options));
  assert.equal(f.calls.filter((c) => c === "remove").length, 1);
  assert.ok(!f.calls.includes("image"));
  assert.ok(!f.calls.includes("resume"));
});
test("lost removal response may proceed only after independent exact removal proof", async () => {
  const f = fixture(),
    remove = f.options.railway.removeDeployment;
  f.options.railway.removeDeployment = async () => {
    await remove();
    throw Error("lost response");
  };
  const result = await upgradeBrowser(f.options);
  assert.equal(result.removalOutcome, "unknown");
  assert.equal(result.finalState.verified, true);
});
test("candidate watch drift never resumes or rolls back", async () => {
  const f = fixture(),
    deploy = f.options.railway.deploy;
  f.options.railway.deploy = async () => {
    const id = await deploy();
    f.live.recovery.watches[0].oldJournalSha256 = "bad";
    return id;
  };
  await assert.rejects(upgradeBrowser(f.options));
  assert.ok(!f.calls.includes("resume"));
  assert.equal(f.calls.filter((c) => c === "deploy").length, 1);
});
test("lost candidate response remains fenced without a second deployment", async () => {
  const f = fixture();
  f.options.railway.deploy = async () => {
    f.calls.push("deploy");
    throw Error("lost response");
  };
  await assert.rejects(upgradeBrowser(f.options));
  assert.equal(f.calls.filter((c) => c === "deploy").length, 1);
  assert.ok(!f.calls.includes("resume"));
  assert.equal(f.receipts.at(-1).stage, "failed-at-candidate-requested");
});
test("provider volume change after replacement fails final verification", async () => {
  const f = fixture(),
    inspect = f.options.railway.inspect;
  f.options.railway.inspect = async () => {
    const value = await inspect();
    if (f.calls.includes("deploy")) value.volumeInstanceId = "other";
    return value;
  };
  await assert.rejects(upgradeBrowser(f.options));
  assert.equal(f.receipts.at(-1).finalState.verified, false);
  assert.ok(!f.calls.includes("resume"));
});

for (const stage of ["before-resume", "after-resume"])
  test(`complete inventory rejects queued competitor ${stage}`, async () => {
    const f = fixture(),
      inventory = f.options.railway.handoffInventory;
    f.options.railway.handoffInventory = async () => {
      const rows = await inventory();
      if (f.calls.includes(stage === "before-resume" ? "deploy" : "resume"))
        rows.push({
          id: "competitor",
          status: "QUEUED",
          image: f.options.intent.candidate.image,
        });
      return rows;
    };
    await assert.rejects(upgradeBrowser(f.options), /Competing deployment/);
    assert.equal(f.receipts.at(-1).finalState.verified, false);
    if (stage === "before-resume") assert.ok(!f.calls.includes("resume"));
  });

for (const field of [
  "configuredImage",
  "latest",
  "volumeId",
  "volumeInstanceId",
  "mountPath",
  "isPendingDeletion",
]) {
  test(`provider ${field} drift after drain prevents removal`, async () => {
    const f = fixture();
    const inspect = f.options.railway.inspect;
    let inspections = 0;
    f.options.railway.inspect = async () => {
      const value = await inspect();
      if (++inspections === 2) {
        value[field] =
          field === "latest"
            ? { ...value.latest, id: "competitor" }
            : field === "isPendingDeletion"
              ? true
              : "changed";
      }
      return value;
    };
    await assert.rejects(upgradeBrowser(f.options));
    assert.ok(f.calls.includes("drain"));
    for (const mutation of [
      "remove",
      "authorization",
      "image",
      "deploy",
      "resume",
    ])
      assert.equal(f.calls.includes(mutation), false, mutation);
  });
}
