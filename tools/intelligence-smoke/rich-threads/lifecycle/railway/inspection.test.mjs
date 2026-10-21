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

test("canonical bootstrap schedule defaults pass while extra or altered learning data fails", async () => {
  const identity = { organizationId: "org_owned", projectId: "1" };
  const input = {
    organizations: [{ slug: "owned", name: "Owned" }],
    localEvaluation: { organizationSlug: "owned" },
  };
  const config = {
    bootstrap: { serviceKey: "pg" },
    services: [
      {
        key: "pg",
        env: {
          BOOTSTRAP_CONFIG_B64: Buffer.from(JSON.stringify(input)).toString(
            "base64",
          ),
        },
      },
    ],
  };
  const journal = {
    bootstrap: identity,
    services: [
      { id: "pg", roles: ["database"] },
      { id: "redis", roles: ["cache"] },
      { id: "native", roles: ["native-backend"], framework: "mastra" },
    ],
    volumes: [{ id: "volume", serviceId: "native", mountPath: "/data" }],
  };
  const common = {
    actor_id: null,
    project_id: null,
    role: null,
    access_source: "bootstrap",
    request_id: null,
    trace_id: null,
  };
  const snapshot = {
    counts: [
      { name: "cpki.threads", count: 0 },
      { name: "cpki.learning_runs", count: 0 },
      { name: "cpki.learning_schedule_receipts", count: 0 },
      { name: "cpki.learning_schedules", count: 1 },
      { name: "cpki.learning_project_schedules", count: 1 },
      { name: "cpki.product_audit_events", count: 2 },
    ],
    bootstrapAudit: [
      {
        ...common,
        event_type: "self_hosted.bootstrap_organization_created",
        organization_id: "org_owned",
        payload: {
          organizationId: "org_owned",
          slug: "owned",
          name: "Owned",
          source: "bootstrap",
        },
      },
      {
        ...common,
        event_type: "self_hosted.bootstrap_applied",
        organization_id: null,
        payload: {
          configuredOrganizations: 1,
          insertedOrganizations: 1,
          skippedConflictingOrganizations: 0,
          insertedOrgMappings: 0,
          insertedPlatformAdminMappings: 0,
          insertedEmergencyGrants: 0,
        },
      },
    ],
    bootstrapSchedules: [
      {
        name: "cpki.learning_schedules",
        row: {
          organization_id: "org_owned",
          local_time: "02:00",
          time_zone: "Etc/UTC",
        },
      },
      {
        name: "cpki.learning_project_schedules",
        row: {
          organization_id: "org_owned",
          project_id: 1,
          local_time: null,
          time_zone: null,
        },
      },
    ],
  };
  const inspect = async (database) =>
    inspectRemoteStores({
      config,
      journal,
      execute: async ({ operation }) =>
        operation === "database-snapshot"
          ? database
          : operation === "redis-snapshot"
            ? { keyspace: "# Keyspace\r\n" }
            : { status: "passed", files: [] },
    });
  assert.equal((await inspect(snapshot)).status, "passed");
  for (const mutate of [
    (s) => {
      delete s.bootstrapSchedules;
    },
    (s) => {
      s.bootstrapSchedules = [];
    },
    (s) => {
      s.bootstrapSchedules.push(s.bootstrapSchedules[0]);
    },
    (s) => {
      s.bootstrapSchedules[0].row.organization_id = "org_other";
    },
    (s) => {
      s.bootstrapSchedules[1].row.project_id = 2;
    },
    (s) => {
      s.bootstrapSchedules[0].row.local_time = "03:00";
    },
    (s) => {
      s.bootstrapSchedules[1].row.local_time = "02:00";
    },
    (s) => {
      s.bootstrapSchedules[0].row.extra = "unexpected";
    },
    (s) => {
      s.counts.find((t) => t.name === "cpki.learning_schedules").count = 2;
    },
    (s) => {
      s.counts.find((t) => t.name === "cpki.learning_runs").count = 1;
    },
    (s) => {
      s.counts.find((t) => t.name === "cpki.learning_schedule_receipts").count =
        1;
    },
  ]) {
    const dirty = structuredClone(snapshot);
    mutate(dirty);
    assert.equal((await inspect(dirty)).status, "failed");
  }
});
