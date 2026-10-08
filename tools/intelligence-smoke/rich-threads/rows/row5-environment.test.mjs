import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createEnvironment,
  recoverEnvironment,
} from "../lifecycle/environment.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "row5-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = join(root, "evidence");
  await mkdir(outputDir);
  const roles = [
    "database",
    "cache",
    "intelligence-api",
    "intelligence-gateway",
    "application-runtime",
    "native-backend",
    "application",
  ];
  const config = {
    purpose: "development",
    provider: "docker",
    dockerHost: "unix:///test/docker.sock",
    directory: root,
    baseline: {
      sources: {
        copilotkit: "a".repeat(40),
        intelligence: "b".repeat(40),
        agUi: "c".repeat(40),
      },
      packages: { fixture: "1.0.0" },
      fixtureProvenance: "Lifecycle fault injection only",
    },
    services: roles.map((role, i) => ({
      name: `service-${i}`,
      role,
      ...(role === "native-backend" ? { framework: "mastra" } : {}),
      image: `example/service@sha256:${"d".repeat(64)}`,
      mounts: [{ store: `store-${i}`, target: "/data" }],
      ready: ["true"],
      ports: [{ host: 48000 + i, container: 3000 }],
      env: { PRIVATE_KEY: "never-publish-this" },
    })),
    scopes: {
      mastra: {
        userId: "user",
        agentId: "agent",
        organizationId: "org",
        projectId: "1",
        applicationUrl: "http://localhost:48006",
        runtimeUrl: "http://localhost:48004",
        apiUrl: "http://localhost:48002",
        gatewayUrl: "ws://localhost:48003",
        native: { store: "store-5" },
        credentials: { apiKey: "also-private" },
      },
    },
  };
  const containers = new Map();
  const networks = new Map();
  const calls = [];
  let next = 0;
  const state = { failCreateAt: null, failRemove: false, foreign: false };
  const docker = async (command) => {
    assert.deepEqual(command.slice(0, 2), ["--host", config.dockerHost]);
    const args = command.slice(2);
    calls.push(args);
    const value = (flag) => args[args.indexOf(flag) + 1];
    const find = (id) =>
      [...containers.values()].find((c) => c.Id === id || c.Name === id);
    if (args[0] === "network") {
      if (args[1] === "create") {
        const [key, owner] = value("--label").split("=");
        networks.set(args.at(-1), { Labels: { [key]: owner } });
        return "network-id";
      }
      if (args[1] === "ls") return [...networks.keys()].join("\n");
      if (args[1] === "inspect") return JSON.stringify([networks.get(args[2])]);
      if (args[1] === "rm") {
        networks.delete(args[2]);
        return "";
      }
    }
    if (args[0] === "create") {
      const [key, owner] = value("--label").split("=");
      const id = (++next).toString(16).padStart(64, "0");
      const mounts = args.flatMap((a, i) =>
        a === "--mount"
          ? [
              Object.fromEntries(
                args[i + 1].split(",").map((p) => p.split("=")),
              ),
            ]
          : [],
      );
      containers.set(value("--name"), {
        Id: id,
        Name: value("--name"),
        Config: { Labels: { [key]: owner } },
        State: { Running: false, StartedAt: "0" },
        Mounts: mounts.map((m) => ({
          Type: m.type,
          Source: m.source,
          Destination: m.target,
        })),
      });
      if (next === state.failCreateAt)
        throw new Error("ambiguous create timeout");
      return id;
    }
    if (args[0] === "inspect") {
      const item = structuredClone(find(args[1]));
      if (state.foreign)
        item.Config.Labels["copilotkit.rich-threads.owner"] = "somebody-else";
      return JSON.stringify([item]);
    }
    if (args[0] === "start" || args[0] === "restart") {
      const item = find(args.at(-1));
      item.State = {
        Running: true,
        StartedAt: String(Number(item.State.StartedAt) + 1),
      };
      return item.Id;
    }
    if (args[0] === "exec") return "";
    if (args[0] === "ps") {
      const name = value("--filter").slice("name=^/".length, -1);
      return containers.get(name)?.Id ?? "";
    }
    if (args[0] === "rm") {
      if (state.failRemove) throw new Error("remove timeout");
      const item = find(args.at(-1));
      containers.delete(item.Name);
      return "";
    }
    throw new Error(`Unexpected fake Docker command: ${args[0]}`);
  };
  const create = (extra = {}) =>
    createEnvironment(
      {
        config,
        runId: "test-run",
        frameworks: ["mastra"],
        outputDir,
        ...extra,
      },
      { docker },
    );
  return {
    root,
    config,
    outputDir,
    create,
    containers,
    networks,
    calls,
    state,
    docker,
  };
}

