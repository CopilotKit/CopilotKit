import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { policy, publishSnapshot } from "./contract.mts";
import {
  createRailwayEnvironment,
  recoverRailwayEnvironment,
} from "./environment.mjs";
import { RailwayRequestError } from "./api.mjs";
import { receiveSnapshot } from "./receiver.mjs";
import { distributeSnapshot } from "./distribution.mjs";
const image = "ghcr.io/offline-test/fixture@sha256:" + "a".repeat(64);
const clone = (v) => structuredClone(v);
function fakeProvider(options = {}) {
  const state = {
    environments: [],
    services: [],
    volumes: [],
    proxies: [],
    calls: [],
    serviceInputs: [],
  };
  let serial = 0;

  const api = {
    list: async (kind) => clone(state[kind]),
    environment: async (id) =>
      clone(state.environments.find((e) => e.id === id)),
    request: async (op, args) => {
      state.calls.push(op);
      if (op === "creationLimits")
        return {
          id: args.id,
          workspaceId: "11111111-2222-3333-4444-555555555555",
          subscriptionPlanLimit: {
            rateLimits: {
              environmentCreate: { max: 1, windowSeconds: 30 },
              volumeCreate: { max: 1, windowSeconds: 30 },
            },
          },
        };
      if (op === options.rejectOperation)
        throw new RailwayRequestError({
          version: 1,
          operation: op,
          failureClass: "graphql-rejected",
          outcome: "not-executed",
          codes: ["GRAPHQL_VALIDATION_FAILED"],
        });
      const input = args.input;
      if (
        options.nameLimit &&
        ["createEnvironment", "createService"].includes(op) &&
        input.name.length > options.nameLimit
      )
        throw new RailwayRequestError({
          version: 1,
          operation: op,
          failureClass: "graphql-rejected",
          outcome: "unknown",
          codes: ["BAD_USER_INPUT"],
          messages: ["Error in name - Invalid input"],
        });
      const env = state.environments.find(
        (e) => e.id === (input?.environmentId ?? args.environmentId),
      );
      if (op === "createEnvironment") {
        if (options.environmentFailure) throw options.environmentFailure;
        const value = {
          id: `env-${++serial}`,
          name: input.name,
          projectId: input.projectId,
          createdAt: new Date().toISOString(),
          isEphemeral: true,
          sourceEnvironment: input.sourceEnvironmentId
            ? { id: input.sourceEnvironmentId }
            : null,
          serviceInstances: [],
          volumeInstances: [],
        };
        state.environments.push(value);
        if (options.lostEnvironmentResponse)
          throw new Error("Lost environment response");
        return clone(value);
      }
      if (op === "createService") {
        state.serviceInputs.push(clone(input));
        assert.ok(env.sourceEnvironment, "Cannot create service outside fork");
        if (options.unknownCreate) throw new Error("Lost ambiguous response");
        const value = {
          id: `svc-${++serial}`,
          name: input.name,
          projectId: input.projectId,
          createdAt: new Date().toISOString(),
        };
        state.services.push(value);
        const instance = {
          serviceId: value.id,
          serviceName: value.name,
          environmentId: env.id,
          source: input.source,
          domains: { serviceDomains: [] },
          latestDeployment: {
            id: `deployment-${serial}`,
            status: "SUCCESS",
            instances: [{ id: `instance-${serial}`, status: "RUNNING" }],
          },
        };
        env.serviceInstances.push(instance);
        if (options.escape)
          state.environments[0].serviceInstances.push({
            ...instance,
            environmentId: state.environments[0].id,
          });
        if (options.lostCreate)
          throw new Error("Response lost after remote creation");
        return clone(value);
      }
      if (op === "createVolume") {
        const instance = {
          id: `vi-${++serial}`,
          volumeId: `vol-${serial}`,
          environmentId: env.id,
          serviceId: input.serviceId,
          mountPath: input.mountPath,
          isPendingDeletion: false,
        };
        env.volumeInstances.push(instance);
        const value = {
          id: instance.volumeId,
          projectId: input.projectId,
          volumeInstances: {
            pageInfo: { hasNextPage: false },
            edges: [{ node: instance }],
          },
        };
        state.volumes.push(value);
        return clone(value);
      }
      if (op === "proxies")
        return clone(
          state.proxies.filter(
            (p) =>
              p.serviceId === args.serviceId &&
              p.environmentId === args.environmentId,
          ),
        );
      if (op === "createProxy") {
        const value = {
          id: `proxy-${++serial}`,
          serviceId: input.serviceId,
          environmentId: input.environmentId,
          applicationPort: input.applicationPort,
          proxyPort: 12000,
          domain: "owned.example.test",
          syncStatus: "ACTIVE",
        };
        state.proxies.push(value);
        return clone(value);
      }
      if (op === "deleteProxy") {
        state.proxies = state.proxies.filter((p) => p.id !== args.id);
        return true;
      }
      if (op === "domain") {
        const value = {
          id: `domain-${++serial}`,
          domain: `d${serial}.example.test`,
          serviceId: input.serviceId,
          environmentId: env.id,
          targetPort: input.targetPort,
        };
        env.serviceInstances
          .find((s) => s.serviceId === input.serviceId)
          .domains.serviceDomains.push(value);
        return clone(value);
      }
      if (op === "restart") {
        for (const e of state.environments)
          for (const s of e.serviceInstances)
            if (s.latestDeployment.id === args.id)
              s.latestDeployment.instances = [
                { id: `restart-${++serial}`, status: "RUNNING" },
              ];
        return true;
      }
      if (op === "deleteService") {
        assert.equal(
          args.environmentId,
          state.environments.find((e) => e.sourceEnvironment)?.id,
          "Fork cleanup must name its environment",
        );
        if (options.denyDelete) throw new Error("Deletion refused");
        state.services = state.services.filter((s) => s.id !== args.id);
        for (const e of state.environments) {
          e.serviceInstances = e.serviceInstances.filter(
            (s) => s.serviceId !== args.id,
          );
          for (const v of e.volumeInstances)
            if (v.serviceId === args.id) v.serviceId = null;
        }
        for (const v of state.volumes)
          for (const edge of v.volumeInstances.edges)
            if (edge.node.serviceId === args.id) edge.node.serviceId = null;
        return true;
      }
      if (op === "deleteVolume") {
        state.volumes = state.volumes.filter((v) => v.id !== args.volumeId);
        for (const e of state.environments)
          e.volumeInstances = e.volumeInstances.filter(
            (v) => v.volumeId !== args.volumeId,
          );
        return true;
      }
      if (op === "deleteEnvironment") {
        state.environments = state.environments.filter((e) => e.id !== args.id);
        return true;
      }
      if (["configure", "deploy"].includes(op)) return true;
      throw new Error(`Unexpected operation ${op}`);
    },
  };
  return {
    api,
    state,
    setDeleteAllowed: () => {
      options.denyDelete = false;
    },
  };
}
async function fixture(t, approved = true) {
  const directory = await mkdtemp(join(tmpdir(), "railway-controller-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "runs.json");
  await publishSnapshot(file, { initialize: true });
  const consumers = [];
  for (const consumer of ["image-gate", "ruby-promotion", "harness"]) {
    const recordsFile = join(directory, consumer + ".json");
    await publishSnapshot(recordsFile, { initialize: true });
    consumers.push({
      consumer,
      recordsFile,
      host: "offline.test",
      receiver: "/offline/receiver.mjs",
    });
  }
  const services = [
    {
      key: "postgres",
      roles: ["database"],
      volume: { mountPath: "/data" },
      healthchecks: [{ role: "database", kind: "postgres" }],
    },
    {
      key: "redis",
      roles: ["cache"],
      volume: { mountPath: "/data" },
      healthchecks: [{ role: "cache", kind: "redis" }],
    },
    {
      key: "inspector",
      roles: ["inspection-worker"],
      healthchecks: [{ role: "inspection-worker", kind: "worker" }],
    },
    {
      key: "composite",
      roles: ["intelligence-api", "intelligence-gateway"],
      healthchecks: [
        { role: "intelligence-api", port: 4000, path: "/health" },
        { role: "intelligence-gateway", port: 4000, path: "/gateway/health" },
      ],
    },
    {
      key: "runtime",
      roles: ["application-runtime", "application"],
      healthchecks: [
        { role: "application-runtime", port: 4000, path: "/health" },
        { role: "application", port: 4000, path: "/" },
      ],
    },
    {
      key: "mastra",
      framework: "mastra",
      roles: ["native-backend"],
      volume: { mountPath: "/data" },
      healthchecks: [{ role: "native-backend", port: 4000, path: "/health" }],
    },
  ].map((s) => ({ ...s, image }));
  const config = {
    provider: "railway",
    purpose: "acceptance",
    projectId: policy.projectId,
    registryActivation: { review: "offline fixture only", revision: "offline" },
    controlDirectory: directory,
    recordsFile: file,
    services,
    consumers,
    inspection: { runnerUrl: "https://runner.example", token: "a".repeat(64) },
    database: {
      serviceKey: "postgres",
      user: "test",
      password: "private-test-value",
      database: "acceptance",
    },
    scopes: {
      mastra: {
        projectId: "logical-project",
        native: {},
        capture: { token: "private-capture-value" },
      },
    },
  };
  let pacingNow = Date.now();
  const dependencies = {
    pacingTime: {
      clock: () => pacingNow,
      monotonic: () => pacingNow,
      sleep: async (ms) => {
        pacingNow += ms;
      },
    },
    supervision: async () => {},
    distribute: (snapshotFile, targets) =>
      distributeSnapshot(snapshotFile, targets, (target, request) =>
        receiveSnapshot(request, {
          SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE: target.recordsFile,
          SHOWCASE_REGISTRY_CONSUMER: target.consumer,
        }),
      ),
    fetch: async () => new Response("healthy"),
    inspection: async () => ({ ready: true }),
  };
  // Explicit in-memory synthetic test approval only. No production policy file or runtime override.
  if (approved) {
    const before = [...policy.approvedImages];
    policy.approvedImages.push(image);
    t.after(() =>
      policy.approvedImages.splice(0, policy.approvedImages.length, ...before),
    );
  }
  return { config, dependencies, directory };
}
test("committed approval list rejects an unapproved pin before provider mutation", async (t) => {
  const f = await fixture(t, false);
  assert.equal(policy.approvedImages.includes(image), false);
  const p = fakeProvider();
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "unapproved", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /independent registry approval/,
  );
  assert.deepEqual(p.state.calls, []);
});
test("three consumer mirrors; one physical composite restart; exact resource absence", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider();
  const env = await createRailwayEnvironment(
    { ...f, runId: "grouped", frameworks: ["mastra"] },
    { ...f.dependencies, api: p.api },
  );
  assert.equal(env.scopes.mastra.databaseUrl, undefined);
  assert.equal(
    p.state.calls.some((c) => c.op === "createProxy"),
    false,
  );
  assert.ok(env.scopes.mastra.capture.url.endsWith("/rich-thread-capture"));
  assert.ok(!JSON.stringify(env.receipt).includes("private-test-value"));
  const receipts = await env.restart(
    [
      "intelligence-api",
      "intelligence-gateway",
      "application-runtime",
      "native-backend",
    ],
    "mastra",
  );
  assert.equal(p.state.calls.filter((c) => c === "restart").length, 3);
  assert.equal(receipts.length, 3);
  assert.equal(new Set(receipts.map((r) => r.serviceId)).size, receipts.length);
  for (const receipt of receipts) {
    assert.deepEqual(receipt.after.store, receipt.before.store);
    assert.notEqual(receipt.before.instance, receipt.after.instance);
    assert.ok(receipt.roles.every((role) => receipt.readyRoles.includes(role)));
  }
  for (const target of f.config.consumers)
    assert.equal(
      JSON.parse(await readFile(target.recordsFile, "utf8")).runs[0].phase,
      "ready",
    );
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "overlap", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /reconciliation/,
  );
  assert.equal((await env.cleanup()).status, "passed");
  assert.equal(
    p.state.services.length +
      p.state.volumes.length +
      p.state.environments.length,
    0,
  );
  for (const target of f.config.consumers)
    assert.equal(
      JSON.parse(await readFile(target.recordsFile, "utf8")).runs[0].phase,
      "complete",
    );
});
test("long run IDs and service keys keep distinct bounded provider names", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider({ nameLimit: 32 });
  const native = f.config.services.find((service) => service.key === "mastra");
  native.key = "native-" + "a".repeat(56);
  f.config.services.push({ ...native, key: "native-" + "a".repeat(55) + "b" });
  const names = new Set();
  for (const runId of [
    "rich-3928b79a-4466-4c75-adec-123456789abc",
    "r".repeat(63),
  ]) {
    const env = await createRailwayEnvironment(
      { ...f, runId, frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    );
    try {
      const journal = JSON.parse(
        await readFile(join(f.directory, runId, "journal.json"), "utf8"),
      );
      assert.equal(journal.runId, runId);
      assert.deepEqual(
        journal.services.map((service) => service.key),
        f.config.services.map((service) => service.key),
      );
      for (const resource of [...journal.environments, ...journal.services]) {
        assert.ok(resource.name.length <= 32, resource.name);
        assert.match(resource.name, /^[a-z][a-z0-9-]*$/);
        assert.equal(names.has(resource.name), false, resource.name);
        names.add(resource.name);
      }
      const inspector = journal.services.find(
        (service) => service.key === "inspector",
      );
      const worker = JSON.parse(
        p.state.serviceInputs.find((input) => input.name === inspector.name)
          .variables.RICH_INSPECTION_CONFIG_JSON,
      );
      const postgres = journal.services.find(
        (service) => service.key === "postgres",
      );
      const redis = journal.services.find((service) => service.key === "redis");
      assert.equal(
        new URL(worker.databaseUrl).hostname,
        `${postgres.name}.railway.internal`,
      );
      assert.equal(
        new URL(worker.redisUrl).hostname,
        `${redis.name}.railway.internal`,
      );
      assert.equal(
        new URL(worker.native.mastra).hostname,
        `${journal.services.at(-1).name}.railway.internal`,
      );
      assert.equal(journal.environments[1].name, journal.environmentName);
      assert.equal(
        journal.environments[0].name,
        `${journal.environmentName}-source`,
      );
    } finally {
      assert.equal((await env.cleanup()).status, "passed");
    }
    assert.equal(p.state.environments.length + p.state.services.length, 0);
  }
});
test("lost response reconciles provider IDs and deletes partial setup", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider({ lostCreate: true });
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "lost", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /Response lost/,
  );
  const journal = JSON.parse(
    await readFile(join(f.directory, "lost/journal.json"), "utf8"),
  );
  assert.equal(journal.cleanup.status, "passed");
  assert.equal(journal.services.length, 1);
  assert.equal(p.state.services.length, 0);
  assert.ok(journal.intents.some((i) => i.reconciledFromProvider));
});
test("unknown creation outcome retains lease and blocks new runs", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider({ unknownCreate: true });
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "unknown", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /setup and cleanup failed/,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(f.directory, "active-run/lease.json"), "utf8"),
    ).runId,
    "unknown",
  );
  assert.equal(p.state.calls.filter((c) => c.startsWith("delete")).length, 0);
});
test("proven pre-execution rejection releases only after complete absence inventory", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider({
    environmentFailure: new RailwayRequestError({
      version: 1,
      operation: "createEnvironment",
      failureClass: "graphql-rejected",
      outcome: "not-executed",
      codes: ["GRAPHQL_VALIDATION_FAILED"],
    }),
  });
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "rejected", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /graphql-rejected/,
  );
  const journal = JSON.parse(
    await readFile(join(f.directory, "rejected/journal.json"), "utf8"),
  );
  assert.equal(journal.intents[0].status, "absent");
  assert.equal(journal.cleanup.status, "passed");
  await assert.rejects(readFile(join(f.directory, "active-run/lease.json")), {
    code: "ENOENT",
  });
  assert.deepEqual(p.state.calls, ["creationLimits", "createEnvironment"]);
});

