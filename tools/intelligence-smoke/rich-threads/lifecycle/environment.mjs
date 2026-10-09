import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateBaseline } from "../contract.mjs";
import { verifyCleanScope } from "./clean-scope.mjs";

const execute = promisify(execFile);
const label = "copilotkit.rich-threads.owner";
const roles = [
  "database",
  "cache",
  "intelligence-api",
  "intelligence-gateway",
  "application-runtime",
  "native-backend",
  "application",
];
const safe = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(value);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const identity = (item, resource) => ({
  instance: `${item.Id}:${item.State.StartedAt}`,
  store: resource.stores,
});

// No shell, service logs, command args, or credentials in errors.
async function docker(args) {
  try {
    const { stdout } = await execute("docker", args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    throw new Error(`Docker ${args[0]} failed or timed out`);
  }
}

/** Recover an interrupted run using its receipt AND independently verified ownership. */
export async function recoverEnvironment(
  { receiptPath, dockerHost },
  dependencies = {},
) {
  assert.match(dockerHost, /^unix:\/\//);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.version, 1);
  assert.equal(receipt.provider, "docker");
  assert.equal(receipt.purpose, "development");
  assert.ok(safe(receipt.owner));
  assert.match(
    receipt.ownershipToken,
    new RegExp(`^${receipt.owner}-[a-f0-9-]{36}$`),
  );
  assert.equal(receipt.network, `rich-${receipt.ownershipToken}`);
  assert.ok(
    isAbsolute(receipt.directory) &&
      basename(receipt.directory) === receipt.owner,
  );
  assert.equal(
    (await lstat(receipt.directory)).isDirectory(),
    true,
    "Recovery directory must not be a symlink",
  );
  assert.equal(
    await readFile(join(receipt.directory, "owner"), "utf8"),
    receipt.ownershipToken,
  );
  const executeDocker = dependencies.docker ?? docker;
  const run = (args) => executeDocker(["--host", dockerHost, ...args]);
  const failures = [];
  for (const resource of receipt.resources.toReversed()) {
    assert.ok(safe(resource.service));
    assert.equal(resource.name, `rich-${receipt.owner}-${resource.service}`);
    try {
      const listing = await run([
        "ps",
        "-a",
        "--filter",
        `name=^/${resource.name}$`,
        "--format",
        "{{.ID}}",
      ]);
      if (listing.trim()) {
        const [item] = JSON.parse(await run(["inspect", resource.name]));
        assert.equal(item.Config?.Labels?.[label], receipt.ownershipToken);
        if (resource.id) assert.equal(item.Id, resource.id);
        await run(["rm", "--force", "--volumes", item.Id]);
        assert.equal(
          (
            await run([
              "ps",
              "-a",
              "--filter",
              `name=^/${resource.name}$`,
              "--format",
              "{{.ID}}",
            ])
          ).trim(),
          "",
        );
      }
      resource.removed = true;
    } catch {
      failures.push(resource.name);
    }
  }
  if (!failures.length) {
    try {
      const networks = await run([
        "network",
        "ls",
        "--filter",
        `name=^${receipt.network}$`,
        "--format",
        "{{.Name}}",
      ]);
      if (networks.trim()) {
        const [network] = JSON.parse(
          await run(["network", "inspect", receipt.network]),
        );
        assert.equal(network.Labels?.[label], receipt.ownershipToken);
        await run(["network", "rm", receipt.network]);
        assert.equal(
          (
            await run([
              "network",
              "ls",
              "--filter",
              `name=^${receipt.network}$`,
              "--format",
              "{{.Name}}",
            ])
          ).trim(),
          "",
        );
      }
    } catch {
      failures.push(receipt.network);
    }
  }
  if (!failures.length) {
    try {
      await rm(receipt.directory, { recursive: true });
    } catch {
      failures.push("owned-data-directory");
    }
  }
  const result = {
    owner: receipt.owner,
    status: failures.length ? "failed" : "passed",
    failures,
    recoveredAt: new Date().toISOString(),
  };
  await writeFile(
    `${receiptPath}.recovery-${randomUUID()}.json`,
    JSON.stringify(result, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  if (failures.length)
    throw new Error(`Recovery cleanup failed: ${failures.join(", ")}`);
  return result;
}

function validate(config, frameworks) {
  assert.equal(
    config.purpose,
    "development",
    "Acceptance hosting/access decision and provider are not implemented",
  );
  assert.equal(
    config.provider,
    "docker",
    "Only the isolated Docker development provider is implemented",
  );
  assert.match(
    config.dockerHost,
    /^unix:\/\//,
    "Explicit local Docker socket required",
  );
  validateBaseline(config.baseline);
  assert.ok(
    isAbsolute(config.directory),
    "Absolute owned-directory parent required",
  );
  assert.ok(
    Number.isFinite(config.readinessTimeoutMs ?? 120_000) &&
      (config.readinessTimeoutMs ?? 120_000) > 0,
    "Bounded readiness deadline required",
  );
  assert.ok(
    frameworks.length && new Set(frameworks).size === frameworks.length,
  );
  assert.ok(
    frameworks.every((f) => ["mastra", "strands-typescript"].includes(f)),
    "Other framework lifecycle adapters remain unimplemented",
  );
  const services = config.services;
  assert.ok(Array.isArray(services) && services.length);
  assert.equal(new Set(services.map((s) => s.name)).size, services.length);
  for (const s of services) {
    assert.ok(
      safe(s.name) && roles.includes(s.role),
      "Invalid service name/role",
    );
    assert.match(
      s.image,
      /^(?:sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/,
      "Installable digest-pinned service image required",
    );
    assert.ok(!s.framework || frameworks.includes(s.framework));
    assert.ok(
      Array.isArray(s.mounts) && s.mounts.length,
      "Explicit durable storage binding required",
    );
    for (const mount of s.mounts) {
      assert.ok(
        safe(mount.store) && isAbsolute(mount.target),
        "Invalid storage binding",
      );
    }
    assert.ok(
      Array.isArray(s.ready) &&
        s.ready.length &&
        s.ready.every((x) => typeof x === "string"),
      "Container readiness command required",
    );
    assert.ok((s.args ?? []).every((x) => typeof x === "string"));
    for (const [key, value] of Object.entries(s.env ?? {})) {
      assert.match(key, /^[A-Z_][A-Z0-9_]*$/);
      assert.ok(
        typeof value === "string" && !/[\r\n]/.test(value),
        "Docker env file values must be single-line",
      );
    }
    for (const port of s.ports ?? [])
      assert.ok(
        Number.isInteger(port.host) &&
          port.host > 1024 &&
          port.host < 65536 &&
          Number.isInteger(port.container) &&
          port.container > 0 &&
          port.container < 65536,
      );
  }
  for (const file of config.files ?? []) {
    assert.ok(
      safe(file.store) &&
        services.some((s) => s.mounts.some((m) => m.store === file.store)),
      "Private config must use owned mounted storage",
    );
    assert.match(
      file.path,
      /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?(?:\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?)*$/,
    );
    assert.equal(typeof file.contents, "string");
  }
  for (const role of roles)
    assert.ok(
      services.some((s) => s.role === role),
      `Missing service role ${role}`,
    );
  for (const framework of frameworks) {
    assert.ok(
      services.some(
        (s) => s.role === "native-backend" && s.framework === framework,
      ),
    );
    const scope = config.scopes?.[framework];
    assert.ok(
      scope &&
        scope.userId &&
        scope.agentId &&
        scope.organizationId &&
        scope.projectId,
      "Tenant scope required",
    );
    for (const [field, role] of Object.entries({
      applicationUrl: "application",
      runtimeUrl: "application-runtime",
      apiUrl: "intelligence-api",
      gatewayUrl: "intelligence-gateway",
    })) {
      const url = new URL(scope[field]);
      assert.ok(
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
          ["http:", "https:", "ws:", "wss:"].includes(url.protocol),
        "Development scope must address owned loopback services",
      );
      assert.ok(
        services.some(
          (s) =>
            s.role === role &&
            (!s.framework || s.framework === framework) &&
            s.ports?.some((p) => p.host === Number(url.port)),
        ),
        `${field} must use an owned service port`,
      );
    }
    assert.ok(safe(scope.native?.store), "Native store name required");
    assert.ok(
      services.some(
        (s) =>
          s.framework === framework &&
          s.role === "native-backend" &&
          s.mounts.some((m) => m.store === scope.native.store),
      ),
      "Native scope must use backend-owned durable store",
    );
    for (const field of ["path", "workflowPath"])
      if (scope.native[field])
        assert.match(
          scope.native[field],
          /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?(?:\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?)*$/,
          "Native filename must stay inside its owned store",
        );
    if (scope.native.workflowStore)
      assert.ok(
        services.some(
          (s) =>
            s.framework === framework &&
            s.role === "native-backend" &&
            s.mounts.some((m) => m.store === scope.native.workflowStore),
        ),
        "Workflow scope must use backend-owned storage",
      );
  }
}

/** One private environment for the common bootstrap. Config is private; receipts are public. */
export async function createEnvironment(
  { config, runId, frameworks, outputDir, signal },
  dependencies = {},
) {
  validate(config, frameworks);
  assert.ok(safe(runId), "Safe explicit run ID required");
  signal?.throwIfAborted();
  const executeDocker = dependencies.docker ?? docker;
  const run = (args) => executeDocker(["--host", config.dockerHost, ...args]);
  const directory = join(config.directory, runId);
  // mkdir is exclusive: an interrupted or active run can never be silently reused/reset.
  await mkdir(directory, { mode: 0o700 });
  const owner = `${runId}-${randomUUID()}`;
  const network = `rich-${owner}`;
  const receipt = {
    version: 1,
    owner: runId,
    ownershipToken: owner,
    purpose: "development",
    provider: "docker",
    network,
    directory,
    status: "creating",
    cleanScope: { status: "unverified" },
    resources: [],
    cleanup: { status: "not-run" },
  };
  const receiptPath = join(outputDir, "environment.json");
  let sequence = 0;
  let networkAttempted = false;
  let cleanupPromise;
  let shuttingDown = false;
  let restarting = Promise.resolve();
  const persist = async () => {
    // Retain append-only checkpoints for recovery if a later write is interrupted.
    const data = JSON.stringify(receipt, null, 2);
    await writeFile(join(outputDir, `environment-${sequence++}.json`), data, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(receiptPath, data, { mode: 0o600 });
  };
  const inspect = async (resource) => {
    const rows = JSON.parse(await run(["inspect", resource.name]));
    assert.equal(rows.length, 1);
    const item = rows[0];
    assert.equal(
      item.Config?.Labels?.[label],
      owner,
      "Container ownership mismatch",
    );
    if (resource.id)
      assert.equal(item.Id, resource.id, "Container identity changed");
    return item;
  };
  const ready = async (spec, resource) => {
    const deadline = Date.now() + (config.readinessTimeoutMs ?? 120_000);
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      assert.ok(!shuttingDown, "Environment is shutting down");
      const item = await inspect(resource);
      assert.equal(
        item.State.Running,
        true,
        `${spec.name} exited before readiness`,
      );
      try {
        await run(["exec", resource.id, ...spec.ready]);
        return identity(await inspect(resource), resource);
      } catch {
        await pause(100);
      }
    }
    throw new Error(`${spec.name} readiness timed out`);
  };
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    shuttingDown = true;
    cleanupPromise = (async () => {
      await restarting.catch(() => {});
      const failed = [];
      for (const resource of receipt.resources.toReversed()) {
        if (resource.removed) continue;
        try {
          const listed = (
            await run([
              "ps",
              "-a",
              "--filter",
              `name=^/${resource.name}$`,
              "--format",
              "{{.ID}}",
            ])
          ).trim();
          if (listed) {
            const item = await inspect(resource);
            await run(["rm", "--force", "--volumes", item.Id]);
            assert.equal(
              (
                await run([
                  "ps",
                  "-a",
                  "--filter",
                  `name=^/${resource.name}$`,
                  "--format",
                  "{{.ID}}",
                ])
              ).trim(),
              "",
              "Container still exists",
            );
          }
          resource.removed = true;
        } catch {
          failed.push(resource.name);
        }
      }
      if (networkAttempted && !failed.length) {
        try {
          const names = await run([
            "network",
            "ls",
            "--filter",
            `name=^${network}$`,
            "--format",
            "{{.Name}}",
          ]);
          if (names.trim()) {
            const [item] = JSON.parse(
              await run(["network", "inspect", network]),
            );
            assert.equal(
              item.Labels?.[label],
              owner,
              "Network ownership mismatch",
            );
            await run(["network", "rm", network]);
            assert.equal(
              (
                await run([
                  "network",
                  "ls",
                  "--filter",
                  `name=^${network}$`,
                  "--format",
                  "{{.Name}}",
                ])
              ).trim(),
              "",
            );
          }
        } catch {
          failed.push(network);
        }
      }
      if (!failed.length) {
        try {
          assert.equal(
            (await lstat(directory)).isDirectory(),
            true,
            "Owned directory was replaced",
          );
          assert.equal(await readFile(join(directory, "owner"), "utf8"), owner);
          await rm(directory, { recursive: true });
        } catch {
          failed.push("owned-data-directory");
        }
      }
      receipt.cleanup = {
        status: failed.length ? "failed" : "passed",
        failed,
        finishedAt: new Date().toISOString(),
      };
      receipt.status = failed.length ? "cleanup-failed" : "cleaned";
      await persist();
      if (failed.length)
        throw new Error(
          `Environment cleanup failed: ${failed.join(", ")}; recovery receipt: ${receiptPath}`,
        );
      signal?.removeEventListener("abort", onAbort);
      return structuredClone(receipt.cleanup);
    })();
    return cleanupPromise;
  };
  // The caller awaits cleanup too; this handler only ensures cancellation initiates it.
  const onAbort = () => {
    void cleanup().catch(() => {});
  };
  try {
    await writeFile(join(directory, "owner"), owner, {
      flag: "wx",
      mode: 0o600,
    });
    await persist();
    const stores = [
      ...new Set(config.services.flatMap((s) => s.mounts.map((m) => m.store))),
    ];
    for (const store of stores) {
      await mkdir(join(directory, store), { mode: 0o700 });
      assert.deepEqual(await readdir(join(directory, store)), []);
    }
    for (const file of config.files ?? []) {
      const path = join(directory, file.store, file.path);
      await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
      await writeFile(path, file.contents, { flag: "wx", mode: 0o600 });
    }
    receipt.storageInitialization = {
      status: "passed",
      method: "exclusive-empty-storage",
      stores,
    };
    receipt.cleanScope = {
      status: "unverified",
      detail:
        "Common bootstrap must independently inspect initialized database, queues/cache and native stores before scenario execution.",
    };
    networkAttempted = true;
    await persist();
    await run(["network", "create", "--label", `${label}=${owner}`, network]);
    for (const spec of config.services) {
      signal?.throwIfAborted();
      const resource = {
        name: `rich-${runId}-${spec.name}`,
        service: spec.name,
        role: spec.role,
        framework: spec.framework,
        image: spec.image,
        stores: spec.mounts.map((m) => join(directory, m.store)),
        removed: false,
      };
      receipt.resources.push(resource);
      await persist(); // Intent precedes create: ambiguous create timeout remains recoverable by name+label.
      const envFile = join(directory, `${spec.name}.env`);
      await writeFile(
        envFile,
        Object.entries(spec.env ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join("\n"),
        { flag: "wx", mode: 0o600 },
      );
      const args = [
        "create",
        "--name",
        resource.name,
        "--label",
        `${label}=${owner}`,
        "--network",
        network,
        "--network-alias",
        spec.name,
        "--env-file",
        envFile,
      ];
      for (const m of spec.mounts)
        args.push(
          "--mount",
          `type=bind,source=${join(directory, m.store)},target=${m.target}`,
        );
      for (const p of spec.ports ?? [])
        args.push("--publish", `127.0.0.1:${p.host}:${p.container}`);
      args.push(spec.image, ...(spec.args ?? []));
      resource.id = await run(args);
      assert.match(resource.id, /^[a-f0-9]{64}$/);
      await persist();
      const created = await inspect(resource);
      assert.equal(
        created.Mounts.length,
        spec.mounts.length,
        "Unmanaged image storage volume",
      );
      for (const m of spec.mounts)
        assert.ok(
          created.Mounts.some(
            (actual) =>
              actual.Type === "bind" &&
              actual.Source === join(directory, m.store) &&
              actual.Destination === m.target,
          ),
          "Unexpected container storage binding",
        );
      await run(["start", resource.id]);
      resource.started = await ready(spec, resource);
      await persist();
    }
    const scopes = Object.fromEntries(
      frameworks.map((framework) => {
        const scope = structuredClone(config.scopes[framework]);
        scope.owner = runId;
        scope.framework = framework;
        if (scope.capture?.store) {
          assert.ok(
            stores.includes(scope.capture.store),
            "Capture store must be owned",
          );
          scope.capture.directory = join(directory, scope.capture.store);
        }
        scope.native.location = join(
          directory,
          scope.native.store,
          scope.native.path ?? "",
        );
        if (scope.native.workflowStore)
          scope.native.workflowLocation = join(
            directory,
            scope.native.workflowStore,
            scope.native.workflowPath ?? "",
          );
        scope.resources = receipt.resources
          .filter((r) => !r.framework || r.framework === framework)
          .map((r) => ({ service: r.service, role: r.role }));
        return [framework, scope];
      }),
    );
    receipt.status = "ready";
    await persist();
    signal?.throwIfAborted();
    signal?.addEventListener("abort", onAbort, { once: true });
    return {
      baseline: structuredClone(config.baseline),
      scopes,
      receipt,
      async verifyCleanScope({
        pool,
        redis,
        bootstrapTables,
        nativeBootstrapTables,
      }) {
        assert.equal(
          receipt.status,
          "ready",
          "Verify clean scope before scenario execution",
        );
        signal?.throwIfAborted();
        const nativeRoots = [
          ...new Set(
            config.services
              .filter((s) => s.role === "native-backend")
              .flatMap((s) => s.mounts.map((m) => join(directory, m.store))),
          ),
        ];
        receipt.cleanScope = await verifyCleanScope({
          pool,
          redis,
          nativeRoots,
          bootstrapTables,
          nativeBootstrapTables,
        });
        await persist();
        assert.equal(
          receipt.cleanScope.status,
          "passed",
          "Environment contains persisted data; see clean-scope receipt",
        );
        return structuredClone(receipt.cleanScope);
      },
      restart(role, framework) {
        const operation = restarting.then(async () => {
          assert.ok(!shuttingDown, "Environment is shutting down");
          signal?.throwIfAborted();
          assert.ok(
            [
              "intelligence-api",
              "intelligence-gateway",
              "application-runtime",
              "native-backend",
            ].includes(role),
            "Only row5 application roles may restart",
          );
          const selected = receipt.resources.filter(
            (r) =>
              r.role === role && (!r.framework || r.framework === framework),
          );
          assert.ok(selected.length, `No owned ${role} resource`);
          const result = [];
          for (const resource of selected) {
            const before = identity(await inspect(resource), resource);
            await run(["restart", "--time", "10", resource.id]);
            const after = await ready(
              config.services.find((s) => s.name === resource.service),
              resource,
            );
            assert.notEqual(
              after.instance,
              before.instance,
              "Container did not restart",
            );
            const entry = {
              service: resource.service,
              role,
              owner: runId,
              before,
              after,
              ready: true,
            };
            result.push(entry);
            (receipt.restarts ??= []).push(entry);
            await persist();
          }
          return result;
        });
        restarting = operation;
        return operation;
      },
      cleanup,
    };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      // Both original failures are retained in AggregateError.errors.
      // eslint-disable-next-line preserve-caught-error
      throw new AggregateError(
        [error, cleanupError],
        "Environment setup and cleanup failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
