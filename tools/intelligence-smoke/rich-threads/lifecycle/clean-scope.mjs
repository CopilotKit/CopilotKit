import assert from "node:assert/strict";
import { lstat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const dataTable =
  /thread|message|resource|snapshot|memory|memories|event|run|job|queue|import|state|learning|attachment|media/i;

function expectedCount(name, exceptions) {
  const exception = exceptions[name];
  if (!exception) return 0;
  assert.ok(
    !dataTable.test(name),
    `Cannot exempt persisted conversation/queue data: ${name}`,
  );
  assert.ok(
    exception.reason &&
      Number.isSafeInteger(exception.count) &&
      exception.count >= 0,
    `Invalid bootstrap exception: ${name}`,
  );
  return exception.count;
}

/** Inspect all application tables, not only newly generated thread IDs. */
export async function inspectDatabase(pool, bootstrapTables = {}) {
  const client = await pool.connect();
  const tables = [];
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const { rows } = await client.query(
      "SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND schemaname NOT LIKE 'pg_toast%' ORDER BY schemaname, tablename",
    );
    assert.ok(
      rows.some((r) => r.schemaname === "cpki" && r.tablename === "threads"),
      "Initialized Intelligence schema required",
    );
    for (const { schemaname, tablename } of rows) {
      const name = `${schemaname}.${tablename}`;
      const count = Number(
        (
          await client.query(
            `SELECT count(*) AS count FROM ${quote(schemaname)}.${quote(tablename)}`,
          )
        ).rows[0].count,
      );
      assert.ok(Number.isSafeInteger(count));
      tables.push({
        name,
        count,
        expected: expectedCount(name, bootstrapTables),
      });
    }
    for (const name of Object.keys(bootstrapTables))
      assert.ok(
        tables.some((t) => t.name === name),
        `Unknown bootstrap table ${name}`,
      );
    await client.query("ROLLBACK");
    return {
      status: tables.every((t) => t.count === t.expected) ? "passed" : "failed",
      tables,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // Both original failures are retained in AggregateError.errors.
      // eslint-disable-next-line preserve-caught-error
      throw new AggregateError(
        [error, rollbackError],
        "Clean-scope read and rollback failed",
        { cause: rollbackError },
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/** INFO keyspace covers every Redis database, including queues outside DB zero. */
export async function inspectRedis(redis) {
  const text = await redis.sendCommand(["INFO", "keyspace"]);
  assert.ok(
    typeof text === "string" && text.includes("# Keyspace"),
    "Redis keyspace reply required",
  );
  const databases = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("db"))
    .map((line) => {
      const match = /^db(\d+):keys=(\d+),/.exec(line);
      assert.ok(match, "Unrecognized Redis keyspace row");
      return { database: Number(match[1]), keys: Number(match[2]) };
    });
  return {
    status: databases.every((d) => d.keys === 0) ? "passed" : "failed",
    databases,
  };
}

/** Full owned store inspection includes resource memory and media sidecars. */
export async function inspectNativeDirectory(root, bootstrapTables = {}) {
  assert.equal(
    (await lstat(root)).isDirectory(),
    true,
    "Owned native root required",
  );
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path);
      assert.ok(
        !entry.isSymbolicLink(),
        "Native store must not escape ownership through symlinks",
      );
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (/\.(db|sqlite|sqlite3)$/.test(entry.name)) {
        const db = new DatabaseSync(path, { readOnly: true });
        try {
          const tables = db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all()
            .map(({ name: table }) => ({
              name: table,
              count: Number(
                db
                  .prepare(`SELECT count(*) AS count FROM ${quote(table)}`)
                  .get().count,
              ),
              expected: expectedCount(table, bootstrapTables),
            }));
          files.push({
            path: name,
            status: tables.every((t) => t.count === t.expected)
              ? "passed"
              : "failed",
            tables,
          });
        } finally {
          db.close();
        }
      } else if (/\.(db|sqlite|sqlite3)-(wal|shm)$/.test(entry.name)) {
        // SQLite readers merge WAL contents; the paired DB must exist and is inspected above.
        assert.equal(
          (await lstat(path.replace(/-(wal|shm)$/, ""))).isFile(),
          true,
        );
      } else {
        // Any snapshot, media sidecar or opaque file is prior data, even with fresh IDs.
        files.push({
          path: name,
          status: "failed",
          reason: "Preexisting native data or sidecar",
        });
      }
    }
  }
  await visit(root);
  return {
    status: files.every((f) => f.status === "passed") ? "passed" : "failed",
    files,
  };
}

export async function verifyCleanScope({
  pool,
  redis,
  nativeRoots,
  bootstrapTables = {},
  nativeBootstrapTables = {},
}) {
  assert.ok(
    nativeRoots.length && new Set(nativeRoots).size === nativeRoots.length,
  );
  const database = await inspectDatabase(pool, bootstrapTables);
  const cache = await inspectRedis(redis);
  const native = [];
  for (const root of nativeRoots)
    native.push({
      root,
      ...(await inspectNativeDirectory(root, nativeBootstrapTables)),
    });
  const status = [database, cache, ...native].every(
    (r) => r.status === "passed",
  )
    ? "passed"
    : "failed";
  return { status, method: "full-store-read-only", database, cache, native };
}
