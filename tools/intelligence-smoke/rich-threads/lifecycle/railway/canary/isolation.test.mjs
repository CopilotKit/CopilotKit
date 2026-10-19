import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { durableJson, recoveryLock } from "../journal.mjs";
import { reuseIdentity } from "./reuse-admission.mjs";
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
  let reuseAdmission;
  let priorFiles;
  if (options.reuse) {
    Object.assign(scope, {
      purpose: "pni605-reused-fork-isolation-canary",
      projectId: reuseIdentity.projectId,
      projectName: reuseIdentity.projectName,
    });
    Object.assign(project, {
      id: scope.projectId,
      name: scope.projectName,
      createdAt: reuseIdentity.createdAt,
      deletedAt: null,
    });
    environments.splice(0, 1, {
      id: reuseIdentity.baselineId,
      name: "canary-baseline",
      projectId: scope.projectId,
    });
    const source = {
      id: reuseIdentity.sourceId,
      name: reuseIdentity.sourceName,
      projectId: scope.projectId,
      createdAt: reuseIdentity.sourceCreatedAt,
      isEphemeral: true,
      sourceEnvironment: null,
    };
    environments.push(source);
    const priorRoot = join(parent, "prior");
    await mkdir(join(priorRoot, "probe"), { recursive: true });
    const priorProject = {
      status: "create-verified",
      before: [],
      returned: {
        id: project.id,
        name: project.name,
        workspaceId: project.workspaceId,
        createdAt: project.createdAt,
      },
    };
    const priorProbe = {
      status: "unresolved",
      scope: { projectId: scope.projectId },
      services: [],
      environments: [{ id: source.id, name: source.name }],
      intents: [
        {
          operation: "createEnvironment",
          status: "returned",
          input: { input: { projectId: scope.projectId, name: source.name } },
          result: source,
        },
        {
          operation: "createEnvironment",
          status: "pending",
          input: {
            input: {
              projectId: scope.projectId,
              name: reuseIdentity.unresolvedName,
            },
          },
        },
      ],
    };
    const hashes = {};
    const hashFile = async (path) =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    priorFiles = {
      project: join(priorRoot, "project-journal.json"),
      probe: join(priorRoot, "probe/journal.json"),
      retirement: join(priorRoot, "project-retirement.json"),
    };
    await durableJson(priorFiles.project, priorProject);
    await durableJson(priorFiles.probe, priorProbe);
    hashes.projectSha256 = await hashFile(priorFiles.project);
    hashes.probeSha256 = await hashFile(priorFiles.probe);
    await durableJson(priorFiles.retirement, {
      projectId: scope.projectId,
      status: "deletion-unresolved",
      response: "unknown",
      probeJournalSha256: hashes.probeSha256,
    });
    hashes.retirementSha256 = await hashFile(priorFiles.retirement);
    const evidencePath = join(parent, "deletion-evidence.json");
    await durableJson(evidencePath, {
      assessment: "inactive",
      basis: "offline reviewed fixture",
    });
    const admissionPath = join(parent, "reuse-admission.json");
    await durableJson(admissionPath, {
      version: 1,
      kind: "pni605-existing-project-reuse",
      authorization: "ran-2026-10-19-reuse-existing-project",
      projectId: scope.projectId,
      projectName: scope.projectName,
      workspaceId: scope.workspaceId,
      reviewedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 600000).toISOString(),
      deletion: {
        status: "inactive",
        evidencePath,
        sha256: await hashFile(evidencePath),
      },
      prior: hashes,
    });
    reuseAdmission = { priorRoot, admissionPath };
  }
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
      ...(options.wrongDetailedName && id.startsWith("env-")
        ? { name: "unexpected-name" }
        : {}),
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
        if (options.rejectFork && variables.input.sourceEnvironmentId)
          throw Error("Fork rejected");
        const value = {
          ...variables.input,
          id: `env-${++serial}`,
          createdAt: new Date(now).toISOString(),
          isEphemeral: true,
          sourceEnvironment: variables.input.sourceEnvironmentId
            ? {
                id: options.wrongLineage
                  ? "foreign"
                  : variables.input.sourceEnvironmentId,
              }
            : null,
        };
        environments.push(value);
        if (options.appearOldB)
          environments.push({
            id: "late-old-b",
            name: reuseIdentity.unresolvedName,
            projectId: scope.projectId,
          });
        if (options.lostFork && variables.input.sourceEnvironmentId)
          throw Error("Fork response lost");
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
        assert.ok(variables.environmentId, "Scoped deletion required");
        memberships.delete(variables.environmentId);
        if (
          ![...memberships.values()].some((ids) => ids.includes(variables.id))
        )
          services.splice(0);
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
          if (options.tamperOriginalDuringPace) {
            options.tamperOriginalDuringPace = false;
            const old = JSON.parse(await readFile(priorFiles.probe, "utf8"));
            old.modified = true;
            await durableJson(priorFiles.probe, old);
          }
        },
      },
      reuseAdmission,
    });
  return {
    root,
    scope,
    api,
    writes,
    run,
    project,
    services,
    environments,
    reuseAdmission,
    priorFiles,
  };
}

