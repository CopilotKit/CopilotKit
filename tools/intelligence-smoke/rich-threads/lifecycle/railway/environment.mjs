import { bindServiceVariables } from "./service-bindings.mjs";
import { ownerAlive } from "./process-owner.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  policy,
  parseRunRecordsSnapshot,
  publishSnapshot,
} from "./contract.mts";
import { verifySupervisor } from "./supervision.mjs";
import { railwayApi } from "./api.mjs";
import {
  acquire,
  release,
  durableJson,
  authority,
  recoveryLock as acquireRecoveryLock,
} from "./journal.mjs";
import { distributeSnapshot, validateDistribution } from "./distribution.mjs";
import {
  inspectRemoteStores,
  serviceReady,
  inspectOperation,
} from "./inspection.mjs";
import {
  validateBootstrap,
  bindBootstrap,
  runBootstrap,
} from "./bootstrap.mjs";
import {
  initializeInspection,
  closeInspection,
} from "./inspection-channel.mjs";
const physicalRoles = [
  "inspection-worker",
  "database",
  "cache",
  "intelligence-api",
  "intelligence-gateway",
  "application-runtime",
  "native-backend",
  "application",
];
const id = (value) => {
  assert.ok(
    typeof value === "string" && value.trim() === value && value.length > 0,
    "Provider ID required",
  );
  return value;
};
const safe = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(value);
export function validateRailwayConfig(config, frameworks) {
  assert.equal(config.provider, "railway");
  assert.equal(config.purpose, "acceptance");
  assert.equal(
    config.projectId,
    policy.projectId,
    "Project differs from committed registry policy",
  );
  assert.ok(
    config.registryActivation?.review && config.registryActivation?.revision,
    "Approved consumer activation reference required",
  );
  validateDistribution(config.consumers);
  if (config.permanentRunner)
    assert.ok(
      config.consumers.every((c) => c.transport === "https"),
      "Hosted runner requires HTTPS registry distribution",
    );
  assert.ok(
    frameworks.length &&
      frameworks.every((f) => ["mastra", "strands-typescript"].includes(f)),
  );
  assert.ok(
    config.services?.length &&
      new Set(config.services.map((s) => s.key)).size ===
        config.services.length,
  );
  for (const service of config.services) {
    assert.ok(safe(service.key));
    assert.ok(!service.tcpPort, "Public database proxies are not allowed");
    if (service.tcpPort)
      assert.ok(
        service.roles.includes("database") &&
          Number.isInteger(service.tcpPort) &&
          service.tcpPort > 0 &&
          service.tcpPort < 65536,
        "Only owned database TCP publication supported",
      );
    assert.ok(
      service.roles?.length &&
        service.roles.every((r) => physicalRoles.includes(r)),
    );
    assert.ok(
      policy.approvedImages.includes(service.image),
      `Image requires independent registry approval: ${service.key}`,
    );
    assert.ok(
      service.roles.every(
        (role) =>
          !["database", "cache", "native-backend"].includes(role) ||
          service.volume,
      ),
      "Data services require owned volumes",
    );
    if (service.volume)
      assert.match(service.volume.mountPath, /^\/[a-zA-Z0-9/_-]+$/);
    assert.ok(
      service.healthchecks?.length,
      "Actual readiness commands or health endpoints required",
    );
    for (const health of service.healthchecks) {
      assert.ok(service.roles.includes(health.role));
      assert.ok(
        (health.kind === "worker" && health.role === "inspection-worker") ||
          (health.kind === "postgres" && health.role === "database") ||
          (health.kind === "redis" && health.role === "cache") ||
          ((!health.kind || health.kind === "http") &&
            health.path?.startsWith("/") &&
            Number.isInteger(health.port)),
      );
    }
  }
  assert.ok(
    config.inspection?.runnerUrl &&
      /^[a-f0-9]{64}$/.test(config.inspection.token),
    "Scoped inspection configuration required",
  );
  const inspector = config.services.findIndex((s) =>
    s.roles.includes("inspection-worker"),
  );
  assert.equal(
    config.services.filter((s) => s.roles.includes("inspection-worker")).length,
    1,
  );
  assert.ok(
    config.services
      .filter((s) => s.roles.some((r) => ["database", "cache"].includes(r)))
      .every((s) => config.services.indexOf(s) < inspector),
    "Data resources must precede worker",
  );
  assert.ok(
    config.services.findIndex((s) => s.roles.includes("intelligence-api")) >
      inspector,
    "Worker must precede composite",
  );
  validateBootstrap(config);
  for (const service of config.services)
    assert.ok(
      service.roles.every((role) =>
        service.healthchecks.some((h) => h.role === role),
      ),
      "Every logical role requires readiness",
    );
  for (const role of physicalRoles)
    assert.ok(
      config.services.some((s) => s.roles.includes(role)),
      `Missing logical role ${role}`,
    );
  for (const framework of frameworks)
    assert.ok(
      config.services.some(
        (s) => s.framework === framework && s.roles.includes("native-backend"),
      ),
      `Missing native service ${framework}`,
    );
}
function record(journal) {
  assert.ok(journal.environmentId);
  return {
    runId: journal.runId,
    projectId: journal.projectId,
    environmentId: journal.environmentId,
    startedAt: journal.startedAt,
    expiresAt: journal.expiresAt,
    phase: journal.phase,
    services: journal.services.map((s) => ({
      name: s.name,
      serviceId: s.id,
      expectedImage: s.image,
    })),
    resources: [
      ...journal.environments.map((e) => ({
        kind:
          e.id === journal.environmentId ? "environment" : "source-environment",
        id: e.id,
      })),
      ...journal.volumes.map((v) => ({ kind: "volume", id: v.id })),
      ...journal.domains.map((d) => ({ kind: "domain", id: d.id })),
      ...(journal.proxies ?? []).map((p) => ({ kind: "tcp-proxy", id: p.id })),
    ],
  };
}

