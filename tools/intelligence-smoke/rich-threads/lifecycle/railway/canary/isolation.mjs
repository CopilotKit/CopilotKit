import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { railwayApi } from "../api.mjs";
import { durableJson, recoveryLock } from "../journal.mjs";
import { optionalMetadata, templateDigest } from "../runner/deployment.mjs";

export const canaryWorkspaceId = "9cab81e9-4aa5-40cd-a484-3a585ca35c90";
const forbiddenProjectId = "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function validateScope(scope) {
  assert.deepEqual(
    Object.keys(scope).sort(),
    [
      "version",
      "purpose",
      "workspaceId",
      "projectId",
      "projectName",
      "lifetimeMs",
    ].sort(),
    "Unexpected scope fields",
  );
  assert.equal(scope.version, 1);
  assert.equal(scope.purpose, "pni605-isolation-canary");
  assert.equal(scope.workspaceId, canaryWorkspaceId);
  assert.match(scope.projectId, uuid);
  assert.notEqual(
    scope.projectId,
    forbiddenProjectId,
    "Shared project forbidden",
  );
  assert.match(scope.projectName, /^pni605-canary-[a-f0-9]{12}$/);
  assert.ok(
    Number.isInteger(scope.lifetimeMs) &&
      scope.lifetimeMs > 0 &&
      scope.lifetimeMs <= 600000,
  );
}
async function inventory(api, scope) {
  const [project, environments, services, volumes] = await Promise.all([
    api.request("canaryProject", { id: scope.projectId }),
    api.list("environments", scope.projectId),
    api.list("services", scope.projectId),
    api.list("volumes", scope.projectId),
  ]);
  assert.equal(project.id, scope.projectId);
  assert.equal(project.name, scope.projectName);
  assert.equal(project.workspaceId, scope.workspaceId);
  for (const list of [environments, services, volumes]) {
    assert.equal(new Set(list.map((value) => value.id)).size, list.length);
    for (const value of list) assert.equal(value.projectId, scope.projectId);
  }
  const details = [];
  for (const value of environments) {
    assert.ok(
      ![
        "8edfef02-ea09-4a20-8689-261f21cc2849",
        "b14919f4-6417-429f-848d-c6ae2201e04f",
      ].includes(value.id),
      "Protected environment forbidden",
    );
    const environment = await api.environment(value.id);
    assert.equal(environment.id, value.id);
    assert.equal(environment.projectId, scope.projectId);
    details.push(environment);
  }
  return { project, environments, services, volumes, details };
}
function assertEmpty(snapshot) {
  assert.deepEqual(
    snapshot.services,
    [],
    "Canary project must contain no services",
  );
  assert.deepEqual(
    snapshot.volumes,
    [],
    "Canary project must contain no volumes",
  );
  for (const environment of snapshot.details) {
    assert.deepEqual(environment.serviceInstances, []);
    assert.deepEqual(environment.volumeInstances, []);
  }
}
function assertNoWorkloads(snapshot) {
  assert.deepEqual(snapshot.volumes, []);
  for (const environment of snapshot.details) {
    assert.deepEqual(environment.volumeInstances, []);
    for (const instance of environment.serviceInstances) {
      assert.ok(
        !instance.source?.image && !instance.source?.repo,
        "Unexpected service source",
      );
      assert.equal(
        instance.latestDeployment ?? null,
        null,
        "Unexpected deployment",
      );
    }
  }
}
/** Read-only restart path. It never adopts an unknown create or retries a write. */
export async function inspectCanary({ root, api = railwayApi() }) {
  const journal = await optionalMetadata(join(root, "journal.json"));
  assert.ok(journal, "Canary journal missing");
  validateScope(journal.scope);
  return { journal, inventory: await inventory(api, journal.scope) };
}
/** Runs only in an exact reviewed, fresh disposable project. No project creation. */
export async function runCanary(args) {
  validateScope(args.scope);
  await mkdir(args.root, { mode: 0o700 });
  const unlock = await recoveryLock(join(args.root, "writer-lock"));
  try {
    return await runCanaryLocked(args);
  } finally {
    await unlock();
  }
}
async function runCanaryLocked({
  root,
  scope,
  api = railwayApi(),
  clock = Date.now,
}) {
  const startedAt = clock();
  const state = {
    version: 1,
    scope,
    runId: randomUUID(),
    startedAt,
    expiresAt: startedAt + scope.lifetimeMs,
    status: "preflight",
    intents: [],
    environments: [],
    services: [],
    observations: [],
  };
  const save = () => durableJson(join(root, "journal.json"), state);
  const observe = async () => {
    const snapshot = await inventory(api, scope);
    state.observations.push({
      at: clock(),
      sha256: templateDigest(snapshot),
      snapshot,
    });
    assert.ok(state.observations.length <= 32);
    await save();
    return snapshot;
  };
  async function mutate(operation, input, cleanup = false) {
    if (!cleanup)
      assert.ok(clock() < state.expiresAt, "Canary lifetime exceeded");
    const intent = {
      serial: state.intents.length,
      operation,
      input,
      startedAt: clock(),
      status: "pending",
      beforeIds: state.observations.at(-1)?.snapshot
        ? Object.fromEntries(
            ["environments", "services", "volumes"].map((kind) => [
              kind,
              state.observations.at(-1).snapshot[kind].map((value) => value.id),
            ]),
          )
        : {},
    };
    state.intents.push(intent);
    await save(); // Always before remote write; no automatic retries.
    try {
      const result = await api.request(operation, input);
      intent.status = "returned";
      intent.result = result;
      await save();
      return result;
    } catch (error) {
      intent.failure = error.diagnostic ?? {
        failureClass: "unknown",
        outcome: "unknown",
      };
      state.status = "unresolved";
      await save();
      throw new Error(
        `Canary ${operation} unresolved; inspect retained journal`,
        { cause: error },
      );
    }
  }
  await save();
  try {
    const before = await observe();
    assertEmpty(before);
    assert.ok(
      Number.isFinite(Date.parse(before.project.createdAt)) &&
        Date.parse(before.project.createdAt) <= startedAt &&
        startedAt - Date.parse(before.project.createdAt) <= 600000,
      "Dedicated project must be freshly created",
    );
    state.baseline = before;
    state.status = "creating";
    await save();
    const prefix = `pni605-${state.runId.slice(0, 8)}`;
    for (const suffix of ["a", "b"]) {
      const name = `${prefix}-${suffix}`;
      const current = await observe();
      assertEmpty(current);
      const value = await mutate("createEnvironment", {
        input: {
          projectId: scope.projectId,
          name,
          ephemeral: true,
          skipInitialDeploys: true,
        },
      });
      assert.ok(
        value?.id && !current.environments.some((item) => item.id === value.id),
      );
      assert.equal(value.name, name);
      assert.equal(value.projectId, scope.projectId);
      state.environments.push({ id: value.id, name });
      await save();
      const verified = await observe();
      const matches = verified.environments.filter(
        (item) => item.name === name,
      );
      assert.equal(matches.length, 1);
      assert.equal(matches[0].id, value.id);
      assertEmpty(verified);
    }
    const target = state.environments[0].id;
    const serviceName = `${prefix}-inert`;
    const service = await mutate("createService", {
      input: {
        projectId: scope.projectId,
        environmentId: target,
        name: serviceName,
      },
    });
    assert.ok(service?.id);
    assert.equal(service.name, serviceName);
    assert.equal(service.projectId, scope.projectId);
    state.services.push({ id: service.id, name: serviceName });
    await save();
    const created = await observe();
    assertNoWorkloads(created);
    assert.equal(created.services.length, 1);
    assert.equal(created.services[0].id, service.id);
    const memberships = created.details
      .filter((env) =>
        env.serviceInstances.some((item) => item.serviceId === service.id),
      )
      .map((env) => env.id)
      .sort();
    assert.ok(memberships.includes(target));
    const instances = [];
    for (const environmentId of memberships) {
      const instance = await api.request("canaryInstance", {
        environmentId,
        serviceId: service.id,
      });
      assert.equal(instance.environmentId, environmentId);
      assert.equal(instance.serviceId, service.id);
      assert.ok(!instance.source?.image && !instance.source?.repo);
      assert.equal(instance.latestDeployment ?? null, null);
      assert.equal(instance.hasEverDeployed, false);
      instances.push(instance);
    }
    state.instanceReadbacks = { before: instances, after: [] };
    await save();
    const command = "echo pni605-inert-canary";
    assert.ok(instances.every((instance) => instance.startCommand !== command));
    await mutate("configure", {
      environmentId: target,
      serviceId: service.id,
      input: { startCommand: command },
    });
    const edited = await observe();
    assertNoWorkloads(edited);
    assert.deepEqual(
      edited.details
        .filter((env) =>
          env.serviceInstances.some((item) => item.serviceId === service.id),
        )
        .map((env) => env.id)
        .sort(),
      memberships,
    );
    let editIsolated = true;
    for (const prior of instances) {
      const current = await api.request("canaryInstance", {
        environmentId: prior.environmentId,
        serviceId: service.id,
      });
      state.instanceReadbacks.after.push(current);
      await save();
      assert.equal(current.environmentId, prior.environmentId);
      assert.equal(current.serviceId, service.id);
      if (prior.environmentId === target) {
        assert.equal(current.startCommand, command);
        assert.deepEqual(
          { ...current, startCommand: prior.startCommand },
          prior,
          "Unexpected target edit side effect",
        );
      } else if (templateDigest(current) !== templateDigest(prior))
        editIsolated = false;
    }
    state.result = {
      createIsolated: memberships.length === 1,
      editIsolated,
      memberships,
    };
    await save();
    return await cleanupCanaryLocked({ root, api, clock });
  } catch (error) {
    // Cleanup owns subsequent journal writes. Never overwrite a deletion intent
    // with this function's older in-memory create state after an interruption.
    const retained = await optionalMetadata(join(root, "journal.json"));
    if (retained.status !== "unresolved") retained.status = "blocked";
    retained.failure =
      "Canary verification failed; preserve journal and inspect before further writes";
    await durableJson(join(root, "journal.json"), retained);
    throw error;
  }
}