test("existing-project proof reuses source, preserves journals, and cleans only new children", async (t) => {
  const f = await fixture(t, { reuse: true });
  const originals = await Promise.all(
    Object.values(f.priorFiles).map((path) => readFile(path, "utf8")),
  );
  const result = await f.run();
  assert.equal(result.status, "passed");
  assert.equal(
    result.intents.filter((x) => x.operation === "createEnvironment").length,
    1,
  );
  assert.equal(
    result.intents[0].input.input.sourceEnvironmentId,
    reuseIdentity.sourceId,
  );
  assert.notEqual(
    result.intents[0].input.input.name,
    reuseIdentity.unresolvedName,
  );
  assert.equal(
    result.forkAcceptance.sourceEnvironmentId,
    reuseIdentity.sourceId,
  );
  assert.deepEqual(result.result.memberships, ["env-1"]);
  assert.deepEqual(
    result.intents
      .filter((x) => x.operation === "deleteEnvironment")
      .map((x) => x.input.id),
    ["env-1"],
  );
  assert.deepEqual(
    f.environments.map((x) => x.id).sort(),
    [reuseIdentity.baselineId, reuseIdentity.sourceId].sort(),
  );
  assert.deepEqual(
    await Promise.all(
      Object.values(f.priorFiles).map((path) => readFile(path, "utf8")),
    ),
    originals,
  );
  assert.equal(result.reuse.unknownIntent.status, "pending");
});

for (const disposition of ["unknown", "pending", "scheduled"]) {
  test(`reuse refuses ${disposition} deletion admission before any write`, async (t) => {
    const f = await fixture(t, { reuse: true });
    const admission = JSON.parse(
      await readFile(f.reuseAdmission.admissionPath, "utf8"),
    );
    admission.deletion.status = disposition;
    await durableJson(f.reuseAdmission.admissionPath, admission);
    await assert.rejects(f.run(), /deletion blocks reuse/);
    assert.deepEqual(f.writes, []);
  });
}

test("reuse refuses changed source identity and deleted project", async (t) => {
  for (const kind of ["source", "project"]) {
    const f = await fixture(t, { reuse: true });
    if (kind === "source")
      f.environments.find((x) => x.id === reuseIdentity.sourceId).createdAt =
        "2020-01-01T00:00:00Z";
    else f.project.deletedAt = new Date().toISOString();
    await assert.rejects(f.run());
    assert.deepEqual(f.writes, []);
  }
});

test("original late environment stops reuse before the next write, without adoption or cleanup", async (t) => {
  const f = await fixture(t, { reuse: true, appearOldB: true });
  await assert.rejects(f.run(), /Original unresolved environment appeared/);
  assert.deepEqual(f.writes, ["createEnvironment"]);
  await assert.rejects(
    cleanupCanary({ root: f.root, api: f.api }),
    /Original unresolved environment appeared/,
  );
  assert.deepEqual(f.writes, ["createEnvironment"]);
  const saved = JSON.parse(await readFile(f.priorFiles.probe, "utf8"));
  assert.equal(saved.intents[1].status, "pending");
});

