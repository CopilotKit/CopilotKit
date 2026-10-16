import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { inspectNativeDirectory } from "../clean-scope.mjs";
import { inspectRemoteStores } from "./inspection.mjs";
test("remote scanner checks actual SQLite tables and opaque media, SQL tables, all Redis databases", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "remote-native-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const db = new DatabaseSync(join(root, "memory.db"));
  db.exec("CREATE TABLE messages (id TEXT)");
  db.close();
  const journal = {
    services: [
      { id: "pg", roles: ["database"] },
      { id: "redis", roles: ["cache"] },
      { id: "native", roles: ["native-backend"], framework: "mastra" },
    ],
    volumes: [{ id: "volume", serviceId: "native", mountPath: root }],
  };
  let sqlCount = 0,
    redisKeys = 0;
  const execute = async ({ operation, input }) => {
    if (operation === "database-snapshot")
      return { counts: [{ name: "cpki.threads", count: sqlCount }] };
    if (operation === "redis-snapshot")
      return {
        keyspace:
          "# Keyspace\r\ndb9:keys=" + redisKeys + ",expires=0,avg_ttl=0\r\n",
      };
    assert.equal(operation, "native-snapshot");
    assert.equal(input.framework, "mastra");
    return inspectNativeDirectory(root);
  };
  const config = {};
  assert.equal(
    (await inspectRemoteStores({ journal, config, execute })).status,
    "passed",
  );
  await writeFile(join(root, "old-media.png"), "opaque");
  sqlCount = 1;
  redisKeys = 2;
  const report = await inspectRemoteStores({ journal, config, execute });
  assert.equal(report.status, "failed");
  assert.equal(report.database.status, "failed");
  assert.equal(report.cache.databases[0].database, 9);
  assert.ok(
    report.native[0].files.some(
      (f) => f.path === "old-media.png" && f.status === "failed",
    ),
  );
  await assert.rejects(
    inspectRemoteStores({
      journal,
      config: {
        bootstrapTables: {
          "cpki.threads": { count: 1, reason: "not allowed" },
        },
      },
      execute,
    }),
    /Cannot exempt/,
  );
});

test("native result cannot invent a passing count exemption or omit scanner evidence", async () => {
  const { validateNativeReport } = await import("./inspection.mjs");
  assert.throws(() => validateNativeReport({ status: "passed" }), /Incomplete/);
  assert.throws(
    () =>
      validateNativeReport({
        status: "passed",
        files: [
          {
            path: "memory.db",
            status: "passed",
            tables: [{ name: "messages", count: 1, expected: 1 }],
          },
        ],
      }),
    /exemption/,
  );
});