test("repeated absence never settles a lost environment response; later resource is recovered", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider({ environmentFailure: new Error("Lost response") });
  const args = { ...f, runId: "late-environment", frameworks: ["mastra"] };
  const dependencies = { ...f.dependencies, api: p.api };
  await assert.rejects(
    createRailwayEnvironment(args, dependencies),
    /setup and cleanup failed/,
  );
  const path = join(f.directory, "late-environment/journal.json");
  for (let n = 0; n < 3; n++) {
    await assert.rejects(
      recoverRailwayEnvironment(args, dependencies),
      /cleanup incomplete/,
    );
    assert.equal(
      JSON.parse(await readFile(path, "utf8")).intents[0].status,
      "pending",
    );
  }
  const journal = JSON.parse(await readFile(path, "utf8"));
  p.state.environments.push({
    id: "late-owned-environment",
    name: journal.intents[0].name,
    projectId: f.config.projectId,
    createdAt: journal.intents[0].startedAt,
    isEphemeral: true,
    sourceEnvironment: null,
    serviceInstances: [],
    volumeInstances: [],
  });
  assert.equal(
    (await recoverRailwayEnvironment(args, dependencies)).status,
    "passed",
  );
  assert.equal(p.state.environments.length, 0);
  assert.equal(
    JSON.parse(await readFile(path, "utf8")).intents[0].resultId,
    "late-owned-environment",
  );
});

