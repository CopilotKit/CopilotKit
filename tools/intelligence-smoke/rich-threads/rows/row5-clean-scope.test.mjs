import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  inspectDatabase,
  inspectRedis,
  inspectNativeDirectory,
} from "../lifecycle/clean-scope.mjs";

test("clean scope reads all SQL tables and rejects stale unrelated data and unsafe exceptions", async () => {
  let count = 0;
  let released = 0;
  const pool = {
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes("pg_catalog.pg_tables"))
          return {
            rows: [
              { schemaname: "cpki", tablename: "threads" },
              { schemaname: "queue", tablename: "jobs" },
            ],
          };
        if (sql.startsWith("SELECT count"))
          return { rows: [{ count: sql.includes('"queue"') ? count : 0 }] };
        return { rows: [] };
      },
      release: () => released++,
    }),
  };
  assert.equal((await inspectDatabase(pool)).status, "passed");
  count = 1;
  assert.equal((await inspectDatabase(pool)).status, "failed");
  await assert.rejects(
    inspectDatabase(pool, {
      "queue.jobs": { count: 1, reason: "ignore stale job" },
    }),
    /Cannot exempt/,
  );
  assert.equal(released, 3);
});

test("Redis keys in nonzero databases also invalidate clean scope", async () => {
  assert.equal(
    (await inspectRedis({ sendCommand: async () => "# Keyspace\r\n" })).status,
    "passed",
  );
  assert.equal(
    (
      await inspectRedis({
        sendCommand: async () =>
          "# Keyspace\r\ndb8:keys=1,expires=0,avg_ttl=0\r\n",
      })
    ).status,
    "failed",
  );
  await assert.rejects(
    inspectRedis({ sendCommand: async () => "connection error" }),
    /keyspace reply/,
  );
});

test("real SQLite resource memory and media sidecars fail initial absence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "row5-clean-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await inspectNativeDirectory(root)).status, "passed");
  const db = new DatabaseSync(join(root, "memory.db"));
  db.exec("CREATE TABLE mastra_resources (id TEXT, memory TEXT)");
  assert.equal((await inspectNativeDirectory(root)).status, "passed");
  db.exec(
    "INSERT INTO mastra_resources VALUES ('old-unrelated-id', 'prior memory')",
  );
  assert.equal((await inspectNativeDirectory(root)).status, "failed");
  db.exec("DELETE FROM mastra_resources");
  db.close();
  await writeFile(join(root, "attachment.png"), "retained bytes");
  assert.equal((await inspectNativeDirectory(root)).status, "failed");
});