/** A single durable authority runs this controller; CI invokes that authority, never a runner-local lease. */
export async function createRailwayEnvironment(
  { config, runId, frameworks, outputDir, signal },
  dependencies = {},
) {
  validateRailwayConfig(config, frameworks);
  assert.ok(safe(runId));
  signal?.throwIfAborted();
  const api = dependencies.api ?? railwayApi();
  const distribute = dependencies.distribute ?? distributeSnapshot;
  await authority(config.controlDirectory);
  await (dependencies.supervision ?? verifySupervisor)(config);
  const existing = JSON.parse(await readFile(config.recordsFile, "utf8"));
  assert.ok(
    parseRunRecordsSnapshot(existing, policy, new Date()).ok,
    "Invalid/missing durable registry snapshot",
  );
  assert.ok(
    existing.runs.every((r) => r.phase === "complete"),
    "Previous run requires reconciliation before new provisioning",
  );
  await distribute(config.recordsFile, config.consumers);
  const lease = await acquire(config.controlDirectory, runId);
  const directory = join(config.controlDirectory, runId);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    await release(config.controlDirectory, lease);
    throw error;
  }
  const startedAt = new Date().toISOString();
  const journal = {
    version: 1,
    provider: "railway",
    purpose: "acceptance",
    runId,
    projectId: config.projectId,
    lease,
    startedAt,
    expiresAt: new Date(Date.parse(startedAt) + 60 * 60 * 1000).toISOString(),
    phase: "setup",
    environmentName: `rich-${runId}-${randomUUID().slice(0, 8)}`,
    environments: [],
    services: [],
    volumes: [],
    domains: [],
    proxies: [],
    intents: [],
    restarts: [],
    cleanup: { status: "not-run" },
  };
  const controller = await controllerFor({
    config,
    journal,
    directory,
    api,
    distribute,
    signal,
    outputDir,
    dependenciesExecute: dependencies.inspection,
    requestHealth: dependencies.fetch ?? fetch,
    supervision: dependencies.supervision ?? verifySupervisor,
  });
  try {
    await controller.setup(config.services);
    return controller.environment;
  } catch (error) {
    try {
      await controller.cleanup();
    } catch (cleanupError) {
      // Both failures are preserved in errors; cleanup is the actionable cause.
      // eslint-disable-next-line preserve-caught-error
      throw new AggregateError(
        [error, cleanupError],
        "Railway setup and cleanup failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

async function controllerFor({
  config,
  journal,
  directory,
  api,
  distribute,
  signal,
  outputDir,
  dependenciesExecute,
  requestHealth = fetch,
  supervision = verifySupervisor,
}) {
  const journalPath = join(directory, "journal.json");
  let sequence = 0;
  let timer;
  let ending = false;
  let cleanupPromise;
  let mutations = Promise.resolve();
  let setupPromise = Promise.resolve();
  const save = async () => {
    await durableJson(journalPath, journal);
    await durableJson(
      join(directory, `checkpoint-${randomUUID()}.json`),
      journal,
    );
    if (outputDir)
      await durableJson(join(outputDir, "railway-environment.json"), journal);
  };
  const check = async () => {
    signal?.throwIfAborted();
    await supervision(config);
    assert.ok(
      !ending && Date.now() < Date.parse(journal.expiresAt) - 5 * 60 * 1000,
      "Environment lifetime budget exhausted; teardown required",
    );
    const current = JSON.parse(
      await readFile(
        join(config.controlDirectory, "active-run", "lease.json"),
        "utf8",
      ),
    );
    assert.equal(current.token, journal.lease.token, "Controller lease lost");
  };
  const publish = async () => {
    if (!journal.environmentId) return;
    await publishSnapshot(config.recordsFile, { run: record(journal) });
    journal.distribution = await distribute(
      config.recordsFile,
      config.consumers,
    );
    await save();
  };
  async function ownedEnvironment(environmentId) {
    assert.ok(
      environmentId !== config.permanentRunner?.environmentId &&
        environmentId !== process.env.RAILWAY_ENVIRONMENT_ID,
      "Permanent runner environment is protected",
    );
    assert.ok(
      journal.environments.some((e) => e.id === environmentId),
      "Environment was not returned by provider",
    );
    assert.ok(!policy.forbiddenEnvironmentIds.includes(environmentId));
    const value = await api.environment(environmentId);
    const expected = journal.environments.find((e) => e.id === environmentId);
    assert.equal(value.projectId, journal.projectId);
    assert.equal(value.name, expected.name);
    assert.equal(value.createdAt, expected.createdAt);
    if (environmentId === journal.environmentId)
      assert.equal(
        value.sourceEnvironment?.id,
        journal.environments[0].id,
        "Run environment is not the owned fork",
      );
    return value;
  }
  async function inventory() {
    return {
      environments: await api.list("environments", journal.projectId),
      services: await api.list("services", journal.projectId),
      volumes: await api.list("volumes", journal.projectId),
    };
  }
  async function create(kind, name, variables, scope) {
    await check();
    const before = await inventory();
    const intent = {
      serial: sequence++,
      kind,
      name,
      scope,
      startedAt: new Date().toISOString(),
      beforeIds: (kind === "createEnvironment"
        ? before.environments
        : kind === "createService"
          ? before.services
          : before.volumes
      ).map((v) => v.id),
      status: "pending",
    };
    journal.intents.push(intent);
    await save();
    const value = await api.request(kind, { input: variables });
    id(value.id);
    assert.equal(value.projectId, journal.projectId);
    intent.resultId = value.id;
    intent.status = "returned";
    await save();
    return value;
  }
  async function ownedService(service) {
    assert.ok(
      service.id !== config.permanentRunner?.serviceId &&
        service.id !== process.env.RAILWAY_SERVICE_ID,
      "Permanent runner service is protected",
    );
    assert.ok(
      !policy.permanentServices.some(
        (s) => s.serviceId === service.id || s.name === service.name,
      ),
      "Permanent service is never a mutation target",
    );
    const env = await ownedEnvironment(journal.environmentId);
    const found = env.serviceInstances.find((s) => s.serviceId === service.id);
    assert.ok(found, "Owned service instance missing");
    assert.equal(found.serviceName, service.name);
    assert.equal(found.environmentId, journal.environmentId);
    assert.equal(
      found.source?.image,
      service.image,
      "Owned service image drift",
    );
    const projectService = (await api.list("services", journal.projectId)).find(
      (s) => s.id === service.id,
    );
    assert.equal(projectService?.name, service.name);
    assert.equal(projectService?.projectId, journal.projectId);
    // A disposable service must not acquire an instance in any other environment.
    for (const other of await api.list("environments", journal.projectId))
      if (other.id !== journal.environmentId) {
        const observed = await api.environment(other.id);
        assert.ok(
          !observed.serviceInstances.some((s) => s.serviceId === service.id),
          "Service escaped run environment",
        );
      }
    return found;
  }
  async function storage() {
    const env = await ownedEnvironment(journal.environmentId);
    const values = [];
    for (const volume of journal.volumes) {
      const v = env.volumeInstances.find((item) => item.volumeId === volume.id);
      assert.ok(v && !v.isPendingDeletion, "Owned volume missing/deleting");
      assert.equal(v.serviceId, volume.serviceId);
      assert.equal(v.mountPath, volume.mountPath);
      values.push({
        id: volume.id,
        instanceId: v.id,
        serviceId: v.serviceId,
        mountPath: v.mountPath,
      });
    }
    return values.sort((a, b) => a.id.localeCompare(b.id));
  }
  async function inspectionVariables(spec, specs) {
    const context = {
      runId: journal.runId,
      token: config.inspection.token,
      expiresAt: journal.expiresAt,
    };
    if (spec.roles.includes("native-backend"))
      return {
        RICH_NATIVE_INSPECTION_JSON: JSON.stringify({
          ...context,
          root: spec.volume.mountPath,
          framework: spec.framework,
          bootstrapTables: config.nativeBootstrapTables ?? {},
        }),
      };
    if (!spec.roles.includes("inspection-worker")) return {};
    const host = (key) =>
      bindServiceVariables(`{{service:${key}:host}}`, specs, journal);
    const db = config.database;
    assert.ok(db, "Owned database configuration required");
    const databaseUrl = new URL(
      `postgresql://${host(db.serviceKey)}:5432/${encodeURIComponent(db.database)}`,
    );
    databaseUrl.username = db.user;
    databaseUrl.password = db.password;
    const cache = specs.find((s) => s.roles.includes("cache"));
    const redisUrl = new URL(`redis://${host(cache.key)}:6379`);
    redisUrl.password = cache.env?.REDIS_PASSWORD ?? "";
    const worker = {
      ...context,
      projectId: journal.projectId,
      environmentId: journal.environmentId,
      runnerUrl: config.inspection.runnerUrl,
      databaseUrl: databaseUrl.href,
      redisUrl: redisUrl.href,
      native: Object.fromEntries(
        specs
          .filter((s) => s.roles.includes("native-backend"))
          .map((s) => [s.framework, `http://${host(s.key)}:9191/inspect`]),
      ),
      scopes: Object.fromEntries(
        Object.entries(config.scopes).map(([framework, scope]) => [
          framework,
          { organizationId: scope.organizationId, userId: scope.userId },
        ]),
      ),
    };
    if (config.bootstrap) {
      worker.bootstrapSeed = Buffer.from(
        await readFile(config.bootstrap.scriptPath, "utf8"),
      ).toString("base64");
      worker.bootstrapConfig = specs.find(
        (s) => s.key === config.bootstrap.serviceKey,
      ).env.BOOTSTRAP_CONFIG_B64;
    }
    return { RICH_INSPECTION_CONFIG_JSON: JSON.stringify(worker) };
  }
  async function health(service, before) {
    const deadline = Math.min(
      Date.now() + 180_000,
      Date.parse(journal.expiresAt) - 5 * 60 * 1000,
    );
    while (Date.now() < deadline) {
      await check();
      const found = await ownedService(service);
      const d = found.latestDeployment;
      const instances =
        d?.instances
          ?.filter((i) => i.status === "RUNNING")
          .map((i) => i.id)
          .sort() ?? [];
      if (["FAILED", "CRASHED", "REMOVED"].includes(d?.status))
        throw new Error(`Deployment failed: ${service.key}`);
      if (
        d?.status === "SUCCESS" &&
        instances.length === 1 &&
        (!before ||
          instances.every((instance) => !before.instances.includes(instance)))
      ) {
        let ready =
          service.endpoints.length ===
            service.healthchecks.filter((h) => !h.kind || h.kind === "http")
              .length &&
          (await serviceReady({
            journal,
            config,
            service,
            execute: dependenciesExecute,
          }));
        for (const endpoint of service.endpoints) {
          try {
            const response = await requestHealth(endpoint.url, {
              redirect: "error",
              signal: AbortSignal.timeout(5000),
            });
            ready &&= response.ok;
            await response.body?.cancel();
          } catch {
            ready = false;
          }
        }
        if (ready)
          return { deploymentId: d.id, instances, store: await storage() };
      }
      await delay(1000);
    }
    throw new Error(`Readiness timed out: ${service.key}`);
  }
  async function reconcileIntents() {
    for (const intent of journal.intents) {
      if (intent.status === "recorded" || intent.status === "absent") continue;
      const observed = await inventory();
      let candidates;
      if (intent.kind === "createEnvironment")
        candidates = observed.environments.filter(
          (e) =>
            e.projectId === journal.projectId &&
            e.name === intent.name &&
            (!intent.scope || e.sourceEnvironment?.id === intent.scope),
        );
      else if (intent.kind === "createService") {
        const env = await ownedEnvironment(intent.scope);
        candidates = observed.services.filter(
          (s) =>
            s.name === intent.name &&
            s.projectId === journal.projectId &&
            env.serviceInstances.some((i) => i.serviceId === s.id),
        );
      } else if (intent.kind === "createProxy") {
        await ownedService(journal.services.find((s) => s.id === intent.scope));
        candidates = (
          await api.request("proxies", {
            environmentId: journal.environmentId,
            serviceId: intent.scope,
          })
        ).filter((p) => p.applicationPort === intent.port);
      } else if (intent.kind === "domain") {
        const env = await ownedEnvironment(journal.environmentId);
        candidates =
          env.serviceInstances
            .find((s) => s.serviceId === intent.scope)
            ?.domains?.serviceDomains.filter(
              (d) => d.targetPort === intent.port,
            ) ?? [];
      } else
        candidates = observed.volumes.filter((v) => {
          assert.equal(
            v.volumeInstances.pageInfo.hasNextPage,
            false,
            "Incomplete volume ownership",
          );
          return (
            v.projectId === journal.projectId &&
            v.volumeInstances.edges.some(
              (e) =>
                e.node.serviceId === intent.scope &&
                e.node.environmentId === journal.environmentId,
            )
          );
        });
      candidates = candidates.filter(
        (c) =>
          !intent.beforeIds.includes(c.id) &&
          (!c.createdAt ||
            Date.parse(c.createdAt) >= Date.parse(intent.startedAt) - 1000),
      );
      if (intent.resultId)
        candidates = candidates.filter((c) => c.id === intent.resultId);
      if (!candidates.length)
        throw new Error(
          "Creation outcome remains unknown; retain lease and reconcile provider inventory again",
        );
      assert.equal(
        candidates.length,
        1,
        "Ambiguous creation ownership requires operator reconciliation",
      );
      const value = candidates[0];
      if (
        intent.kind === "createEnvironment" &&
        !journal.environments.some((e) => e.id === value.id)
      )
        journal.environments.push(value);
      if (
        intent.kind === "createService" &&
        !journal.services.some((s) => s.id === value.id)
      ) {
        const expected = intent.service;
        assert.ok(expected, "Missing exact service creation intent");
        journal.services.push({ ...expected, id: value.id });
      }
      if (
        intent.kind === "createProxy" &&
        !journal.proxies.some((p) => p.id === value.id)
      )
        journal.proxies.push(value);
      if (
        intent.kind === "domain" &&
        !journal.domains.some((d) => d.id === value.id)
      )
        journal.domains.push({
          id: value.id,
          serviceId: intent.scope,
          domain: value.domain,
        });
      if (
        intent.kind === "createVolume" &&
        !journal.volumes.some((v) => v.id === value.id)
      )
        journal.volumes.push({
          id: value.id,
          serviceId: intent.scope,
          mountPath: intent.mountPath,
        });
      if (intent.kind === "createEnvironment" && intent.scope)
        journal.environmentId = value.id;
      intent.status = "recorded";
      intent.resultId = value.id;
      intent.reconciledFromProvider = true;
      await save();
    }
  }
  async function removeConfirmed(kind, resource) {
    assert.ok(
      ![
        config.permanentRunner?.serviceId,
        config.permanentRunner?.volumeId,
        config.permanentRunner?.environmentId,
        process.env.RAILWAY_SERVICE_ID,
        process.env.RAILWAY_VOLUME_ID,
        process.env.RAILWAY_ENVIRONMENT_ID,
      ]
        .filter(Boolean)
        .includes(resource.id),
      "Permanent runner resource is protected",
    );
    const listKind =
      kind === "deleteVolume"
        ? "volumes"
        : kind === "deleteEnvironment"
          ? "environments"
          : "services";
    if (
      !(await api.list(listKind, journal.projectId)).some(
        (v) => v.id === resource.id,
      )
    )
      return;
    if (kind === "deleteService") await ownedService(resource);
    else if (kind === "deleteEnvironment") {
      const env = await ownedEnvironment(resource.id);
      assert.equal(
        env.serviceInstances.length,
        0,
        "Environment still contains service instances",
      );
      assert.equal(
        env.volumeInstances.length,
        0,
        "Environment still contains volumes",
      );
    } else {
      const volume = (await api.list("volumes", journal.projectId)).find(
        (v) => v.id === resource.id,
      );
      assert.equal(volume.projectId, journal.projectId);
      assert.equal(volume.volumeInstances.pageInfo.hasNextPage, false);
      for (const { node: v } of volume.volumeInstances.edges) {
        assert.equal(v.environmentId, journal.environmentId);
        assert.ok(
          v.serviceId === resource.serviceId || v.serviceId === null,
          "Volume attached to another service",
        );
        assert.equal(v.mountPath, resource.mountPath);
      }
    }
    await api.request(
      kind,
      kind === "deleteVolume"
        ? { volumeId: resource.id }
        : kind === "deleteService"
          ? { id: resource.id }
          : { id: resource.id },
    );
    const deadline = Date.now() + 30_000;
    while (
      (await api.list(listKind, journal.projectId)).some(
        (v) => v.id === resource.id,
      )
    ) {
      assert.ok(Date.now() < deadline, `${kind} not confirmed`);
      await delay(500);
    }
  }
  function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    ending = true;
    clearTimeout(timer);
    cleanupPromise = (async () => {
      if (journal.phase !== "complete") journal.phase = "teardown";
      await save();
      try {
        await closeInspection({
          controlDirectory: config.controlDirectory,
          runId: journal.runId,
        });
      } catch (error) {
        if (error.code !== "ENOENT") journal.inspectionRevocation = "failed";
      }
      await setupPromise.catch(() => {});
      await mutations.catch(() => {});
      // Setup may have created the channel while cancellation was being handled.
      try {
        await closeInspection({
          controlDirectory: config.controlDirectory,
          runId: journal.runId,
        });
      } catch (error) {
        if (error.code !== "ENOENT") journal.inspectionRevocation = "failed";
      }
      const lock = join(directory, "cleanup-lock");
      await mkdir(lock, { mode: 0o700 });
      // A crash deliberately leaves this lock and the run lease; reconciliation must be explicit.
      try {
        let reconciliationFailure;
        try {
          await reconcileIntents();
        } catch (error) {
          reconciliationFailure = error;
        }
        const failures = [];
        const attempt = async (operation) => {
          try {
            await operation();
          } catch (error) {
            failures.push(error);
          }
        };
        if (journal.phase !== "complete") journal.phase = "teardown";
        await save();
        let distributionFailure;
        try {
          await publish();
        } catch (error) {
          distributionFailure = error;
        }
        // Distribution outage cannot prevent emergency deletion of already verified owned resources.
        for (const proxy of (journal.proxies ?? []).toReversed()) {
          await attempt(async () => {
            const service = journal.services.find(
              (s) => s.id === proxy.serviceId,
            );
            if (
              !(await api.list("services", journal.projectId)).some(
                (s) => s.id === service.id,
              )
            )
              return;
            await ownedService(service);
            const args = {
              environmentId: journal.environmentId,
              serviceId: service.id,
            };
            const current = (await api.request("proxies", args)).find(
              (p) => p.id === proxy.id,
            );
            if (current) {
              assert.equal(current.serviceId, service.id);
              assert.equal(current.environmentId, journal.environmentId);
              assert.equal(current.applicationPort, proxy.applicationPort);
              await api.request("deleteProxy", { id: proxy.id });
              assert.ok(
                !(await api.request("proxies", args)).some(
                  (p) => p.id === proxy.id,
                ),
                "TCP proxy deletion not confirmed",
              );
            }
          });
        }
        for (const service of journal.services.toReversed())
          await attempt(() => removeConfirmed("deleteService", service));
        for (const volume of journal.volumes.toReversed())
          await attempt(() => removeConfirmed("deleteVolume", volume));
        // Do not delete an environment while a create outcome in it remains unknown.
        if (!reconciliationFailure)
          for (const environment of journal.environments.toReversed())
            await attempt(() =>
              removeConfirmed("deleteEnvironment", environment),
            );
        if (reconciliationFailure) failures.push(reconciliationFailure);
        if (failures.length)
          throw new AggregateError(
            failures,
            "Owned cleanup incomplete; retained lease requires reconciliation",
          );
        const after = await inventory();
        assert.ok(
          !after.services.some((s) =>
            journal.services.some((r) => r.id === s.id),
          ) &&
            !after.volumes.some((s) =>
              journal.volumes.some((r) => r.id === s.id),
            ) &&
            !after.environments.some((s) =>
              journal.environments.some((r) => r.id === s.id),
            ),
          "Owned resource remains after cleanup",
        );
        journal.cleanup = {
          status: "passed",
          verifiedAt: new Date().toISOString(),
          serviceIds: journal.services.map((s) => s.id),
          volumeIds: journal.volumes.map((v) => v.id),
          environmentIds: journal.environments.map((e) => e.id),
        };
        journal.withinLifetime = Date.now() <= Date.parse(journal.expiresAt);
        journal.cleanup.deadlineExceeded = !journal.withinLifetime;
        journal.phase = "complete";
        await save();
        await publish();
        if (distributionFailure) journal.recoveredDistributionFailure = true;
        await release(config.controlDirectory, journal.lease);
        return journal.cleanup;
      } catch (error) {
        journal.cleanup = {
          status: "failed",
          recordedAt: new Date().toISOString(),
        };
        if (journal.phase !== "complete") journal.phase = "interrupted";
        await save();
        try {
          await publish();
        } catch {
          /* Journal and held lease remain authoritative for failed distribution. */
        }
        throw error;
      } finally {
        await rm(lock, { recursive: true });
        signal?.removeEventListener("abort", onAbort);
      }
    })();
    return cleanupPromise;
  }
  const onAbort = () => {
    // Event callbacks cannot await. Callers/supervisor also await this same promise;
    // persist failure and emit a value-free diagnostic instead of losing rejection.
    void cleanup().catch(() => {
      console.error("Railway cleanup failed; durable lease remains held");
    });
  };
  const environment = {
    baseline: config.baseline,
    scopes: {},
    receipt: journal,
    cleanup,
    observe: async (framework, operation, threadId) => {
      await check();
      assert.ok(Object.hasOwn(environment.scopes, framework));
      return (dependenciesExecute ?? inspectOperation)({
        journal,
        config,
        operation,
        input: { framework, threadId },
      });
    },
    async verifyCleanScope() {
      await check();
      for (const service of journal.services) await ownedService(service);
      await storage();
      const report = await inspectRemoteStores({
        api,
        journal,
        config,
        execute: dependenciesExecute,
      });
      journal.cleanScope = report;
      await save();
      assert.equal(report.status, "passed", "Remote stores contain data");
      return report;
    },
    restart(roles, framework) {
      roles = Array.isArray(roles) ? roles : [roles];
      assert.ok(
        roles.length &&
          roles.every((r) =>
            [
              "intelligence-api",
              "intelligence-gateway",
              "application-runtime",
              "native-backend",
            ].includes(r),
          ),
        "Only application roles may restart",
      );
      const operation = mutations.then(async () => {
        await check();
        const selected = journal.services.filter(
          (s) =>
            s.roles.some((r) => roles.includes(r)) &&
            (!s.framework || s.framework === framework),
        );
        assert.ok(selected.length, "No matching owned physical service");
        const receipts = [];
        for (const service of selected) {
          const before = await health(service);
          await check();
          await api.request("restart", { id: before.deploymentId });
          const after = await health(service, before);
          assert.deepEqual(
            after.store,
            before.store,
            "Restart changed durable stores",
          );
          const receipt = {
            owner: journal.runId,
            service: service.name,
            serviceId: service.id,
            roles: service.roles.filter((r) =>
              [
                "intelligence-api",
                "intelligence-gateway",
                "application-runtime",
                "native-backend",
              ].includes(r),
            ),
            before: {
              instance: before.instances.join(","),
              store: before.store,
            },
            after: { instance: after.instances.join(","), store: after.store },
            readyRoles: service.healthchecks.map((h) => h.role),
            ready: true,
          };
          journal.restarts.push(receipt);
          receipts.push(receipt);
          await save();
        }
        return receipts;
      });
      mutations = operation;
      return operation;
    },
  };
  async function setup(specs) {
    await save();
    timer = setTimeout(
      onAbort,
      Math.max(1, Date.parse(journal.expiresAt) - 5 * 60 * 1000 - Date.now()),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    const anchor = await create(
      "createEnvironment",
      `${journal.environmentName}-source`,
      {
        projectId: journal.projectId,
        name: `${journal.environmentName}-source`,
        ephemeral: true,
        skipInitialDeploys: true,
      },
    );
    journal.environments.push(anchor);
    journal.intents.at(-1).status = "recorded";
    await save();
    const anchorState = await ownedEnvironment(anchor.id);
    assert.equal(
      anchorState.serviceInstances.length,
      0,
      "Source environment is not empty",
    );
    assert.equal(anchorState.volumeInstances.length, 0);
    const fork = await create(
      "createEnvironment",
      journal.environmentName,
      {
        projectId: journal.projectId,
        name: journal.environmentName,
        ephemeral: true,
        skipInitialDeploys: true,
        sourceEnvironmentId: anchor.id,
      },
      anchor.id,
    );
    journal.environments.push(fork);
    journal.environmentId = fork.id;
    journal.intents.at(-1).status = "recorded";
    await save();
    const state = await ownedEnvironment(fork.id);
    assert.equal(state.serviceInstances.length, 0);
    assert.equal(state.volumeInstances.length, 0);
    await publish();
    await initializeInspection({
      controlDirectory: config.controlDirectory,
      runId: journal.runId,
      token: config.inspection.token,
      expiresAt: journal.expiresAt,
    });
    for (const spec of specs) {
      const name = `${journal.environmentName}-${spec.key}`;
      const service = {
        key: spec.key,
        name,
        image: spec.image,
        roles: spec.roles,
        framework: spec.framework,
        healthchecks: spec.healthchecks,
        endpoints: [],
      };
      // Save exact intent before remote creation, including only nonsecret resource identity.
      await check();
      const before = await api.list("services", journal.projectId);
      const intent = {
        kind: "createService",
        name,
        scope: fork.id,
        startedAt: new Date().toISOString(),
        beforeIds: before.map((s) => s.id),
        service,
        status: "pending",
      };
      journal.intents.push(intent);
      await save();
      const returned = await api.request("createService", {
        input: {
          projectId: journal.projectId,
          environmentId: fork.id,
          name,
          source: { image: spec.image },
          variables: {
            ...(await inspectionVariables(spec, specs)),
            ...Object.fromEntries(
              Object.entries(spec.env ?? {}).map(([key, value]) => [
                key,
                bindServiceVariables(value, specs, journal),
              ]),
            ),
          },
        },
      });
      if (
        process.env.RICH_CRASH_AFTER_RESOURCE === "1" &&
        process.env.RICH_CRASH_STAGE === "ambiguous-create"
      ) {
        const runnerPid = Number(process.env.RICH_RUNNER_PID);
        assert.ok(
          process.env.RAILWAY_SERVICE_ID &&
            Number.isSafeInteger(runnerPid) &&
            runnerPid > 0 &&
            runnerPid !== process.pid,
        );
        await durableJson(join(directory, "crash-control.json"), {
          runId: journal.runId,
          stage: "ambiguous-create",
          at: new Date().toISOString(),
        });
        process.kill(runnerPid, "SIGKILL");
        await new Promise(() => {});
      }
      id(returned.id);
      assert.equal(returned.projectId, journal.projectId);
      service.id = returned.id;
      journal.services.push(service);
      intent.resultId = returned.id;
      intent.status = "recorded";
      await save();
      await publish();
      if (spec.volume) {
        await check();
        const beforeVolumes = await api.list("volumes", journal.projectId);
        const volumeIntent = {
          kind: "createVolume",
          name: `${name}-data`,
          scope: service.id,
          mountPath: spec.volume.mountPath,
          startedAt: new Date().toISOString(),
          beforeIds: beforeVolumes.map((v) => v.id),
          status: "pending",
        };
        journal.intents.push(volumeIntent);
        await save();
        const volume = await api.request("createVolume", {
          input: {
            projectId: journal.projectId,
            environmentId: fork.id,
            serviceId: service.id,
            mountPath: spec.volume.mountPath,
          },
        });
        id(volume.id);
        assert.equal(volume.projectId, journal.projectId);
        journal.volumes.push({
          id: volume.id,
          serviceId: service.id,
          mountPath: spec.volume.mountPath,
        });
        volumeIntent.resultId = volume.id;
        volumeIntent.status = "recorded";
        await save();
        await publish();
        if (process.env.RICH_CRASH_AFTER_RESOURCE === "1") {
          const runnerPid = Number(process.env.RICH_RUNNER_PID);
          assert.ok(
            process.env.RAILWAY_SERVICE_ID &&
              Number.isSafeInteger(runnerPid) &&
              runnerPid > 0 &&
              runnerPid !== process.pid,
            "Crash control requires hosted runner",
          );
          await durableJson(join(directory, "crash-control.json"), {
            runId: journal.runId,
            serviceId: service.id,
            volumeId: volume.id,
            stage: "recorded-owned-volume",
            at: new Date().toISOString(),
          });
          process.kill(runnerPid, "SIGKILL");
          await new Promise(() => {});
        }
      }
      await check();
      await ownedService(service);
      await api.request("configure", {
        serviceId: service.id,
        environmentId: fork.id,
        input: {
          source: { image: spec.image },
          numReplicas: 1,
          restartPolicyType: "NEVER",
          ...(spec.startCommand ? { startCommand: spec.startCommand } : {}),
          ...(spec.preDeployCommand
            ? { preDeployCommand: spec.preDeployCommand }
            : {}),
        },
      });
      for (const endpointCheck of spec.healthchecks.filter(
        (h) => !h.kind || h.kind === "http",
      )) {
        await check();
        const reused = journal.domains.find(
          (d) => d.serviceId === service.id && d.port === endpointCheck.port,
        );
        if (reused) {
          service.endpoints.push({
            role: endpointCheck.role,
            url: new URL(endpointCheck.path, `https://${reused.domain}`).href,
          });
          await save();
          continue;
        }
        const previous =
          (await ownedService(service)).domains?.serviceDomains ?? [];
        const domainIntent = {
          kind: "domain",
          scope: service.id,
          port: endpointCheck.port,
          beforeIds: previous.map((d) => d.id),
          startedAt: new Date().toISOString(),
          status: "pending",
        };
        journal.intents.push(domainIntent);
        await save();
        const domain = await api.request("domain", {
          input: {
            environmentId: fork.id,
            serviceId: service.id,
            targetPort: endpointCheck.port,
          },
        });
        id(domain.id);
        assert.equal(domain.serviceId, service.id);
        assert.equal(domain.environmentId, fork.id);
        domainIntent.resultId = domain.id;
        domainIntent.status = "recorded";
        journal.domains.push({
          id: domain.id,
          serviceId: service.id,
          domain: domain.domain,
          port: endpointCheck.port,
        });
        service.endpoints.push({
          role: endpointCheck.role,
          url: new URL(endpointCheck.path, `https://${domain.domain}`).href,
        });
        await save();
        await publish();
      }
      if (spec.tcpPort) {
        await check();
        await ownedService(service);
        const args = { environmentId: fork.id, serviceId: service.id };
        const previous = await api.request("proxies", args);
        const proxyIntent = {
          kind: "createProxy",
          scope: service.id,
          port: spec.tcpPort,
          beforeIds: previous.map((p) => p.id),
          startedAt: new Date().toISOString(),
          status: "pending",
        };
        journal.intents.push(proxyIntent);
        await save();
        const proxy = await api.request("createProxy", {
          input: { ...args, applicationPort: spec.tcpPort },
        });
        id(proxy.id);
        assert.equal(proxy.environmentId, fork.id);
        assert.equal(proxy.serviceId, service.id);
        assert.equal(proxy.applicationPort, spec.tcpPort);
        journal.proxies.push(proxy);
        proxyIntent.resultId = proxy.id;
        proxyIntent.status = "recorded";
        await save();
        await publish();
      }
      await check();
      await api.request("deploy", {
        serviceId: service.id,
        environmentId: fork.id,
      });
      if (!service.roles.some((r) => ["database", "cache"].includes(r)))
        service.ready = await health(service);
      if (service.roles.includes("inspection-worker")) {
        for (const data of journal.services.filter((s) =>
          s.roles.some((r) => ["database", "cache"].includes(r)),
        ))
          data.ready = await health(data);
      }
      await save();
      if (config.bootstrap?.afterServiceKey === spec.key) {
        await check();
        const database = journal.services.find(
          (s) => s.key === config.bootstrap.serviceKey,
        );
        await ownedService(database);
        await storage();
        journal.bootstrap = await runBootstrap({
          config,
          journal,
          service: database,
          execute: dependenciesExecute,
        });
        await check();
        await save();
      }
    }
    journal.phase = "ready";
    await save();
    await publish();
    for (const [framework, scope] of Object.entries(config.scopes ?? {})) {
      const resolved = bindBootstrap(structuredClone(scope), journal.bootstrap);
      resolved.owner = journal.runId;
      resolved.framework = framework;
      resolved.provider = "railway";
      resolved.projectId = bindBootstrap(scope.projectId, journal.bootstrap);
      resolved.railway = {
        projectId: journal.projectId,
        environmentId: fork.id,
      };
      for (const [field, role] of Object.entries({
        apiUrl: "intelligence-api",
        gatewayUrl: "intelligence-gateway",
        runtimeUrl: "application-runtime",
        applicationUrl: "application",
      })) {
        const target = journal.services.find(
          (s) =>
            s.roles.includes(role) &&
            (!s.framework || s.framework === framework),
        );
        resolved[field] = new URL(
          "/",
          target.endpoints.find((e) => e.role === role).url,
        ).href;
      }
      assert.ok(
        !scope.databaseUrl,
        "External databaseUrl cannot substitute for private observations",
      );
      if (scope.capture)
        resolved.capture = {
          ...scope.capture,
          url: new URL("/rich-thread-capture", resolved.runtimeUrl).href,
        };
      const native = journal.services.find(
        (s) => s.roles.includes("native-backend") && s.framework === framework,
      );
      resolved.native = {
        ...scope.native,
        remote: {
          serviceId: native.id,
          volumeId: journal.volumes.find((v) => v.serviceId === native.id)?.id,
          mountPath: specs.find((s) => s.key === native.key).volume.mountPath,
        },
      };
      environment.scopes[framework] = resolved;
    }
  }
  return {
    setup: (specs) => {
      setupPromise = setup(specs);
      return setupPromise;
    },
    cleanup,
    environment,
    reconcileIntents,
    save,
  };
}

/** Run from the same durable authority after interruption. Never infer a new empty snapshot. */
export async function recoverRailwayEnvironment(
  { config, runId, outputDir },
  dependencies = {},
) {
  await authority(config.controlDirectory);
  assert.ok(safe(runId));
  const directory = join(config.controlDirectory, runId);
  const journal = JSON.parse(
    await readFile(join(directory, "journal.json"), "utf8"),
  );
  assert.equal(journal.projectId, policy.projectId);
  assert.equal(journal.runId, runId);
  // Recovery cannot race a live controller before its deadline. Operators must stop it first.
  assert.ok(
    journal.lease.pid === process.pid || !(await ownerAlive(journal.lease)),
    "Original controller is still running; stop it before recovery",
  );
  const current = JSON.parse(
    await readFile(
      join(config.controlDirectory, "active-run", "lease.json"),
      "utf8",
    ),
  );
  assert.equal(current.token, journal.lease.token, "Recovery lease mismatch");
  const recoveryLock = join(directory, "recovery-lock");
  const releaseRecovery = await acquireRecoveryLock(recoveryLock);
  try {
    await rm(join(directory, "cleanup-lock"), { recursive: true, force: true });
    const controller = await controllerFor({
      config,
      journal,
      directory,
      api: dependencies.api ?? railwayApi(),
      distribute: dependencies.distribute ?? distributeSnapshot,
      outputDir,
      dependenciesExecute: dependencies.inspection,
      requestHealth: dependencies.fetch ?? fetch,
    });
    return await controller.cleanup();
  } finally {
    await releaseRecovery();
  }
}
