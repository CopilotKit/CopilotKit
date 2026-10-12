import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { policy, publishSnapshot } from "./contract.mts";
import {
  createRailwayEnvironment,
  recoverRailwayEnvironment,
} from "./environment.mjs";
import { receiveSnapshot } from "./receiver.mjs";
import { distributeSnapshot } from "./distribution.mjs";
import { assertRestarts } from "../../rows/row5.mjs";
const image = "ghcr.io/offline-test/fixture@sha256:" + "a".repeat(64);
const clone = (v) => structuredClone(v);
function fakeProvider(options = {}) {
  const state = {
    environments: [],
    services: [],
    volumes: [],
    proxies: [],
    calls: [],
  };
  let serial = 0;

  const api = {
    list: async (kind) => clone(state[kind]),
    environment: async (id) =>
      clone(state.environments.find((e) => e.id === id)),
    request: async (op, args) => {
      state.calls.push(op);
      const input = args.input;
      const env = state.environments.find(
        (e) => e.id === (input?.environmentId ?? args.environmentId),
      );
      if (op === "createEnvironment") {
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
        return clone(value);
      }
      if (op === "createService") {
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
      tcpPort: 5432,
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
  const dependencies = {
    supervision: async () => {},
    distribute: (snapshotFile, targets) =>
      distributeSnapshot(snapshotFile, targets, (target, request) =>
        receiveSnapshot(request, {
          SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE: target.recordsFile,
          SHOWCASE_REGISTRY_CONSUMER: target.consumer,
        }),
      ),
    fetch: async () => new Response("healthy"),
    remote: async ({ command }) =>
      command.at(-1).includes("PING") ? "PONG\n" : "",
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
test("production empty approval list rejects before provider mutation", async (t) => {
  const f = await fixture(t, false);
  assert.equal(policy.approvedImages.length, 0);
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
  assert.ok(env.scopes.mastra.databaseUrl.includes("owned.example.test:12000"));
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
  assertRestarts(receipts, "grouped");
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
test("composite receipt cannot invent readiness or duplicate physical service", () => {
  const entry = {
    owner: "r",
    service: "composite",
    serviceId: "actual-id",
    roles: [
      "intelligence-api",
      "intelligence-gateway",
      "application-runtime",
      "native-backend",
    ],
    before: { instance: "old", store: "volume" },
    after: { instance: "new", store: "volume" },
    ready: true,
  };
  assert.throws(() => assertRestarts([entry], "r"), /readiness/);
  entry.readyRoles = entry.roles;
  assertRestarts([entry], "r");
  assert.throws(
    () => assertRestarts([entry, { ...entry, service: "alias" }], "r"),
    /Duplicate/,
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
