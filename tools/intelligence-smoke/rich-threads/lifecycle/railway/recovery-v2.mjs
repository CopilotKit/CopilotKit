import assert from "node:assert/strict";
import { join } from "node:path";
import { authority, durableJson } from "./journal.mjs";
import { railwayApi } from "./api.mjs";
import { ownerAlive } from "./process-owner.mjs";
import {
  optionalMetadata,
  templateDigest,
  sameIdentity,
  validateIdentity,
} from "./runner/deployment.mjs";
import {
  loadState,
  inspectWatch,
  finishTransfer,
  assertOwnersStopped,
  recoveryReceipt,
  recoveryDecision,
} from "./recovery.mjs";

export const repeatedCase = Object.freeze({
  projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
  runnerRunId: "run-7d2602d4-8b10-40b9-aaff-3c6a0029afad",
  lifecycleRunId: "rich-f6c38ef4-145e-44d0-8075-1e56e5818fe5",
  sourceEnvironmentId: "f15bc318-d863-4d1d-9717-74d2aeaed0c8",
  baselineRevision: "d979e36a7950633baf557b22003f82c8dfaf865d",
  deploymentId: "41d9b023-1870-444f-8889-c369e26faa54",
  imageDigest:
    "sha256:8db845b5d2b427317524254ff58b3e18db69046b9e75d950b6dc967c004a0019",
  volumeInstanceId: "f3187181-2fb7-4d3e-a9dc-c80eac894895",
});
const statePath = (root) => join(root, "recovery-v2.json");
export function repeatedIntentBinding(intent) {
  return Object.fromEntries(
    [
      "serial",
      "kind",
      "name",
      "scope",
      "startedAt",
      "beforeIds",
      "status",
      "resultId",
    ]
      .filter((key) => intent[key] !== undefined)
      .map((key) => [key, intent[key]]),
  );
}
export function journalBinding(journal) {
  return {
    ...Object.fromEntries(
      [
        "version",
        "provider",
        "purpose",
        "runId",
        "projectId",
        "lease",
        "startedAt",
        "expiresAt",
        "environmentName",
        "environments",
        "services",
        "volumes",
        "domains",
        "proxies",
      ].map((key) => [key, journal[key]]),
    ),
    intents: journal.intents.map(repeatedIntentBinding),
  };
}
export function originalWatchBinding(state) {
  const auth = state.authorization ?? state;
  return {
    operationId: auth.operationId,
    lifecycleRunId: auth.lifecycleRunId,
    runnerRunId: auth.runnerRunId,
    oldJournalSha256: state.oldJournalSha256,
  };
}
export function deploymentOperationBinding(value) {
  const operation = value.operation ?? value;
  return Object.fromEntries(
    [
      "version",
      "kind",
      "operationId",
      "baselineIdentity",
      "targetIdentity",
      "templateSha256",
      "status",
    ].map((key) => [key, operation[key]]),
  );
}

