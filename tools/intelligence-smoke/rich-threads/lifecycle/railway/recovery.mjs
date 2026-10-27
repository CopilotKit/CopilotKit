import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { railwayApi } from "./api.mjs";
import { authority, durableJson, release } from "./journal.mjs";
import { ownerAlive, processOwner } from "./process-owner.mjs";
import { recoverSupervisor } from "./supervisor.mjs";
import { policy } from "./contract.mts";
import {
  optionalMetadata,
  sameIdentity,
  templateDigest,
  validateIdentity,
  recoveryTemplate,
  validateWatchingDeployment,
} from "./runner/deployment.mjs";

export const recoveryCase = Object.freeze({
  projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
  runnerRunId: "run-7d05705a-0b83-4cdb-9d32-9f054ae24d11",
  lifecycleRunId: "rich-f091f87b-e90b-4dd1-bef2-6ae873a774a3",
  name: "rich-rich-f091f87b-e90b-4dd1-bef2-6ae873a774a3-f737c3a0-source",
  startedAt: "2026-10-16T13:32:39.203Z",
  baselineRevision: "1c9f51ca5d3180079e5a43369a3bb7573d46d806",
});
export const recoveryDecision =
  "They need to make a new request. When they receive response of whatever, they use CLI to verify that the env is there.";
