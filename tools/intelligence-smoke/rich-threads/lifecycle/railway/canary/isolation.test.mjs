import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { durableJson, recoveryLock } from "../journal.mjs";
import {
  runCanary,
  inspectCanary,
  cleanupCanary,
  canaryWorkspaceId,
} from "./isolation.mjs";

async function fixture(t, options = {}) {
  const parent = await mkdtemp(join(tmpdir(), "isolated-canary-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "journal");
  let now = Date.now();
  const scope = {
    version: 1,
    purpose: "pni605-isolation-canary",
    workspaceId: canaryWorkspaceId,
    projectId: "11111111-2222-3333-4444-555555555555",
    projectName: "pni605-canary-abcdef123456",
    lifetimeMs: 600000,
  };
  const project = {
    id: scope.projectId,
    name: scope.projectName,
    workspaceId: scope.workspaceId,
    createdAt: new Date(now - 1000).toISOString(),
  };
  const environments = [
    { id: "default", name: "production", projectId: scope.projectId },
  ];
  const services = [];
  const memberships = new Map();
  const commands = new Map();
  const writes = [];
  let serial = 0;
  const api = {
    list: async (kind) =>
      structuredClone(
        kind === "environments"
          ? environments
          : kind === "services"
            ? services
            : [],
      ),
    environment: async (id) => ({
      ...environments.find((value) => value.id === id),
      serviceInstances: (memberships.get(id) ?? []).map((serviceId) => ({
        serviceId,
        environmentId: id,
        source: null,
        latestDeployment: null,
      })),
      volumeInstances: [],
    }),
    request: async (operation, variables) => {
      if (operation === "creationLimits")
        return {
          ...project,
          subscriptionPlanLimit: {
            rateLimits: { environmentCreate: { max: 1, windowSeconds: 30 } },
          },
        };
      if (operation === "canaryProject") return structuredClone(project);
      if (operation === "canaryInstance")
        return {
          serviceId: variables.serviceId,
          environmentId: variables.environmentId,
          startCommand: commands.get(variables.environmentId) ?? null,
          hasEverDeployed: false,
          source: null,
          latestDeployment: null,
        };
      // Prove every mutation had a durable intent before execution.
      const journal = JSON.parse(
        await readFile(join(root, "journal.json"), "utf8"),
      );
      assert.equal(journal.intents.at(-1).operation, operation);
      assert.equal(journal.intents.at(-1).status, "pending");
      assert.deepEqual(journal.intents.at(-1).input, variables);
      writes.push(operation);
      if (options.fail === operation) throw new Error("PRIVATE_PROVIDER_TEXT");
      if (operation === "createEnvironment") {
        const value = { ...variables.input, id: `env-${++serial}` };
        environments.push(value);
        return structuredClone(value);
      }
      if (operation === "createService") {
        assert.equal(variables.input.source, undefined);
        assert.equal(variables.input.variables, undefined);
        const value = { ...variables.input, id: "owned-service" };
        services.push(value);
        for (const environment of environments)
          if (
            options.fanout ||
            environment.id === variables.input.environmentId
          )
            memberships.set(environment.id, [value.id]);
        return structuredClone(value);
      }
      if (operation === "configure") {
        for (const environment of environments)
          if (options.editFanout || environment.id === variables.environmentId)
            commands.set(environment.id, variables.input.startCommand);
        return true;
      }
      if (operation === "deleteService") {
        services.splice(0);
        memberships.clear();
        if (options.lostDelete) throw new Error("PRIVATE_LOST_DELETE");
        return true;
      }
      if (operation === "deleteEnvironment") {
        assert.notEqual(variables.id, "default");
        environments.splice(
          environments.findIndex((value) => value.id === variables.id),
          1,
        );
        return true;
      }
      throw new Error(`Unexpected ${operation}`);
    },
  };
  const run = () =>
    runCanary({
      root,
      scope,
      api,
      clock: () => now,
      pacingTime: {
        monotonic: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      },
    });
  return { root, scope, api, writes, run, project, services, environments };
}

test("inert canary verifies isolated create/edit and restores baseline", async (t) => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.status, "passed");
  assert.ok(result.intents[0].startedAt - result.startedAt >= 32000);
  assert.ok(result.intents[1].startedAt - result.intents[0].startedAt >= 32000);
  assert.deepEqual(result.result, {
    createIsolated: true,
    editIsolated: true,
    memberships: ["env-1"],
  });
  assert.equal(result.cleanup, "baseline-restored");
  assert.equal(result.instanceReadbacks.before.length, 1);
  assert.equal(result.instanceReadbacks.after.length, 1);
  assert.equal(result.instanceReadbacks.before[0].startCommand, null);
  assert.equal(
    result.instanceReadbacks.after[0].startCommand,
    "echo pni605-inert-canary",
  );
  const saved = JSON.parse(
    await readFile(join(f.root, "journal.json"), "utf8"),
  );
  assert.deepEqual(saved.instanceReadbacks, result.instanceReadbacks);
  assert.deepEqual(f.writes, [
    "createEnvironment",
    "createEnvironment",
    "createService",
    "configure",
    "deleteService",
    "deleteEnvironment",
    "deleteEnvironment",
  ]);
  assert.equal(f.environments.length, 1);
  assert.equal(f.environments[0].id, "default");
  assert.equal(f.services.length, 0);
  await assert.rejects(f.run(), { code: "EEXIST" });
});

