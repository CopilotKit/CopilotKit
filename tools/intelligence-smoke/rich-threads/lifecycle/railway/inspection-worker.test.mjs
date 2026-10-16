import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { nativeInspectionServer } from "./native-inspection.mjs";
import {
  createInspectionOperations,
  validateWorkerEnvironment,
} from "./inspection-worker.mjs";

test("private native helper scans actual WAL and opaque files, rejects arbitrary paths and expired token", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "private-native-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = new DatabaseSync(join(root, "memory.db"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE messages(id TEXT)");
  t.after(() => db.close());
  const config = {
    root,
    runId: "rich-native",
    token: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    bootstrapTables: {},
  };
  const server = nativeInspectionServer(config);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/inspect`;
  const headers = { authorization: `Bearer ${config.token}` };
  const request = () =>
    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        runId: config.runId,
        requestId: crypto.randomUUID(),
      }),
    });
  assert.equal((await (await request()).json()).report.status, "passed");
  db.exec("INSERT INTO messages VALUES ('old')");
  await writeFile(join(root, "media.bin"), "old");
  const dirty = await (await request()).json();
  assert.equal(dirty.report.status, "failed");
  assert.equal(
    dirty.report.files.find((f) => f.path === "memory.db").tables[0].count,
    1,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          runId: config.runId,
          requestId: crypto.randomUUID(),
          path: "/etc",
        }),
      })
    ).status,
    409,
  );
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  config.expiresAt = new Date(0).toISOString();
  assert.equal((await request()).status, 401);
});

test("worker reads whole database in one read-only snapshot and binds thread scopes", async () => {
  const calls = [];
  const client = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes("pg_catalog"))
        return {
          rows: [
            { schemaname: "cpki", tablename: "threads" },
            { schemaname: "public", tablename: "old_data" },
          ],
        };
      if (sql.includes("count(*)"))
        return { rows: [{ count: sql.includes("old_data") ? "3" : "0" }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client, query: client.query };
  const config = {
    scopes: {
      mastra: { organizationId: "org_owned", projectId: "17", userId: "owned" },
    },
  };
  const execute = createInspectionOperations({
    config,
    pool,
    redis: {
      ping: async () => "PONG",
      info: async () => "# Keyspace\r\ndb12:keys=2,expires=0\r\n",
    },
  });
  assert.deepEqual(await execute("readiness", { target: "database" }), {
    ready: true,
  });
  const snapshot = await execute("database-snapshot", {});
  assert.deepEqual(snapshot.counts, [
    { name: "cpki.threads", count: 0 },
    { name: "public.old_data", count: 3 },
  ]);
  assert.ok(
    calls.some(
      (c) =>
        c.sql === "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    ),
  );
  await execute("thread-events", {
    framework: "mastra",
    threadId: "thread-owned",
  });
  assert.deepEqual(calls.at(-1).args, [
    "org_owned",
    "17",
    "owned",
    "thread-owned",
  ]);
  assert.ok(calls.at(-1).sql.includes("re.deleted_at IS NULL"));
  await assert.rejects(
    execute("thread-events", {
      framework: "mastra",
      threadId: "x",
      sql: "DROP TABLE x",
    }),
  );
  await assert.rejects(execute("bootstrap", {}), /seed|bootstrap/i);
});

test("worker refuses provider identity drift, external database and Railway credentials", () => {
  const env = {
    RAILWAY_PROJECT_ID: "project",
    RAILWAY_ENVIRONMENT_ID: "environment",
  };
  const config = {
    projectId: "project",
    environmentId: "environment",
    runId: "rich-owned",
    token: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    runnerUrl: "https://runner.example",
    databaseUrl:
      "postgresql://p:p@rich-owned-postgres.railway.internal:5432/db",
    redisUrl: "redis://:p@rich-owned-redis.railway.internal:6379",
    native: {
      mastra: "http://rich-owned-mastra.railway.internal:9191/inspect",
    },
  };
  validateWorkerEnvironment(config, env);
  assert.throws(() =>
    validateWorkerEnvironment({ ...config, environmentId: "wrong" }, env),
  );
  assert.throws(() =>
    validateWorkerEnvironment(
      { ...config, databaseUrl: "postgresql://p:p@external.example/db" },
      env,
    ),
  );
  assert.throws(() =>
    validateWorkerEnvironment(config, { ...env, RAILWAY_API_TOKEN: "secret" }),
  );
});

test("native helper requires finite expiry and a bound run identity", () => {
  const config = {
    root: "/data",
    runId: "rich-owned",
    token: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  for (const expiresAt of [undefined, "invalid", new Date(0).toISOString()])
    assert.throws(
      () => nativeInspectionServer({ ...config, expiresAt }),
      /expiry/,
    );
  assert.throws(() => nativeInspectionServer({ ...config, runId: "../other" }));
});

test("actual worker polling sends fixed operations through local HTTP and propagates operation failures", async (t) => {
  const { createServer } = await import("node:http");
  const {
    initializeInspection,
    requestInspection,
    inspectionHandler,
    closeInspection,
  } = await import("./inspection-channel.mjs");
  const { runInspectionWorker } = await import("./inspection-worker.mjs");
  const root = await mkdtemp(join(tmpdir(), "inspection-worker-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = {
    controlDirectory: root,
    runId: "rich-worker-http",
    token: "b".repeat(64),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  await mkdir(join(root, context.runId));
  await writeFile(
    join(root, context.runId, "journal.json"),
    JSON.stringify({
      runId: context.runId,
      projectId: "project",
      environmentId: "environment",
      expiresAt: context.expiresAt,
      phase: "setup",
    }),
  );
  await initializeInspection(context);
  const server = createServer(inspectionHandler(context));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const controller = new AbortController();
  const seen = [];
  const worker = runInspectionWorker({
    config: {
      ...context,
      runnerUrl: `http://127.0.0.1:${server.address().port}`,
    },
    signal: controller.signal,
    execute: async (operation, input) => {
      seen.push({ operation, input });
      if (operation === "database-snapshot") throw new Error("unavailable");
      return { ready: true };
    },
  });
  const stopped = assert.rejects(worker);
  assert.deepEqual(
    await requestInspection({
      ...context,
      operation: "readiness",
      input: { target: "worker" },
      timeoutMs: 2000,
    }),
    { ready: true },
  );
  await assert.rejects(
    requestInspection({
      ...context,
      operation: "database-snapshot",
      timeoutMs: 2000,
    }),
    /operation failed/,
  );
  assert.deepEqual(
    seen.map((call) => call.operation),
    ["readiness", "database-snapshot"],
  );
  await closeInspection(context);
  controller.abort();
  await stopped;
});