test("escaped service is never a deletion target", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider({ escape: true });
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "escape", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /setup and cleanup failed/,
  );
  assert.ok(!p.state.calls.includes("deleteService"));
  assert.equal(
    JSON.parse(await readFile(join(f.directory, "escape/journal.json"), "utf8"))
      .cleanup.status,
    "failed",
  );
});
test("delete refusal retains IDs; recovery rechecks absence and releases lease", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider({ denyDelete: true });
  const env = await createRailwayEnvironment(
    { ...f, runId: "recover", frameworks: ["mastra"] },
    { ...f.dependencies, api: p.api },
  );
  await assert.rejects(env.cleanup(), /cleanup incomplete/);
  p.setDeleteAllowed();
  assert.equal(
    (
      await recoverRailwayEnvironment(
        { config: f.config, runId: "recover" },
        { ...f.dependencies, api: p.api },
      )
    ).status,
    "passed",
  );
});
test("consumer publication failure stops before first provider mutation", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider();
  await rm(f.config.consumers[1].recordsFile);
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "distribution", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
  );
  assert.deepEqual(p.state.calls, []);
});
test("cancellation during provisioning waits for returned ownership before cleanup", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider();
  const abort = new AbortController();
  const request = p.api.request;
  p.api.request = async (op, args) => {
    const result = await request(op, args);
    if (op === "createService") abort.abort(new Error("Cancelled owned run"));
    return result;
  };
  await assert.rejects(
    createRailwayEnvironment(
      {
        ...f,
        runId: "cancelled",
        frameworks: ["mastra"],
        signal: abort.signal,
      },
      { ...f.dependencies, api: p.api },
    ),
    /Cancelled owned run/,
  );
  assert.equal(
    p.state.services.length +
      p.state.environments.length +
      p.state.volumes.length,
    0,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(f.directory, "cancelled/journal.json"), "utf8"),
    ).cleanup.status,
    "passed",
  );
});
test("unknown later create still removes earlier confirmed services and volumes", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider();
  const request = p.api.request;
  let created = 0;
  p.api.request = async (op, args) => {
    if (op === "createService" && ++created === 2)
      throw new Error("Unknown second creation");
    return request(op, args);
  };
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "partial-unknown", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /setup and cleanup failed/,
  );
  assert.equal(p.state.services.length, 0);
  assert.equal(p.state.volumes.length, 0);
  assert.equal(p.state.environments.length, 2);
  assert.equal(
    JSON.parse(
      await readFile(join(f.directory, "active-run/lease.json"), "utf8"),
    ).runId,
    "partial-unknown",
  );
});