export function intentBinding(intent) {
  return {
    serial: intent.serial,
    kind: intent.kind,
    name: intent.name,
    startedAt: intent.startedAt,
    beforeIds: intent.beforeIds,
  };
}
function validateAuthorization(value, config) {
  assert.equal(value.version, 1);
  assert.equal(value.kind, "bounded-environment-retry");
  assert.match(value.operationId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
  for (const key of ["projectId", "runnerRunId", "lifecycleRunId"])
    assert.equal(value[key], recoveryCase[key]);
  assert.equal(config.projectId, recoveryCase.projectId);
  assert.equal(config.projectId, policy.projectId);
  validateIdentity(value.baselineIdentity);
  validateIdentity(value.targetIdentity);
  assert.equal(
    value.baselineIdentity.sourceRevision,
    recoveryCase.baselineRevision,
  );
  assert.equal(
    value.targetIdentity.policySha256,
    value.baselineIdentity.policySha256,
  );
  assert.equal(value.templateSha256, templateDigest(config));
  assert.deepEqual(value.permanentRunner, config.permanentRunner);
  for (const key of ["projectId", "environmentId", "serviceId", "volumeId"])
    assert.ok(
      typeof value.permanentRunner[key] === "string" &&
        value.permanentRunner[key].length,
    );
  assert.equal(
    value.permanentRunner.environmentId,
    "8edfef02-ea09-4a20-8689-261f21cc2849",
  );
  assert.equal(
    value.permanentRunner.serviceId,
    "4922b45b-6981-4559-be2f-fbbca9123323",
  );
  assert.match(value.intentSha256, /^[a-f0-9]{64}$/);
  assert.match(value.leaseSha256, /^[a-f0-9]{64}$/);
  assert.equal(value.decision?.reference, "ran-2026-10-16-bounded-cli-retry");
  assert.equal(value.decision.text, recoveryDecision);
}
function validateJournal(journal, authorization) {
  assert.equal(journal.version, 1);
  assert.equal(journal.provider, "railway");
  assert.equal(journal.purpose, "acceptance");
  assert.equal(journal.runId, authorization.lifecycleRunId);
  assert.equal(journal.projectId, authorization.projectId);
  assert.equal(templateDigest(journal.lease), authorization.leaseSha256);
  assert.equal(journal.lease.runId, journal.runId);
  assert.equal(
    journal.intents.length,
    1,
    "Only the exact original source intent is recoverable",
  );
  const intent = journal.intents[0];
  assert.equal(
    templateDigest(intentBinding(intent)),
    authorization.intentSha256,
  );
  assert.equal(intent.serial, 0);
  assert.equal(intent.kind, "createEnvironment");
  assert.equal(intent.name, recoveryCase.name);
  assert.equal(intent.startedAt, recoveryCase.startedAt);
  assert.equal(intent.scope, undefined);
  assert.equal(intent.resultId, undefined);
  assert.equal(intent.status, "pending");
  assert.deepEqual(
    [...intent.beforeIds].sort(),
    [
      "8edfef02-ea09-4a20-8689-261f21cc2849",
      "b14919f4-6417-429f-848d-c6ae2201e04f",
    ].sort(),
  );
  for (const key of [
    "environments",
    "services",
    "volumes",
    "domains",
    "proxies",
  ])
    assert.deepEqual(
      journal[key] ?? [],
      [],
      "Recovery cannot transfer other owned resources",
    );
  assert.equal(journal.environmentId, undefined);
  assert.ok(
    Number.isFinite(Date.parse(journal.expiresAt)) &&
      Date.parse(journal.expiresAt) < Date.now(),
    "Original attempt must remain overdue",
  );
}
const statePath = (root) => join(root, "recovery.json");
export async function assertOwnersStopped(
  root,
  config,
  journal,
  alive,
  allowCurrentScheduler = false,
) {
  assert.ok(!(await alive(journal.lease)), "Original controller still alive");
  for (const path of [
    join(root, "scheduler-lock/owner.json"),
    join(config.controlDirectory, "supervisor-lock/owner.json"),
  ]) {
    const owner = await optionalMetadata(path);
    // The current scheduler owns its lock after startup. Never accept a live old owner.
    if (owner) {
      const currentScheduler =
        allowCurrentScheduler &&
        path === join(root, "scheduler-lock/owner.json") &&
        owner.pid === process.pid &&
        templateDigest({
          pid: owner.pid,
          bootId: owner.bootId,
          startTicks: owner.startTicks,
        }) === templateDigest(await processOwner());
      if (!currentScheduler)
        assert.ok(
          !(await alive(owner)),
          "Original runner or supervisor still alive",
        );
    }
  }
}
/** One-time compatibility bridge, authorized by a reviewed release, never by inventory absence. */
export async function prepareRetainedRecovery(
  { root, config, runtimeIdentity, metadata, operation, authorization },
  dependencies = {},
) {
  if (
    authorization?.version === 2 ||
    (await optionalMetadata(join(root, "recovery-v2.json")))
  ) {
    const { prepareRepeatedRecovery } = await import("./recovery-v2.mjs");
    return prepareRepeatedRecovery(
      { root, config, runtimeIdentity, metadata, operation, authorization },
      dependencies,
    );
  }
  await authority(config.controlDirectory);
  const prior = await optionalMetadata(statePath(root));
  authorization ??= prior?.authorization;
  assert.ok(authorization, "Reviewed recovery authorization required");
  validateAuthorization(authorization, await recoveryTemplate(root, config));
  if (prior?.status === "watching" && operation?.recoveryBindingSha256) {
    const historical = await recoveryTemplate(root, config);
    validateAuthorization(authorization, historical);
    assert.equal(
      templateDigest(prior.authorization),
      templateDigest(authorization),
    );
    await loadState(root, historical);
    validateWatchingDeployment(prior, operation, runtimeIdentity, config);
    await assertOwnersStopped(
      root,
      historical,
      prior.originalJournal,
      dependencies.ownerAlive ?? ownerAlive,
    );
    return prior;
  }
  assert.ok(
    sameIdentity(runtimeIdentity, authorization.targetIdentity),
    "Recovery target identity mismatch",
  );
  assert.equal(
    operation?.operationId,
    authorization.operationId,
    "Recovery owner mismatch",
  );
  assert.equal(operation.templateSha256, authorization.templateSha256);
  assert.ok(
    sameIdentity(operation.baselineIdentity, authorization.baselineIdentity),
  );
  assert.ok(
    metadata &&
      (sameIdentity(metadata.runtimeIdentity, authorization.baselineIdentity) ||
        (prior &&
          sameIdentity(
            metadata.runtimeIdentity,
            authorization.targetIdentity,
          ))),
  );
  if (prior) {
    assert.equal(
      templateDigest(prior.authorization),
      templateDigest(authorization),
      "Recovery authorization changed",
    );
    assert.ok(["prepared", "watching"].includes(prior.status));
    validateJournal(prior.originalJournal, authorization);
    assert.equal(templateDigest(prior.originalJournal), prior.oldJournalSha256);
    assert.ok(
      ["draining", "recovery-ready", "resumed"].includes(operation.status),
    );
    return prior;
  }
  assert.equal(
    operation.status,
    "draining",
    "Legacy recovery requires a durable closed admission fence",
  );
  assert.ok(
    sameIdentity(operation.targetIdentity, authorization.baselineIdentity),
    "Legacy fence must target the same image",
  );
  const journal = await optionalMetadata(
    join(config.controlDirectory, authorization.lifecycleRunId, "journal.json"),
  );
  validateJournal(journal, authorization);
  const lease = await optionalMetadata(
    join(config.controlDirectory, "active-run/lease.json"),
  );
  assert.equal(templateDigest(lease), authorization.leaseSha256);
  const scheduler = await optionalMetadata(join(root, "scheduler.json"));
  assert.equal(scheduler.active, authorization.runnerRunId);
  assert.equal(scheduler.blocked, true);
  const receipt = await optionalMetadata(
    join(root, "results", authorization.runnerRunId, "run.json"),
  );
  assert.equal(receipt.id, authorization.runnerRunId);
  assert.equal(receipt.status, "failed");
  const initialized = await optionalMetadata(join(root, "initialized.json"));
  assert.equal(initialized?.serviceId, config.permanentRunner.serviceId);
  assert.equal(initialized?.volumeId, config.permanentRunner.volumeId);
  await assertOwnersStopped(
    root,
    config,
    journal,
    dependencies.ownerAlive ?? ownerAlive,
  );
  const state = {
    version: 1,
    authorization,
    status: "prepared",
    originalJournal: journal,
    oldJournalSha256: templateDigest(journal),
    originalReceipt: receipt,
    originalReceiptSha256: templateDigest(receipt),
    preparedAt: new Date().toISOString(),
    observationCount: 0,
    cleanupEvents: [],
    providerFinality: "unknown",
  };
  await durableJson(statePath(root), state);
  return state;
}
export async function loadState(root, config) {
  config = await recoveryTemplate(root, config);
  const state = await optionalMetadata(statePath(root));
  if (!state) return null;
  assert.equal(state.version, 1, "Invalid original recovery version");
  validateAuthorization(state.authorization, config);
  validateJournal(state.originalJournal, state.authorization);
  assert.equal(templateDigest(state.originalJournal), state.oldJournalSha256);
  assert.equal(
    templateDigest(state.originalReceipt),
    state.originalReceiptSha256,
  );
  const journal = JSON.parse(
    await readFile(
      join(
        config.controlDirectory,
        state.authorization.lifecycleRunId,
        "journal.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    templateDigest(journal),
    state.oldJournalSha256,
    "Retained original journal changed",
  );
  return state;
}
export async function inspectWatch(root, config, state, dependencies) {
  const api =
    dependencies.api ??
    railwayApi({
      diagnosticDirectory: join(
        config.controlDirectory,
        "provider-diagnostics",
      ),
    });
  const pause = dependencies.delay ?? delay;
  const intent = state.originalJournal.intents[state.version === 2 ? 1 : 0];
  const save = () =>
    durableJson(
      state.version === 2 ? join(root, "recovery-v2.json") : statePath(root),
      state,
    );
  async function inventory() {
    const values = await api.list("environments", config.projectId);
    assert.ok(Array.isArray(values));
    assert.equal(new Set(values.map((v) => v.id)).size, values.length);
    for (const value of values) {
      assert.ok(
        typeof value.id === "string" &&
          value.id.length &&
          typeof value.name === "string",
      );
      assert.equal(value.projectId, config.projectId);
    }
    const evidence = {
      at: new Date().toISOString(),
      complete: true,
      environments: values.map(
        ({ id, name, projectId, createdAt, sourceEnvironment }) => ({
          id,
          name,
          projectId,
          createdAt,
          sourceEnvironment,
        }),
      ),
      sha256: templateDigest(values),
    };
    state.lastInventory = evidence;
    state.initialInventory ??= evidence;
    state.observationCount++;
    await save();
    return values;
  }
  const currentInventory = await inventory();
  for (const event of state.cleanupEvents) {
    if (
      event.status === "deleting" &&
      !currentInventory.some(
        (value) => value.id === event.id || value.name === intent.name,
      )
    ) {
      event.status = "absence-verified";
      event.response ??= "unknown-after-interruption";
      event.verifiedAt = new Date().toISOString();
    }
  }
  await save();
  const knownIds = new Set(state.cleanupEvents.map((event) => event.id));
  const matches = currentInventory.filter(
    (value) => value.name === intent.name || knownIds.has(value.id),
  );
  assert.ok(
    matches.length <= 1,
    "Multiple old-name environments require reconciliation",
  );
  for (const value of matches) {
    assert.equal(value.name, intent.name, "Retained resource identity changed");
    assert.ok(
      !intent.beforeIds.includes(value.id) &&
        !policy.forbiddenEnvironmentIds.includes(value.id),
    );
    assert.ok(!Object.values(config.permanentRunner).includes(value.id));
    assert.ok(
      Number.isFinite(Date.parse(value.createdAt)) &&
        Date.parse(value.createdAt) >= Date.parse(intent.startedAt) - 1000,
    );
    assert.equal(value.sourceEnvironment?.id ?? null, intent.scope ?? null);
    const observed = await api.environment(value.id);
    for (const key of ["id", "name", "projectId", "createdAt"])
      assert.equal(observed[key], value[key]);
    assert.equal(observed.isEphemeral, true);
    assert.equal(observed.sourceEnvironment?.id ?? null, intent.scope ?? null);
    assert.deepEqual(
      observed.serviceInstances,
      [],
      "Old source environment is not empty",
    );
    assert.deepEqual(
      observed.volumeInstances,
      [],
      "Old source environment contains storage",
    );
    assert.ok(
      state.cleanupEvents.length < 64,
      "Retained cleanup evidence bound exceeded",
    );
    const event = {
      id: value.id,
      name: value.name,
      createdAt: value.createdAt,
      status: "deleting",
      at: new Date().toISOString(),
    };
    state.cleanupEvents.push(event);
    await save();
    try {
      await api.request("deleteEnvironment", { id: value.id });
      event.response = "returned";
    } catch {
      // A lost delete response is reconciled by complete inventory, never assumed successful.
      event.response = "failed-or-lost";
    }
    await save();
    let absent = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const after = await inventory();
      if (
        !after.some(
          (item) =>
            item.id === value.id ||
            item.name === intent.name ||
            knownIds.has(item.id),
        )
      ) {
        absent = true;
        break;
      }
      if (attempt < 2) await pause(1000);
    }
    assert.ok(absent, "Retained environment deletion not verified");
    event.status = "absence-verified";
    event.verifiedAt = new Date().toISOString();
    await save();
  }
  state.lastVerifiedAt = new Date().toISOString();
  state.providerFinality = "unknown";
  await save();
}
export async function finishTransfer(root, config, state, dependencies) {
  const lease = await optionalMetadata(
    join(config.controlDirectory, "active-run/lease.json"),
  );
  if (lease?.runId === state.authorization.lifecycleRunId) {
    assert.equal(templateDigest(lease), state.authorization.leaseSha256);
    assert.ok(
      !(await (dependencies.ownerAlive ?? ownerAlive)(lease)),
      "Original controller still alive",
    );
    await release(config.controlDirectory, lease);
  }
  const supervisor = await optionalMetadata(
    join(config.controlDirectory, "supervisor-lock/owner.json"),
  );
  if (
    supervisor &&
    !(await optionalMetadata(
      join(config.controlDirectory, "active-run/lease.json"),
    ))
  ) {
    // Normal supervisor recovery verifies process death and owns lock retirement.
    await (dependencies.recoverSupervisor ?? recoverSupervisor)(config);
  }
  await durableJson(
    join(root, "results", state.authorization.runnerRunId, "run.json"),
    {
      ...state.originalReceipt,
      status: "failed",
      cleanup: "retained-watch",
      deadlineExceeded:
        state.version === 2
          ? Date.parse(state.originalJournal.expiresAt) < Date.now()
          : true,
      recovery: {
        operationId: state.authorization.operationId,
        lifecycleRunId: state.authorization.lifecycleRunId,
        oldJournalSha256: state.oldJournalSha256,
        intentSha256: state.authorization.intentSha256,
        status: "watching",
        providerFinality: "unknown",
      },
    },
  );
}
/** Transfer exactly one authorized unresolved source intent; never create or erase evidence. */
export async function recoverRetainedIntent(
  { root, config, operationId, runtimeIdentity },
  dependencies = {},
) {
  if (await optionalMetadata(join(root, "recovery-v2.json"))) {
    const { recoverRepeatedIntent } = await import("./recovery-v2.mjs");
    return recoverRepeatedIntent(
      { root, config, operationId, runtimeIdentity },
      dependencies,
    );
  }
  const state = await loadState(root, config);
  assert.ok(state);
  assert.equal(state.authorization.operationId, operationId);
  assert.ok(sameIdentity(state.authorization.targetIdentity, runtimeIdentity));
  assert.ok(["prepared", "watching"].includes(state.status));
  await assertOwnersStopped(
    root,
    config,
    state.originalJournal,
    dependencies.ownerAlive ?? ownerAlive,
    true,
  );
  await inspectWatch(root, config, state, dependencies);
  state.status = "watching";
  state.activatedAt ??= new Date().toISOString();
  await durableJson(statePath(root), state); // Durable ownership always precedes lease release.
  await finishTransfer(root, config, state, dependencies);
  return recoveryReceipt(state);
}
export function recoveryReceipt(state) {
  if (!state) return null;
  const receipt = {
    status: state.status,
    operationId: state.authorization.operationId,
    lifecycleRunId: state.authorization.lifecycleRunId,
    runnerRunId: state.authorization.runnerRunId,
    oldJournalSha256: state.oldJournalSha256,
    watchSha256: templateDigest(state),
    lastVerifiedAt: state.lastVerifiedAt,
    observationCount: state.observationCount,
    providerFinality: "unknown",
    originalStatus: "failed",
    deadlineExceeded:
      state.version === 2
        ? Date.parse(state.originalJournal.expiresAt) < Date.now()
        : true,
  };
  return state.version === 2
    ? {
        ...receipt,
        retainedSourceEnvironmentId: state.retainedSourceEnvironmentId,
        originalWatchSnapshotSha256: templateDigest(state.originalWatch),
        authorizationSha256: templateDigest(state.authorization),
        journalBindingSha256: state.authorization.journalSha256,
        originalReceiptSha256: state.originalReceiptSha256,
        watches: [
          ...(state.watches ?? [recoveryReceipt(state.originalWatch)]),
          receipt,
        ],
      }
    : receipt;
}
/** Called while scheduler is serialized: before admission, after a run, and on idle ticks. */
export async function reconcileRetainedIntent(
  { root, config },
  dependencies = {},
) {
  if (await optionalMetadata(join(root, "recovery-v2.json"))) {
    const { reconcileRepeatedIntent } = await import("./recovery-v2.mjs");
    return reconcileRepeatedIntent({ root, config }, dependencies);
  }
  const state = await loadState(root, config);
  if (!state) return null;
  assert.equal(
    state.status,
    "watching",
    "Explicit retained-intent recovery required",
  );
  await inspectWatch(root, config, state, dependencies);
  await finishTransfer(root, config, state, dependencies);
  return state.authorization.lifecycleRunId;
}

export async function effectiveRecovery(root) {
  return (
    (await optionalMetadata(join(root, "recovery-v2.json"))) ??
    (await optionalMetadata(statePath(root)))
  );
}
export function retainedRunIds(state) {
  return state
    ? [
        ...(state.version === 2
          ? [state.originalWatch.authorization.lifecycleRunId]
          : []),
        state.authorization.lifecycleRunId,
      ]
    : [];
}