function validateAuth(auth, config) {
  assert.equal(auth.version, 2);
  assert.equal(auth.kind, "bounded-environment-retry");
  assert.match(auth.operationId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
  for (const key of [
    "projectId",
    "runnerRunId",
    "lifecycleRunId",
    "sourceEnvironmentId",
  ])
    assert.equal(auth[key], repeatedCase[key]);
  assert.equal(config.projectId, repeatedCase.projectId);
  assert.deepEqual(auth.permanentRunner, config.permanentRunner);
  assert.equal(
    auth.permanentRunner.volumeId,
    "2a70e47d-85d4-4a8a-b17b-b6788c91b1c7",
  );
  assert.equal(
    auth.permanentRunner.serviceId,
    "4922b45b-6981-4559-be2f-fbbca9123323",
  );
  assert.equal(
    auth.permanentRunner.environmentId,
    "8edfef02-ea09-4a20-8689-261f21cc2849",
  );
  assert.equal(auth.permanentRunner.projectId, config.projectId);
  validateIdentity(auth.baselineIdentity);
  validateIdentity(auth.targetIdentity);
  assert.equal(
    auth.baselineIdentity.sourceRevision,
    repeatedCase.baselineRevision,
  );
  assert.equal(
    auth.baselineIdentity.policySha256,
    auth.targetIdentity.policySha256,
  );
  assert.equal(auth.templateSha256, templateDigest(config));
  for (const key of [
    "journalSha256",
    "intentSha256",
    "leaseSha256",
    "originalWatchSha256",
    "deploymentOperationSha256",
  ])
    assert.match(auth[key], /^[a-f0-9]{64}$/);
  assert.deepEqual(auth.providerHandoff, {
    deploymentId: repeatedCase.deploymentId,
    imageDigest: repeatedCase.imageDigest,
    volumeInstanceId: repeatedCase.volumeInstanceId,
    deploymentStopped: true,
  });
  assert.equal(
    auth.decision.reference,
    "ran-2026-10-19-second-incident-recovery",
  );
  assert.equal(auth.decision.text, recoveryDecision);
}
function validateJournal(journal, auth) {
  assert.equal(templateDigest(journalBinding(journal)), auth.journalSha256);
  assert.equal(journal.version, 1);
  assert.equal(journal.provider, "railway");
  assert.equal(journal.purpose, "acceptance");
  assert.equal(journal.runId, auth.lifecycleRunId);
  assert.equal(journal.projectId, auth.projectId);
  assert.equal(templateDigest(journal.lease), auth.leaseSha256);
  assert.equal(journal.lease.runId, journal.runId);
  assert.equal(journal.intents.length, 2);
  const [source, fork] = journal.intents;
  assert.equal(source.serial, 0);
  assert.equal(source.kind, "createEnvironment");
  assert.equal(source.status, "recorded");
  assert.equal(source.resultId, auth.sourceEnvironmentId);
  assert.equal(source.scope, undefined);
  assert.equal(source.name, "rich-a9163c157392637bb12-source");
  assert.equal(templateDigest(repeatedIntentBinding(fork)), auth.intentSha256);
  assert.equal(fork.serial, 1);
  assert.equal(fork.kind, "createEnvironment");
  assert.equal(fork.status, "pending");
  assert.equal(fork.resultId, undefined);
  assert.equal(fork.name, "rich-a9163c157392637bb12");
  assert.equal(fork.startedAt, "2026-10-19T10:39:48.745Z");
  assert.equal(fork.scope, auth.sourceEnvironmentId);
  const protectedIds = [
    "8edfef02-ea09-4a20-8689-261f21cc2849",
    "b14919f4-6417-429f-848d-c6ae2201e04f",
  ];
  assert.deepEqual([...source.beforeIds].sort(), protectedIds.sort());
  assert.deepEqual(
    [...fork.beforeIds].sort(),
    [...protectedIds, auth.sourceEnvironmentId].sort(),
  );
  assert.equal(journal.environments.length, 1);
  assert.equal(journal.environments[0].id, auth.sourceEnvironmentId);
  assert.equal(journal.environments[0].name, source.name);
  assert.equal(journal.environments[0].projectId, auth.projectId);
  assert.equal(journal.environments[0].isEphemeral, true);
  assert.equal(journal.environments[0].sourceEnvironment, null);
  for (const key of ["services", "volumes", "domains", "proxies"])
    assert.deepEqual(journal[key], []);
  assert.deepEqual(journal.restarts ?? [], []);
  assert.equal(journal.environmentId, undefined);
  assert.ok(Number.isFinite(Date.parse(journal.expiresAt)));
}
async function validated(root, config, state) {
  assert.equal(state.version, 2, "Invalid repeated recovery version");
  assert.equal(
    state.originalWatch.version,
    1,
    "Invalid original watch snapshot version",
  );
  validateAuth(state.authorization, config);
  validateJournal(state.originalJournal, state.authorization);
  assert.equal(templateDigest(state.originalJournal), state.oldJournalSha256);
  assert.equal(
    templateDigest(state.originalReceipt),
    state.originalReceiptSha256,
  );
  assert.equal(state.originalReceipt.id, state.authorization.runnerRunId);
  assert.equal(state.originalReceipt.status, "failed");
  assert.equal(
    templateDigest(originalWatchBinding(state.originalWatch)),
    state.authorization.originalWatchSha256,
  );
  assert.equal(state.originalWatch.status, "watching");
  const first = await loadState(root, config);
  assert.ok(first);
  // Mutable observations may advance; ownership and immutable evidence may not.
  for (const key of [
    "authorization",
    "originalJournal",
    "oldJournalSha256",
    "originalReceipt",
    "originalReceiptSha256",
  ])
    assert.equal(
      templateDigest(first[key]),
      templateDigest(state.originalWatch[key]),
    );
  assert.equal(first.status, "watching");
  const current = await optionalMetadata(
    join(
      config.controlDirectory,
      state.authorization.lifecycleRunId,
      "journal.json",
    ),
  );
  assert.equal(
    templateDigest(current),
    state.oldJournalSha256,
    "Second retained journal changed",
  );
  assert.ok(["prepared", "watching"].includes(state.status));
  return first;
}
/** Reviewed stopped-provider handoff. No live mutation or provider-finality inference. */
export async function prepareRepeatedRecovery(
  { root, config, runtimeIdentity, metadata, operation, authorization },
  dependencies = {},
) {
  await authority(config.controlDirectory);
  let state = await optionalMetadata(statePath(root));
  authorization ??= state?.authorization;
  validateAuth(authorization, config);
  assert.ok(sameIdentity(runtimeIdentity, authorization.targetIdentity));
  const initialized = await optionalMetadata(join(root, "initialized.json"));
  assert.equal(initialized?.serviceId, config.permanentRunner.serviceId);
  assert.equal(initialized?.volumeId, config.permanentRunner.volumeId);
  if (state) {
    assert.equal(
      templateDigest(state.authorization),
      templateDigest(authorization),
    );
    await validated(root, config, state);
    await assertOwnersStopped(
      root,
      config,
      state.originalJournal,
      dependencies.ownerAlive ?? ownerAlive,
    );
    assert.ok(
      sameIdentity(metadata.runtimeIdentity, authorization.baselineIdentity) ||
        sameIdentity(metadata.runtimeIdentity, authorization.targetIdentity),
    );
  } else {
    assert.ok(
      sameIdentity(metadata.runtimeIdentity, authorization.baselineIdentity),
    );
    assert.equal(
      templateDigest(deploymentOperationBinding(operation)),
      authorization.deploymentOperationSha256,
    );
    assert.equal(operation.status, "resumed");
    const first = await loadState(root, config);
    assert.equal(first?.status, "watching");
    assert.equal(
      templateDigest(originalWatchBinding(first)),
      authorization.originalWatchSha256,
    );
    const journal = await optionalMetadata(
      join(
        config.controlDirectory,
        authorization.lifecycleRunId,
        "journal.json",
      ),
    );
    validateJournal(journal, authorization);
    assert.equal(
      templateDigest(
        await optionalMetadata(
          join(config.controlDirectory, "active-run/lease.json"),
        ),
      ),
      authorization.leaseSha256,
    );
    const scheduler = await optionalMetadata(join(root, "scheduler.json"));
    assert.equal(scheduler.active, authorization.runnerRunId);
    assert.equal(scheduler.blocked, true);
    const receipt = await optionalMetadata(
      join(root, "results", authorization.runnerRunId, "run.json"),
    );
    assert.equal(receipt?.id, authorization.runnerRunId);
    assert.equal(receipt.status, "failed");
    await assertOwnersStopped(
      root,
      config,
      journal,
      dependencies.ownerAlive ?? ownerAlive,
    );
    state = {
      version: 2,
      authorization,
      status: "prepared",
      originalWatch: first,
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
  }
  // Crash after snapshot but before fence retries exactly this write. Never
  // replace another operation or reopen admission on startup.
  if (
    templateDigest(deploymentOperationBinding(operation)) ===
    authorization.deploymentOperationSha256
  ) {
    await durableJson(join(root, "deployment.json"), {
      version: 1,
      kind: authorization.kind,
      operationId: authorization.operationId,
      baselineIdentity: authorization.baselineIdentity,
      targetIdentity: authorization.targetIdentity,
      templateSha256: authorization.templateSha256,
      status: "draining",
    });
  } else {
    assert.equal(operation?.operationId, authorization.operationId);
    assert.equal(operation.kind, authorization.kind);
    assert.equal(operation.templateSha256, authorization.templateSha256);
    assert.ok(
      sameIdentity(operation.baselineIdentity, authorization.baselineIdentity),
    );
    assert.ok(
      sameIdentity(operation.targetIdentity, authorization.targetIdentity),
    );
    assert.ok(
      ["draining", "recovery-ready", "resumed"].includes(operation.status),
    );
    if (state.status === "prepared") assert.equal(operation.status, "draining");
  }
  return state;
}
async function inspectBoth(root, config, state, dependencies) {
  const first = await validated(root, config, state);
  const api =
    dependencies.api ??
    railwayApi({
      diagnosticDirectory: join(
        config.controlDirectory,
        "provider-diagnostics",
      ),
    });
  const source = await api.environment(state.authorization.sourceEnvironmentId);
  const saved = state.originalJournal.environments[0];
  for (const key of ["id", "name", "projectId", "createdAt", "isEphemeral"])
    assert.equal(source[key], saved[key], "Retained source identity changed");
  assert.equal(source.sourceEnvironment?.id ?? null, null);
  assert.deepEqual(
    source.serviceInstances,
    [],
    "Retained source must remain empty",
  );
  assert.deepEqual(
    source.volumeInstances,
    [],
    "Retained source must remain empty",
  );
  await inspectWatch(root, config, first, { ...dependencies, api });
  await inspectWatch(root, config, state, { ...dependencies, api });
  state.watches = [recoveryReceipt(first)];
  state.retainedSourceEnvironmentId = source.id;
  await durableJson(statePath(root), state);
}
export async function recoverRepeatedIntent(
  { root, config, operationId, runtimeIdentity },
  dependencies = {},
) {
  const state = await optionalMetadata(statePath(root));
  await validated(root, config, state);
  assert.equal(operationId, state.authorization.operationId);
  assert.ok(sameIdentity(runtimeIdentity, state.authorization.targetIdentity));
  await assertOwnersStopped(
    root,
    config,
    state.originalJournal,
    dependencies.ownerAlive ?? ownerAlive,
    true,
  );
  const lease = await optionalMetadata(
    join(config.controlDirectory, "active-run/lease.json"),
  );
  if (lease)
    assert.equal(
      templateDigest(lease),
      state.authorization.leaseSha256,
      "Unexpected active lease",
    );
  await inspectBoth(root, config, state, dependencies);
  state.status = "watching";
  state.activatedAt ??= new Date().toISOString();
  await durableJson(statePath(root), state);
  await finishTransfer(root, config, state, dependencies);
  return recoveryReceipt(state);
}
export async function reconcileRepeatedIntent(
  { root, config },
  dependencies = {},
) {
  const state = await optionalMetadata(statePath(root));
  await validated(root, config, state);
  assert.equal(state.status, "watching", "Explicit second recovery required");
  await inspectBoth(root, config, state, dependencies);
  await finishTransfer(root, config, state, dependencies);
  return state.authorization.lifecycleRunId;
}
