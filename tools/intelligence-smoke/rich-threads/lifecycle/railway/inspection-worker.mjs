import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapSource, parseBootstrapIdentity } from "./bootstrap.mjs";
import {
  validateInspectionOperation,
  inspectionLimit,
  boundedJson,
} from "./inspection-channel.mjs";
import { threadObservation } from "../../storage/intelligence.mjs";
const exec = promisify(execFile);
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

/** Prove the worker is inside its owned environment and lacks control credentials. */
export function validateWorkerEnvironment(config, env = process.env) {
  for (const key of ["RAILWAY_API_TOKEN", "RAILWAY_TOKEN", "RICH_RUNNER_TOKEN"])
    assert.ok(!env[key], `Worker must not receive ${key}`);
  assert.equal(config.projectId, env.RAILWAY_PROJECT_ID);
  assert.equal(config.environmentId, env.RAILWAY_ENVIRONMENT_ID);
  assert.match(config.runId, /^[a-z][a-z0-9-]{0,62}$/);
  assert.match(config.token, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(config.expiresAt) > Date.now());
  const runner = new URL(config.runnerUrl);
  assert.ok(
    runner.protocol === "https:" &&
      !runner.username &&
      !runner.password &&
      !runner.search &&
      !runner.hash,
  );
  for (const [value, protocol] of [
    [config.databaseUrl, "postgresql:"],
    [config.redisUrl, "redis:"],
    ...Object.values(config.native).map((nativeUrl) => [nativeUrl, "http:"]),
  ]) {
    const url = new URL(value);
    assert.equal(url.protocol, protocol);
    assert.ok(
      url.hostname.endsWith(".railway.internal") && !url.search && !url.hash,
      "Only owned private service addresses allowed",
    );
  }
}
/** Fixed worker operations; all SQL/scope/paths come from committed code and private provisioning. */
export function createInspectionOperations({
  config,
  pool,
  redis,
  fetchImpl = fetch,
  executeBootstrap = exec,
}) {
  let identity;
  return async (operation, input = {}) => {
    validateInspectionOperation(operation, input);
    if (operation === "readiness") {
      if (input.target === "database") await pool.query("SELECT 1");
      if (input.target === "cache") assert.equal(await redis.ping(), "PONG");
      return { ready: true };
    }
    if (operation === "bootstrap") {
      assert.ok(!identity, "Canonical bootstrap already executed");
      assert.ok(config.bootstrapSeed, "Canonical bootstrap seed required");
      const source = Buffer.from(config.bootstrapSeed, "base64").toString(
        "utf8",
      );
      assert.equal(
        createHash("sha256").update(source).digest("hex"),
        bootstrapSource.sha256,
        "Canonical bootstrap digest mismatch",
      );
      const { stdout } = await executeBootstrap("bash", ["-c", source], {
        timeout: 30000,
        maxBuffer: inspectionLimit,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: config.databaseUrl,
          BOOTSTRAP_CONFIG_B64: config.bootstrapConfig,
        },
      });
      identity = parseBootstrapIdentity(stdout);
      const org = JSON.parse(
        Buffer.from(config.bootstrapConfig, "base64").toString(),
      ).organizations[0];
      assert.equal(
        identity.organizationId,
        org.id || `org_${org.slug.replace(/[^a-z0-9]+/g, "_")}`,
      );
      return identity;
    }
    if (operation === "database-snapshot") {
      const client = await pool.connect();
      try {
        await client.query(
          "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        const { rows } = await client.query(
          "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_toast%' ORDER BY schemaname,tablename",
        );
        assert.ok(rows.length <= 10000, "Database table bound exceeded");
        const counts = [];
        for (const { schemaname, tablename } of rows) {
          const result = await client.query(
            `SELECT count(*) AS count FROM ${quote(schemaname)}.${quote(tablename)}`,
          );
          counts.push({
            name: `${schemaname}.${tablename}`,
            count: Number(result.rows[0].count),
          });
        }
        const bootstrapAudit = identity
          ? (
              await client.query(
                "SELECT to_jsonb(a) - 'id' - 'created_at' AS audit FROM cpki.product_audit_events a",
              )
            ).rows.map((row) => row.audit)
          : undefined;
        return { counts, ...(bootstrapAudit ? { bootstrapAudit } : {}) };
      } finally {
        try {
          await client.query("ROLLBACK");
        } finally {
          client.release();
        }
      }
    }
    if (operation === "redis-snapshot")
      return { keyspace: await redis.info("keyspace") };
    if (operation === "native-snapshot") {
      const url = config.native[input.framework];
      assert.ok(url, "Owned native service required");
      const requestId = randomUUID();
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ runId: config.runId, requestId }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 200);
      const result = await boundedJson(response.body);
      assert.equal(result.runId, config.runId);
      assert.equal(result.requestId, requestId);
      return result.report;
    }
    const scope = config.scopes[input.framework];
    assert.ok(scope, "Owned framework scope required");
    const resolved = {
      ...scope,
      projectId: identity?.projectId ?? scope.projectId,
    };
    assert.match(
      resolved.projectId,
      /^[1-9][0-9]*$/,
      "Bootstrap identity required",
    );
    return threadObservation(pool, resolved, operation, input.threadId);
  };
}
/** Poll once per job. A lost bootstrap result remains ambiguous and fails the attempt. */
export async function runInspectionWorker({
  config,
  execute,
  fetchImpl = fetch,
  signal,
}) {
  const base = new URL(`/inspection/${config.runId}/`, config.runnerUrl);
  const headers = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
  };
  while (Date.now() < Date.parse(config.expiresAt)) {
    signal?.throwIfAborted();
    const response = await fetchImpl(new URL("poll", base), {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, "Inspection authority refused worker");
    const job = await boundedJson(response.body, 16384);
    if (!job.requestId) {
      await delay(250, undefined, { signal });
      continue;
    }
    assert.equal(job.runId, config.runId);
    assert.ok(
      Date.now() < job.deadline && job.deadline <= Date.parse(config.expiresAt),
    );
    let result;
    try {
      result = { ok: true, result: await execute(job.operation, job.input) };
    } catch {
      result = { ok: false };
    }
    const body = JSON.stringify({
      runId: config.runId,
      requestId: job.requestId,
      ...result,
    });
    assert.ok(Buffer.byteLength(body) <= inspectionLimit);
    const posted = await fetchImpl(new URL("result", base), {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(posted.status, 200, "Inspection result not acknowledged");
    await posted.body?.cancel();
  }
}
async function main() {
  const config = JSON.parse(process.env.RICH_INSPECTION_CONFIG_JSON);
  validateWorkerEnvironment(config);
  const { default: pg } = await import("pg"),
    { default: Redis } = await import("ioredis");
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    max: 2,
  });
  const redis = new Redis(config.redisUrl, {
    connectTimeout: 10000,
    commandTimeout: 10000,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", () => {});
  try {
    await runInspectionWorker({
      config,
      execute: createInspectionOperations({ config, pool, redis }),
    });
  } finally {
    redis.disconnect();
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error("Private inspection worker failed");
    process.exitCode = 1;
  });
