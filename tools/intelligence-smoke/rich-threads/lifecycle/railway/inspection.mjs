import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { evaluateDatabaseTables, inspectRedis } from "../clean-scope.mjs";
import { inspectBootstrapAudit } from "./bootstrap-audit.mjs";
const exec = promisify(execFile);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
/** Explicit provider IDs only. No linked CLI context, secret argv, or retained stderr. */
export async function remoteCommand({ journal, service, command }) {
  assert.ok(
    journal.environmentId &&
      journal.projectId &&
      journal.services.some((s) => s.id === service.id),
  );
  try {
    const { stdout } = await exec(
      "railway",
      [
        "ssh",
        "--project",
        journal.projectId,
        "--environment",
        journal.environmentId,
        "--service",
        service.id,
        "--",
        command.map(quote).join(" "),
      ],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    throw new Error(`Owned remote inspection failed: ${service.key}`);
  }
}
export async function serviceReady({
  journal,
  service,
  execute = remoteCommand,
}) {
  for (const check of service.healthchecks) {
    try {
      if (check.kind === "postgres")
        await execute({
          journal,
          service,
          command: [
            "sh",
            "-c",
            'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
          ],
        });
      if (check.kind === "redis")
        assert.equal(
          (
            await execute({
              journal,
              service,
              command: [
                "sh",
                "-c",
                'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --raw PING',
              ],
            })
          ).trim(),
          "PONG",
        );
    } catch {
      return false;
    }
  }
  return true;
}
const databaseSQL = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT format('SELECT json_build_object(''name'',%L,''count'',count(*)) FROM %I.%I;',schemaname||'.'||tablename,schemaname,tablename)
FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' ORDER BY schemaname,tablename
\\gexec
ROLLBACK;`;
/** Queries every PG table, every Redis DB and the entire native volume, including SQLite WAL/media. */
export async function inspectRemoteStores({
  journal,
  config,
  execute = remoteCommand,
}) {
  const db = journal.services.filter((s) => s.roles.includes("database"));
  const caches = journal.services.filter((s) => s.roles.includes("cache"));
  const native = journal.services.filter((s) =>
    s.roles.includes("native-backend"),
  );
  assert.equal(db.length, 1);
  assert.equal(caches.length, 1);
  assert.ok(native.length);
  const auditSQL = journal.bootstrap
    ? "SELECT json_build_object('bootstrapAudit', COALESCE(json_agg(to_jsonb(a) - 'id' - 'created_at'), '[]'::json)) FROM cpki.product_audit_events a;"
    : "";
  const encoded = Buffer.from(
    databaseSQL.replace("ROLLBACK;", auditSQL + "\nROLLBACK;"),
  ).toString("base64");
  const result = await execute({
    journal,
    service: db[0],
    command: [
      "sh",
      "-c",
      `printf %s '${encoded}' | base64 -d | psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"`,
    ],
  });
  const rows = result
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const audits = rows.filter((row) => Object.hasOwn(row, "bootstrapAudit"));
  let counts = rows.filter((row) => !Object.hasOwn(row, "bootstrapAudit"));
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
  const cache = await inspectRedis({
    sendCommand: () =>
      execute({
        journal,
        service: caches[0],
        command: [
          "sh",
          "-c",
          'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --raw INFO keyspace',
        ],
      }),
  });
  const source = await readFile(
    new URL("../clean-scope.mjs", import.meta.url),
    "utf8",
  );
  const nativeReports = [];
  for (const service of native) {
    const volume = journal.volumes.find((v) => v.serviceId === service.id);
    assert.ok(volume?.mountPath, "Owned native volume required");
    const script =
      source +
      `\nconsole.log(JSON.stringify(await inspectNativeDirectory(${JSON.stringify(volume.mountPath)},${JSON.stringify(config.nativeBootstrapTables ?? {})})));`;
    const stdout = await execute({
      journal,
      service,
      command: ["node", "--input-type=module", "-e", script],
    });
    const report = JSON.parse(stdout);
    assert.ok(
      ["passed", "failed"].includes(report.status) &&
        Array.isArray(report.files),
      "Incomplete native inspection",
    );
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