test("corrupt inspection state never prevents API-owned emergency cleanup", async (t) => {
  const f = await fixture(t),
    p = fakeProvider();
  const env = await createRailwayEnvironment(
    { ...f, runId: "corrupt-inspection", frameworks: ["mastra"] },
    { ...f.dependencies, api: p.api },
  );
  await writeFile(
    join(f.directory, "corrupt-inspection", "inspection", "state.json"),
    "invalid json",
  );
  const report = await env.cleanup();
  assert.equal(report.status, "passed");
  assert.equal(p.state.services.length, 0);
  assert.equal(p.state.volumes.length, 0);
  assert.equal(p.state.environments.length, 0);
});

for (const operation of ["createService", "createVolume", "domain"]) {
  test(`definitive ${operation} rejection retains proof and cleans prior resources`, async (t) => {
    const f = await fixture(t);
    const p = fakeProvider({ rejectOperation: operation });
    await assert.rejects(
      createRailwayEnvironment(
        { ...f, runId: "rejected-resource", frameworks: ["mastra"] },
        { ...f.dependencies, api: p.api },
      ),
      /graphql-rejected/,
    );
    const journal = JSON.parse(
      await readFile(
        join(f.directory, "rejected-resource/journal.json"),
        "utf8",
      ),
    );
    const intent = journal.intents.find(
      (i) => i.kind === operation && i.failure,
    );
    assert.equal(intent.status, "absent");
    assert.equal(journal.cleanup.status, "passed");
    assert.equal(
      p.state.environments.length +
        p.state.services.length +
        p.state.volumes.length,
      0,
    );
  });
}