test("canary reports create and edit fanout independently and cleans owned resources", async (t) => {
  for (const editFanout of [false, true])
    await t.test(String(editFanout), async (sub) => {
      const f = await fixture(sub, { fanout: true, editFanout });
      const result = await f.run();
      assert.equal(result.status, "isolation-failed");
      assert.equal(result.result.createIsolated, false);
      assert.equal(result.result.editIsolated, !editFanout);
      assert.equal(result.cleanup, "baseline-restored");
    });
});

test("canary rejects shared or populated project before any writes", async (t) => {
  const shared = await fixture(t);
  shared.scope.projectId = "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479";
  await assert.rejects(shared.run(), /Shared project/);
  assert.deepEqual(shared.writes, []);
  const populated = await fixture(t);
  populated.services.push({
    id: "existing",
    projectId: populated.scope.projectId,
  });
  await assert.rejects(populated.run(), /no services/);
  assert.deepEqual(populated.writes, []);
});

test("unknown create or edit stops and cannot be retried or silently cleaned", async (t) => {
  for (const fail of ["createEnvironment", "createService", "configure"])
    await t.test(fail, async (sub) => {
      const f = await fixture(sub, { fail });
      await assert.rejects(f.run(), /unresolved/);
      const count = f.writes.length;
      const inspection = await inspectCanary({ root: f.root, api: f.api });
      assert.equal(inspection.journal.status, "unresolved");
      assert.equal(
        JSON.stringify(inspection.journal).includes("PRIVATE_"),
        false,
      );
      await assert.rejects(
        cleanupCanary({ root: f.root, api: f.api }),
        /Unconfirmed create|Unresolved mutation/,
      );
      assert.equal(f.writes.length, count);
    });
});

test("lost deletion response is reconciled without repeating deletion", async (t) => {
  const f = await fixture(t, { lostDelete: true });
  const result = await f.run();
  assert.equal(result.status, "passed");
  const deletion = result.intents.find(
    (value) => value.operation === "deleteService",
  );
  assert.equal(deletion.response, "failed-or-lost");
  assert.equal(deletion.status, "absence-verified");
  const count = f.writes.length;
  await cleanupCanary({ root: f.root, api: f.api });
  assert.equal(f.writes.length, count);
});

test("unresolved deletion retains its intent and cannot be resubmitted", async (t) => {
  const f = await fixture(t, { fail: "deleteService" });
  await assert.rejects(f.run(), /Deletion absence/);
  const { journal } = await inspectCanary({ root: f.root, api: f.api });
  assert.equal(journal.status, "blocked");
  assert.equal(journal.intents.at(-1).operation, "deleteService");
  assert.equal(journal.intents.at(-1).status, "pending");
  const count = f.writes.length;
  await assert.rejects(
    cleanupCanary({ root: f.root, api: f.api }),
    /Prior deletion unresolved/,
  );
  assert.equal(f.writes.length, count);
});

test("old project or expired canary performs no mutation", async (t) => {
  const old = await fixture(t);
  old.project.createdAt = "2020-01-01T00:00:00.000Z";
  await assert.rejects(old.run(), /freshly created/);
  assert.deepEqual(old.writes, []);
  const expired = await fixture(t);
  expired.scope.lifetimeMs = 1;
  let now = Date.now();
  await assert.rejects(
    runCanary({
      root: expired.root,
      scope: expired.scope,
      api: expired.api,
      clock: () => now++,
    }),
    /lifetime exceeded/,
  );
  assert.deepEqual(expired.writes, []);
});

test("cleanup rejects ownership entries without a unique confirmed create intent", async (t) => {
  const f = await fixture(t);
  await f.run();
  const { journal } = await inspectCanary({ root: f.root, api: f.api });
  const extra = {
    id: "foreign",
    name: journal.environments[0].name,
    projectId: f.scope.projectId,
  };
  journal.environments.push({ id: extra.id, name: extra.name });
  f.environments.push(extra);
  await durableJson(join(f.root, "journal.json"), journal);
  const count = f.writes.length;
  await assert.rejects(
    cleanupCanary({ root: f.root, api: f.api }),
    /exactly one create intent/,
  );
  assert.equal(f.writes.length, count);
});

test("cleanup cannot run alongside another journal writer", async (t) => {
  const f = await fixture(t);
  await f.run();
  const unlock = await recoveryLock(join(f.root, "writer-lock"));
  try {
    const count = f.writes.length;
    await assert.rejects(cleanupCanary({ root: f.root, api: f.api }));
    assert.equal(f.writes.length, count);
    await inspectCanary({ root: f.root, api: f.api }); // reads remain available
  } finally {
    await unlock();
  }
});

test("target edit cannot silently add a repository source", async (t) => {
  const f = await fixture(t);
  const request = f.api.request;
  f.api.request = async (operation, variables) => {
    const value = await request(operation, variables);
    if (operation === "canaryInstance" && f.writes.includes("configure"))
      value.source = { repo: "unexpected/repo" };
    return value;
  };
  await assert.rejects(f.run(), /Unexpected target edit side effect/);
  assert.ok(!f.writes.includes("deleteService"));
});
