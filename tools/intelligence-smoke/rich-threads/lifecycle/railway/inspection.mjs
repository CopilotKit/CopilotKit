import assert from "node:assert/strict";
import { evaluateDatabaseTables, inspectRedis } from "../clean-scope.mjs";
import { inspectBootstrapAudit } from "./bootstrap-audit.mjs";
import { requestInspection } from "./inspection-channel.mjs";

/** Only controller-created fixed operations enter the private worker channel. */
export function inspectOperation({ journal, config, operation, input }) {
  return requestInspection({
    controlDirectory: config.controlDirectory,
    runId: journal.runId,
    operation,
    input,
  });
}
/** PostgreSQL, Redis and worker readiness require a reply from this attempt's worker. */
export async function serviceReady({
  journal,
  config,
  service,
  execute = inspectOperation,
}) {
  for (const check of service.healthchecks) {
    const target = { postgres: "database", redis: "cache", worker: "worker" }[
      check.kind
    ];
    if (!target) continue;
    try {
      const result = await execute({
        journal,
        config,
        operation: "readiness",
        input: { target },
      });
      if (result?.ready !== true) return false;
    } catch {
      return false;
    }
  }
  return true;
}
/** Validate scanner evidence, deriving success from table counts and file findings. */
export function validateNativeReport(report, bootstrapTables = {}) {
  assert.ok(
    report &&
      ["passed", "failed"].includes(report.status) &&
      Array.isArray(report.files),
    "Incomplete native inspection",
  );
  const paths = new Set();
  for (const file of report.files) {
    assert.ok(
      typeof file.path === "string" &&
        file.path.length > 0 &&
        !file.path.startsWith("/") &&
        !file.path.split("/").includes("..") &&
        !paths.has(file.path),
      "Invalid native file path",
    );
    paths.add(file.path);
    assert.ok(["passed", "failed"].includes(file.status));
    if (file.tables) {
      assert.ok(Array.isArray(file.tables));
      assert.match(
        file.path,
        /\.(db|sqlite|sqlite3)$/,
        "Tables require a SQLite file",
      );
      assert.equal(
        new Set(file.tables.map((table) => table.name)).size,
        file.tables.length,
        "Duplicate native table",
      );
      for (const table of file.tables) {
        assert.equal(
          table.expected,
          bootstrapTables[table.name]?.count ?? 0,
          "Unapproved native count exemption",
        );
        assert.ok(
          typeof table.name === "string" &&
            Number.isSafeInteger(table.count) &&
            table.count >= 0 &&
            Number.isSafeInteger(table.expected) &&
            table.expected >= 0,
        );
      }
      assert.equal(
        file.status,
        file.tables.every((t) => t.count === t.expected) ? "passed" : "failed",
      );
    } else
      assert.ok(
        file.status === "failed" &&
          file.reason === "Preexisting native data or sidecar",
      );
  }
  assert.equal(
    report.status,
    report.files.every((f) => f.status === "passed") ? "passed" : "failed",
  );
}
/** Queries every PG table, every Redis DB and the entire native volume, including SQLite WAL/media. */
export async function inspectRemoteStores({
  journal,
  config,
  execute = inspectOperation,
}) {
  const db = journal.services.filter((s) => s.roles.includes("database"));
  const caches = journal.services.filter((s) => s.roles.includes("cache"));
  const native = journal.services.filter((s) =>
    s.roles.includes("native-backend"),
  );
  assert.equal(db.length, 1);
  assert.equal(caches.length, 1);
  assert.ok(native.length);
  const snapshot = await execute({
    journal,
    config,
    operation: "database-snapshot",
    input: {},
  });
  assert.ok(Array.isArray(snapshot.counts), "Incomplete database snapshot");
  const audits = snapshot.bootstrapAudit
    ? [{ bootstrapAudit: snapshot.bootstrapAudit }]
    : [];
  let counts = snapshot.counts;
  let bootstrapAudit;
  if (journal.bootstrap) {
    assert.equal(audits.length, 1, "Bootstrap audit inspection required");
    assert.ok(
      !config.bootstrapTables?.["cpki.product_audit_events"],
      "Audit rows cannot be count-exempted",
    );
    bootstrapAudit = inspectBootstrapAudit(
      audits[0].bootstrapAudit,
      config,
      journal.bootstrap,
    );
    const auditCount = counts.find(
      (row) => row.name === "cpki.product_audit_events",
    );
    assert.ok(
      auditCount && auditCount.count === bootstrapAudit.count,
      "Audit/count snapshot mismatch",
    );
    counts = counts.filter((row) => row.name !== "cpki.product_audit_events");
  }
  const database = evaluateDatabaseTables(counts, config.bootstrapTables);
  if (bootstrapAudit) {
    database.bootstrapAudit = bootstrapAudit;
    database.tables.push({
      name: "cpki.product_audit_events",
      count: bootstrapAudit.count,
      expected: 2,
    });
    if (bootstrapAudit.status !== "passed") database.status = "failed";
  }
  const cacheSnapshot = await execute({
    journal,
    config,
    operation: "redis-snapshot",
    input: {},
  });
  const cache = await inspectRedis({
    sendCommand: async () => cacheSnapshot.keyspace,
  });
  const nativeReports = [];
  for (const service of native) {
    const volume = journal.volumes.find((v) => v.serviceId === service.id);
    assert.ok(volume?.mountPath, "Owned native volume required");
    const report = await execute({
      journal,
      config,
      operation: "native-snapshot",
      input: { framework: service.framework },
    });
    validateNativeReport(report, config.nativeBootstrapTables);
    nativeReports.push({
      framework: service.framework,
      serviceId: service.id,
      volumeId: volume.id,
      ...report,
    });
  }
  return {
    status: [database, cache, ...nativeReports].every(
      (r) => r.status === "passed",
    )
      ? "passed"
      : "failed",
    method: "remote-full-store-read-only",
    database,
    cache,
    native: nativeReports,
  };
}