test("public proxy configuration remains forbidden before creation", async (t) => {
  const f = await fixture(t);
  f.config.services[0].tcpPort = 5432;
  const p = fakeProvider();
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "forbidden-proxy", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /Public database proxies are not allowed/,
  );
  assert.deepEqual(p.state.calls, []);
});

for (const lostEnvironmentResponse of [false, true]) {
  test(`environment response lost=${lostEnvironmentResponse} requires complete CLI inventory`, async (t) => {
    const f = await fixture(t);
    const p = fakeProvider({ lostEnvironmentResponse });
    const env = await createRailwayEnvironment(
      { ...f, runId: "verified-environment", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    );
    const journal = JSON.parse(
      await readFile(
        join(f.directory, "verified-environment/journal.json"),
        "utf8",
      ),
    );
    const intents = journal.intents.filter(
      (intent) => intent.kind === "createEnvironment",
    );
    assert.equal(intents.length, 2);
    for (const intent of intents) {
      assert.equal(intent.verification.length, 1);
      assert.equal(intent.verification[0].complete, true);
      assert.deepEqual(intent.verification[0].matchingIds, [intent.resultId]);
      assert.equal(intent.reconciledFromProvider, lostEnvironmentResponse);
    }
    assert.equal(
      p.state.calls.filter((op) => op === "createEnvironment").length,
      2,
    );
    assert.equal((await env.cleanup()).status, "passed");
  });
}

test("cancellation during post-pacing inventory sends no creation intent", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider();
  const abort = new AbortController();
  const list = p.api.list;
  p.api.list = async (kind) => {
    if (kind === "volumes" && p.state.calls.includes("creationLimits"))
      abort.abort(new Error("cancelled during inventory"));
    return list(kind);
  };
  await assert.rejects(
    createRailwayEnvironment(
      {
        ...f,
        runId: "cancelled-inventory",
        frameworks: ["mastra"],
        signal: abort.signal,
      },
      { ...f.dependencies, api: p.api },
    ),
  );
  assert.deepEqual(p.state.calls, ["creationLimits"]);
  const journal = JSON.parse(
    await readFile(
      join(f.directory, "cancelled-inventory/journal.json"),
      "utf8",
    ),
  );
  assert.deepEqual(journal.intents, []);
});