test("isolated lifecycle restarts same durable bindings and removes all owned resources", async (t) => {
  const f = await fixture(t);
  const environment = await f.create();
  const [restart] = await environment.restart("native-backend", "mastra");
  assert.notEqual(restart.before.instance, restart.after.instance);
  assert.deepEqual(restart.before.store, restart.after.store);
  assert.equal(environment.receipt.storageInitialization.status, "passed");
  assert.equal(environment.receipt.cleanScope.status, "unverified");
  await environment.cleanup();
  assert.equal(f.containers.size, 0);
  assert.equal(f.networks.size, 0);
  assert.ok(!(await readdir(f.root)).includes("test-run"));
  const evidence = await readFile(
    join(f.outputDir, "environment.json"),
    "utf8",
  );
  assert.ok(
    !evidence.includes("never-publish-this") &&
      !evidence.includes("also-private"),
  );
  assert.equal(JSON.parse(evidence).cleanup.status, "passed");
  const output2 = join(f.root, "evidence-two");
  await mkdir(output2);
  const second = await f.create({ outputDir: output2 });
  assert.notEqual(
    second.receipt.ownershipToken,
    environment.receipt.ownershipToken,
  );
  await second.cleanup();
});

test("partial ambiguous creation cleans container discovered by exact ownership", async (t) => {
  const f = await fixture(t);
  f.state.failCreateAt = 3;
  await assert.rejects(f.create(), /ambiguous create timeout/);
  assert.equal(f.containers.size, 0);
  assert.equal(f.networks.size, 0);
  assert.equal(
    JSON.parse(await readFile(join(f.outputDir, "environment.json"))).cleanup
      .status,
    "passed",
  );
});

test("ownership mismatch refuses restart and cleanup; retains data and recovery receipt", async (t) => {
  const f = await fixture(t);
  const environment = await f.create();
  f.state.foreign = true;
  await assert.rejects(
    environment.restart("native-backend", "mastra"),
    /ownership mismatch/,
  );
  await assert.rejects(environment.cleanup(), /cleanup failed/);
  assert.equal(
    f.calls.filter((a) => a[0] === "rm" || a[0] === "restart").length,
    0,
  );
  assert.ok((await readdir(f.root)).includes("test-run"));
  const receipt = JSON.parse(
    await readFile(join(f.outputDir, "environment.json")),
  );
  assert.equal(receipt.cleanup.failed.length, 7);
});

test("cleanup failure cannot become green and keeps durable data", async (t) => {
  const f = await fixture(t);
  const environment = await f.create();
  f.state.failRemove = true;
  await assert.rejects(environment.cleanup(), /cleanup failed/);
  await assert.rejects(environment.cleanup(), /cleanup failed/);
  assert.equal(f.containers.size, 7);
  assert.ok((await readdir(f.root)).includes("test-run"));
  f.state.failRemove = false;
  const recovered = await recoverEnvironment(
    {
      receiptPath: join(f.outputDir, "environment.json"),
      dockerHost: f.config.dockerHost,
    },
    { docker: f.docker },
  );
  assert.equal(recovered.status, "passed");
  assert.equal(f.containers.size, 0);
});

test("cancellation initiates cleanup and further restart is rejected", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const environment = await f.create({ signal: controller.signal });
  controller.abort();
  await environment.cleanup();
  await assert.rejects(
    environment.restart("intelligence-api"),
    /shutting down/,
  );
  assert.equal(f.containers.size, 0);
});

test("existing directory, hosted acceptance and unpinned images fail before Docker", async (t) => {
  const f = await fixture(t);
  f.config.purpose = "acceptance";
  await assert.rejects(f.create(), /Acceptance hosting/);
  f.config.purpose = "development";
  f.config.services[0].image = "postgres:latest";
  await assert.rejects(f.create(), /digest-pinned/);
  f.config.services[0].image = `postgres@sha256:${"d".repeat(64)}`;
  await mkdir(join(f.root, "test-run"));
  await assert.rejects(f.create(), /EEXIST/);
  assert.equal(f.calls.length, 0);
});