test("original journal changed during pacing blocks the first create", async (t) => {
  const f = await fixture(t, { reuse: true, tamperOriginalDuringPace: true });
  await assert.rejects(f.run(), /Original journal changed/);
  assert.deepEqual(f.writes, []);
});

test("corrupt saved reuse source blocks cleanup before any further write", async (t) => {
  const f = await fixture(t, { reuse: true, fail: "configure" });
  await assert.rejects(f.run());
  const writes = [...f.writes];
  const saved = JSON.parse(
    await readFile(join(f.root, "journal.json"), "utf8"),
  );
  saved.reuse.source.id = "foreign-source";
  await durableJson(join(f.root, "journal.json"), saved);
  await assert.rejects(
    cleanupCanary({ root: f.root, api: f.api }),
    /Saved reuse source changed/,
  );
  assert.deepEqual(f.writes, writes);
});

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

test("paced original source-to-fork proof verifies lineage before isolated service edits", async (t) => {
  const f = await fixture(t);
  f.scope.purpose = "pni605-fork-isolation-canary";
  const result = await f.run();
  assert.equal(result.status, "passed");
  assert.deepEqual(result.forkAcceptance, {
    sourceEnvironmentId: "env-1",
    forkEnvironmentId: "env-2",
    verified: true,
  });
  assert.deepEqual(result.result, {
    createIsolated: true,
    editIsolated: true,
    memberships: ["env-2"],
  });
  assert.equal(result.intents[0].input.input.sourceEnvironmentId, undefined);
  assert.equal(result.intents[1].input.input.sourceEnvironmentId, "env-1");
  assert.ok(result.intents[1].startedAt - result.intents[0].startedAt >= 32000);
  assert.equal(result.intents[2].input.input.environmentId, "env-2");
  assert.equal(result.intents[3].input.environmentId, "env-2");
  assert.deepEqual(
    result.intents
      .filter((x) => x.operation === "deleteEnvironment")
      .map((x) => x.input.id),
    ["env-2", "env-1"],
  );
  assert.equal(result.cleanup, "baseline-restored");
});

for (const failure of [
  "rejectFork",
  "lostFork",
  "wrongLineage",
  "wrongDetailedName",
]) {
  test(`fork proof stops before service creation on ${failure}`, async (t) => {
    const f = await fixture(t, { [failure]: true });
    f.scope.purpose = "pni605-fork-isolation-canary";
    await assert.rejects(f.run());
    const expectedWrites =
      failure === "wrongDetailedName"
        ? ["createEnvironment"]
        : ["createEnvironment", "createEnvironment"];
    assert.deepEqual(f.writes, expectedWrites);
    const before = await readFile(join(f.root, "journal.json"), "utf8");
    await assert.rejects(cleanupCanary({ root: f.root, api: f.api }));
    assert.deepEqual(f.writes, expectedWrites);
    assert.equal(await readFile(join(f.root, "journal.json"), "utf8"), before);
  });
}

test("fork service fanout stops before configuration and retains evidence", async (t) => {
  const f = await fixture(t, { fanout: true });
  f.scope.purpose = "pni605-fork-isolation-canary";
  await assert.rejects(f.run(), /escaped target/);
  assert.deepEqual(f.writes, [
    "createEnvironment",
    "createEnvironment",
    "createService",
  ]);
  const saved = JSON.parse(
    await readFile(join(f.root, "journal.json"), "utf8"),
  );
  assert.equal(saved.forkAcceptance.verified, true);
  assert.deepEqual(saved.createMemberships, ["default", "env-1", "env-2"]);
  await assert.rejects(
    cleanupCanary({ root: f.root, api: f.api }),
    /Service escaped target/,
  );
  assert.ok(!f.writes.includes("deleteService"));
});

test("canary reports fanout independently and refuses broad cleanup", async (t) => {
  for (const editFanout of [false, true])
    await t.test(String(editFanout), async (sub) => {
      const f = await fixture(sub, { fanout: true, editFanout });
      await assert.rejects(f.run(), /Service escaped target/);
      const result = JSON.parse(
        await readFile(join(f.root, "journal.json"), "utf8"),
      );
      assert.equal(result.result.createIsolated, false);
      assert.equal(result.result.editIsolated, !editFanout);
      assert.ok(!f.writes.includes("deleteService"));
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