/** Explicit cleanup/restart path for confirmed creations only; never retries create. */
export async function cleanupCanary(args) {
  const unlock = await recoveryLock(join(args.root, "writer-lock"));
  try {
    return await cleanupCanaryLocked(args);
  } finally {
    await unlock();
  }
}
async function cleanupCanaryLocked({
  root,
  api = railwayApi(),
  clock = Date.now,
}) {
  const { journal: state, inventory: current } = await inspectCanary({
    root,
    api,
  });
  assert.ok(state.baseline, "Baseline missing");
  assertEmpty(state.baseline);
  const prefix = `pni605-${state.runId.slice(0, 8)}`;
  for (const environment of state.environments) {
    assert.ok([`${prefix}-a`, `${prefix}-b`].includes(environment.name));
    assert.ok(
      !state.baseline.environments.some((value) => value.id === environment.id),
      "Baseline environment cannot be owned cleanup",
    );
  }
  for (const service of state.services)
    assert.equal(service.name, `${prefix}-inert`);
  for (const intent of state.intents) {
    if (["createEnvironment", "createService"].includes(intent.operation)) {
      const owned =
        intent.operation === "createEnvironment"
          ? state.environments
          : state.services;
      assert.ok(
        owned.some(
          (value) =>
            value.id === intent.result?.id &&
            value.name === intent.input.input.name,
        ),
        "Unconfirmed create blocks cleanup",
      );
    }
  }

  assert.ok(
    state.intents.every(
      (intent) =>
        ["returned", "absence-verified"].includes(intent.status) ||
        ["deleteService", "deleteEnvironment"].includes(intent.operation),
    ),
    "Unresolved mutation blocks cleanup",
  );
  const save = () => durableJson(join(root, "journal.json"), state);
  for (const [operation, owned] of [
    ["createEnvironment", state.environments],
    ["createService", state.services],
  ]) {
    assert.equal(
      new Set(owned.map((value) => value.id)).size,
      owned.length,
      "Duplicate ownership",
    );
    for (const value of owned) {
      const intents = state.intents.filter(
        (intent) =>
          intent.operation === operation && intent.result?.id === value.id,
      );
      assert.equal(
        intents.length,
        1,
        "Owned resource needs exactly one create intent",
      );
      const intent = intents[0];
      assert.equal(intent.status, "returned");
      assert.equal(intent.input.input.projectId, state.scope.projectId);
      assert.equal(intent.input.input.name, value.name);
      assert.equal(intent.result.projectId, state.scope.projectId);
      assert.equal(intent.result.name, value.name);
      if (operation === "createService")
        assert.equal(
          intent.input.input.environmentId,
          state.environments[0].id,
        );
    }
  }
  const serviceIds = new Set(state.services.map((value) => value.id));
  const envIds = new Set(
    [...state.baseline.environments, ...state.environments].map(
      (value) => value.id,
    ),
  );
  assert.ok(
    current.services.every((value) => serviceIds.has(value.id)),
    "Unowned service blocks cleanup",
  );
  assert.ok(
    current.environments.every((value) => envIds.has(value.id)),
    "Unowned environment blocks cleanup",
  );
  assert.deepEqual(current.volumes, [], "Unexpected volume blocks cleanup");
  assertNoWorkloads(current);
  state.status = "cleaning";
  await save();
  async function remove(operation, kind, owned) {
    const before = await inventory(api, state.scope);
    assertNoWorkloads(before);
    const matches = before[kind].filter(
      (value) => value.id === owned.id || value.name === owned.name,
    );
    if (!matches.length) {
      // A prior lost deletion may already have completed. Retain its evidence.
      const pending = state.intents.findLast(
        (intent) =>
          intent.operation === operation && intent.input.id === owned.id,
      );
      assert.ok(pending, "Owned resource disappeared without deletion intent");
      pending.status = "absence-verified";
      await save();
      return;
    }
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, owned.id);
    assert.equal(matches[0].name, owned.name);
    assert.equal(matches[0].projectId, state.scope.projectId);
    if (kind === "environments") {
      const environment = before.details.find((value) => value.id === owned.id);
      assert.deepEqual(environment.serviceInstances, []);
      assert.deepEqual(environment.volumeInstances, []);
    }
    assert.ok(
      !state.intents.some(
        (intent) =>
          intent.operation === operation && intent.input.id === owned.id,
      ),
      "Prior deletion unresolved; do not retry",
    );
    const intent = {
      serial: state.intents.length,
      operation,
      input: { id: owned.id },
      startedAt: clock(),
      status: "pending",
    };
    state.intents.push(intent);
    await save();
    try {
      await api.request(operation, intent.input);
      intent.response = "returned";
    } catch (error) {
      intent.response = "failed-or-lost";
      intent.failure = error.diagnostic ?? {
        failureClass: "unknown",
        outcome: "unknown",
      };
    }
    await save();
    const after = await inventory(api, state.scope);
    assert.ok(
      !after[kind].some(
        (value) => value.id === owned.id || value.name === owned.name,
      ),
      "Deletion absence not verified",
    );
    intent.status = "absence-verified";
    intent.verifiedAt = clock();
    await save();
  }
  for (const service of [...state.services].toReversed())
    await remove("deleteService", "services", service);
  for (const environment of [...state.environments].toReversed())
    await remove("deleteEnvironment", "environments", environment);
  const final = await inventory(api, state.scope);
  assertEmpty(final);
  assert.deepEqual(
    final.environments.map((value) => value.id).sort(),
    state.baseline.environments.map((value) => value.id).sort(),
  );
  state.finalInventory = final;
  state.cleanup = "baseline-restored";
  state.status =
    state.result?.createIsolated && state.result?.editIsolated
      ? "passed"
      : "isolation-failed";
  await save();
  return state;
}