test("incomplete post-create inventory retains returned ID and blocks provisioning", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider();
  const list = p.api.list;
  p.api.list = async (kind) => {
    if (kind === "environments" && p.state.calls.includes("createEnvironment"))
      throw new Error("Incomplete inventory");
    return list(kind);
  };
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "incomplete-inventory", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /setup and cleanup failed/,
  );
  const journal = JSON.parse(
    await readFile(
      join(f.directory, "incomplete-inventory/journal.json"),
      "utf8",
    ),
  );
  assert.equal(journal.intents[0].resultId, p.state.environments[0].id);
  assert.equal(journal.intents[0].verification[0].complete, false);
  assert.deepEqual(p.state.calls, ["creationLimits", "createEnvironment"]);
});

test("empty post-create inventory is bounded and preserves unresolved ownership", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider();
  const list = p.api.list;
  p.api.list = async (kind) => (kind === "environments" ? [] : list(kind));
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "invisible-environment", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /setup and cleanup failed/,
  );
  const journal = JSON.parse(
    await readFile(
      join(f.directory, "invisible-environment/journal.json"),
      "utf8",
    ),
  );
  const intent = journal.intents[0];
  assert.equal(intent.resultId, p.state.environments[0].id);
  assert.equal(intent.status, "pending");
  assert.equal(intent.verification.length, 3);
  assert.ok(
    intent.verification.every((v) => v.complete && v.matchingIds.length === 0),
  );
  assert.deepEqual(p.state.calls, ["creationLimits", "createEnvironment"]);
});

test("wrong-source environment never gains cleanup ownership", async (t) => {
  const f = await fixture(t);
  const p = fakeProvider();
  const request = p.api.request;
  p.api.request = async (op, args) => {
    const value = await request(op, args);
    if (op === "createEnvironment") {
      p.state.environments[0].sourceEnvironment = { id: "foreign-source" };
      value.sourceEnvironment = { id: "foreign-source" };
    }
    return value;
  };
  await assert.rejects(
    createRailwayEnvironment(
      { ...f, runId: "wrong-source", frameworks: ["mastra"] },
      { ...f.dependencies, api: p.api },
    ),
    /setup and cleanup failed/,
  );
  const journal = JSON.parse(
    await readFile(join(f.directory, "wrong-source/journal.json"), "utf8"),
  );
  assert.equal(journal.intents[0].verification[0].outcome, "conflict");
  assert.equal(journal.environments.length, 0);
  assert.deepEqual(p.state.calls, ["creationLimits", "createEnvironment"]);
});
