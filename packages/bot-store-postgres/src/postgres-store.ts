import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Pool } from "pg";
import type { StateStore } from "@copilotkit/bot";

const { Pool: PgPool } = pg;

/** Options for {@link createPostgresStore}. */
export interface CreatePostgresStoreOptions {
  /** Connection string, e.g. `postgres://user:pw@localhost:5432/db`. Ignored when `pool` is supplied. */
  connectionString?: string;
  /** Pre-configured node-postgres pool to use instead of creating one from `connectionString`. */
  pool?: Pool;
  /**
   * Reserved for future schema namespacing of the underlying tables. Currently
   * unused; per-tenant isolation is achieved via `keyPrefix`.
   */
  schema?: string;
  /** Run {@link migrate} automatically on first use. Defaults to `false`. */
  autoMigrate?: boolean;
  /** Prefix prepended to every logical key. Defaults to `cpk:`. */
  keyPrefix?: string;
}

const DEFAULT_LOCK_TTL_MS = 30_000;

/**
 * Idempotent schema. Mirrors `schema.sql` (kept in sync). Embedded as a string
 * so `migrate()` works at runtime without shipping the `.sql` file in `dist`.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cpk_state_kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS cpk_state_list (
  key text NOT NULL,
  seq bigserial PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS cpk_state_list_key ON cpk_state_list(key, seq);

CREATE TABLE IF NOT EXISTS cpk_state_queue (
  key text NOT NULL,
  seq bigserial PRIMARY KEY,
  value jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS cpk_state_queue_key ON cpk_state_queue(key, seq);
`;

/** Create the StateStore tables/indexes if they do not yet exist. Idempotent. */
export async function migrate(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

/**
 * Postgres-backed {@link StateStore}. Durable across restarts and shareable
 * across processes/instances. Backs the `kv`/`list`/`lock`/`dedup`/`queue`
 * primitives on three tables (`cpk_state_kv`, `cpk_state_list`,
 * `cpk_state_queue`). Locks are modelled as TTL'd rows in `cpk_state_kv` (not pg
 * advisory locks) so token/TTL fencing semantics match the Redis backend. All
 * values are stored as JSONB.
 */
export class PostgresStore implements StateStore {
  private readonly pool: Pool;
  private readonly prefix: string;
  private readonly ownsPool: boolean;
  private readonly autoMigrate: boolean;
  private migrating?: Promise<void>;

  constructor(opts: CreatePostgresStoreOptions = {}) {
    if (opts.pool) {
      this.pool = opts.pool;
      this.ownsPool = false;
    } else {
      this.pool = new PgPool({ connectionString: opts.connectionString });
      this.ownsPool = true;
    }
    this.prefix = opts.keyPrefix ?? "cpk:";
    this.autoMigrate = opts.autoMigrate ?? false;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  /** Lazily run the migration once (when autoMigrate is enabled) before first use. */
  private async ready(): Promise<Pool> {
    if (this.autoMigrate) {
      this.migrating ??= migrate(this.pool).catch((e) => {
        // Clear the cached rejection so a subsequent call retries the migration.
        this.migrating = undefined;
        throw e;
      });
      await this.migrating;
    }
    return this.pool;
  }

  kv = {
    get: async <T>(key: string): Promise<T | undefined> => {
      const pool = await this.ready();
      const k = this.key(key);
      const res = await pool.query(
        "SELECT value, expires_at FROM cpk_state_kv WHERE key = $1",
        [k],
      );
      const row = res.rows[0];
      if (!row) return undefined;
      if (
        row.expires_at !== null &&
        new Date(row.expires_at).getTime() <= Date.now()
      ) {
        // Lazily reap the expired row; treat as absent.
        await pool.query("DELETE FROM cpk_state_kv WHERE key = $1", [k]);
        return undefined;
      }
      return row.value as T;
    },
    set: async <T>(key: string, value: T, ttlMs?: number): Promise<void> => {
      const pool = await this.ready();
      const expiresAt = ttlMs
        ? new Date(Date.now() + ttlMs).toISOString()
        : null;
      await pool.query(
        `INSERT INTO cpk_state_kv (key, value, expires_at)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
        [this.key(key), JSON.stringify(value), expiresAt],
      );
    },
    delete: async (key: string): Promise<void> => {
      const pool = await this.ready();
      await pool.query("DELETE FROM cpk_state_kv WHERE key = $1", [
        this.key(key),
      ]);
    },
  };

  list = {
    append: async <T>(
      key: string,
      value: T,
      opts?: { maxLen?: number; ttlMs?: number },
    ): Promise<number> => {
      const pool = await this.ready();
      const k = this.key(key);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Resolve the effective expiry for this list key as a whole:
        //   - if opts.ttlMs is given, use now() + ttlMs;
        //   - otherwise inherit whatever expiry the existing rows carry
        //     (so a non-ttl append after a ttl'd append keeps that expiry).
        let expiresAt: string | null;
        if (opts?.ttlMs) {
          expiresAt = new Date(Date.now() + opts.ttlMs).toISOString();
        } else {
          const cur = await client.query<{ exp: string | null }>(
            "SELECT max(expires_at)::text AS exp FROM cpk_state_list WHERE key = $1",
            [k],
          );
          expiresAt = cur.rows[0]?.exp ?? null;
        }
        await client.query(
          "INSERT INTO cpk_state_list (key, value, expires_at) VALUES ($1, $2::jsonb, $3)",
          [k, JSON.stringify(value), expiresAt],
        );
        if (opts?.maxLen) {
          await client.query(
            `DELETE FROM cpk_state_list
             WHERE key = $1 AND seq NOT IN (
               SELECT seq FROM cpk_state_list WHERE key = $1 ORDER BY seq DESC LIMIT $2
             )`,
            [k, opts.maxLen],
          );
        }
        // Always synchronise all rows in the list to the resolved expiry so
        // the whole list expires as a unit (matches MemoryStore / Redis semantics).
        await client.query(
          "UPDATE cpk_state_list SET expires_at = $2 WHERE key = $1",
          [k, expiresAt],
        );
        const res = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM cpk_state_list WHERE key = $1",
          [k],
        );
        await client.query("COMMIT");
        return Number(res.rows[0]!.count);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    range: async <T>(key: string, start = 0, stop?: number): Promise<T[]> => {
      const pool = await this.ready();
      const k = this.key(key);
      // Lazily reap expired rows for this key.
      await pool.query(
        "DELETE FROM cpk_state_list WHERE key = $1 AND expires_at IS NOT NULL AND expires_at <= now()",
        [k],
      );
      const res = await pool.query<{ value: T }>(
        "SELECT value FROM cpk_state_list WHERE key = $1 ORDER BY seq",
        [k],
      );
      const all = res.rows.map((r) => r.value);
      // Inclusive stop, oldest-first; mirrors MemoryStore/Redis semantics.
      return all.slice(start, stop === undefined ? undefined : stop + 1);
    },
    trim: async (key: string, maxLen: number): Promise<void> => {
      const pool = await this.ready();
      const k = this.key(key);
      await pool.query(
        `DELETE FROM cpk_state_list
         WHERE key = $1 AND seq NOT IN (
           SELECT seq FROM cpk_state_list WHERE key = $1 ORDER BY seq DESC LIMIT $2
         )`,
        [k, maxLen],
      );
    },
    delete: async (key: string): Promise<void> => {
      const pool = await this.ready();
      await pool.query("DELETE FROM cpk_state_list WHERE key = $1", [
        this.key(key),
      ]);
    },
  };

  lock = {
    acquire: async (
      key: string,
      opts?: { ttlMs?: number },
    ): Promise<{ token: string } | null> => {
      const pool = await this.ready();
      const k = this.key(`lock:${key}`);
      const token = randomUUID();
      const expiresAt = new Date(
        Date.now() + (opts?.ttlMs ?? DEFAULT_LOCK_TTL_MS),
      ).toISOString();
      // Insert if free; if a row exists but has expired, take it over. The
      // token lives in `value`; a fresh token fences out stale releases.
      const res = await pool.query<{ value: string }>(
        `INSERT INTO cpk_state_kv (key, value, expires_at)
         VALUES ($1, to_jsonb($2::text), $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
           WHERE cpk_state_kv.expires_at IS NOT NULL AND cpk_state_kv.expires_at <= now()
         RETURNING value`,
        [k, token, expiresAt],
      );
      // A returned row means we inserted or took over an expired lock.
      return res.rows.length > 0 ? { token } : null;
    },
    release: async (key: string, token: string): Promise<void> => {
      const pool = await this.ready();
      const k = this.key(`lock:${key}`);
      // Only the current owner (matching token) may release.
      await pool.query(
        "DELETE FROM cpk_state_kv WHERE key = $1 AND value = to_jsonb($2::text)",
        [k, token],
      );
    },
  };

  dedup = {
    seen: async (key: string, ttlMs: number): Promise<boolean> => {
      const pool = await this.ready();
      const k = this.key(`dedup:${key}`);
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      // Insert if absent; if a row exists but expired, refresh it (treat as not
      // seen). rowCount === 0 ⇒ a live row already existed ⇒ already seen.
      const res = await pool.query(
        `INSERT INTO cpk_state_kv (key, value, expires_at)
         VALUES ($1, '1'::jsonb, $2)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
           WHERE cpk_state_kv.expires_at IS NOT NULL AND cpk_state_kv.expires_at <= now()`,
        [k, expiresAt],
      );
      return (res.rowCount ?? 0) === 0;
    },
  };

  queue = {
    enqueue: async <T>(
      key: string,
      value: T,
      opts?: { maxSize?: number; onFull?: "drop-oldest" | "drop-newest" },
    ): Promise<number> => {
      const pool = await this.ready();
      const k = this.key(key);
      const onFull = opts?.onFull ?? "drop-oldest";
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (opts?.maxSize) {
          // Serialize concurrent enqueues for this key (FOR UPDATE can't be used
          // with count()); the advisory lock is released at transaction end.
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [k]);
          const cnt = await client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM cpk_state_queue WHERE key = $1",
            [k],
          );
          const depth = Number(cnt.rows[0]!.count);
          if (depth >= opts.maxSize) {
            if (onFull === "drop-newest") {
              await client.query("COMMIT");
              return depth;
            }
            // drop-oldest: remove the head before inserting.
            await client.query(
              `DELETE FROM cpk_state_queue
               WHERE seq = (SELECT seq FROM cpk_state_queue WHERE key = $1 ORDER BY seq LIMIT 1)`,
              [k],
            );
          }
        }
        await client.query(
          "INSERT INTO cpk_state_queue (key, value) VALUES ($1, $2::jsonb)",
          [k, JSON.stringify(value)],
        );
        const res = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM cpk_state_queue WHERE key = $1",
          [k],
        );
        await client.query("COMMIT");
        return Number(res.rows[0]!.count);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    dequeue: async <T>(key: string): Promise<T | undefined> => {
      const pool = await this.ready();
      const res = await pool.query<{ value: T }>(
        `DELETE FROM cpk_state_queue
         WHERE seq = (
           SELECT seq FROM cpk_state_queue WHERE key = $1
           ORDER BY seq FOR UPDATE SKIP LOCKED LIMIT 1
         )
         RETURNING value`,
        [this.key(key)],
      );
      const row = res.rows[0];
      return row ? (row.value as T) : undefined;
    },
    depth: async (key: string): Promise<number> => {
      const pool = await this.ready();
      const res = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM cpk_state_queue WHERE key = $1",
        [this.key(key)],
      );
      return Number(res.rows[0]!.count);
    },
  };

  /**
   * Best-effort sweep of expired kv/list rows. Called opportunistically;
   * reads also reap lazily so this is purely a housekeeping aid.
   */
  async sweepExpired(): Promise<void> {
    const pool = await this.ready();
    await pool.query(
      "DELETE FROM cpk_state_kv WHERE expires_at IS NOT NULL AND expires_at <= now()",
    );
    await pool.query(
      "DELETE FROM cpk_state_list WHERE expires_at IS NOT NULL AND expires_at <= now()",
    );
  }

  /** Close the underlying pool. No-op for an injected pool or an already-ended pool. */
  async end(): Promise<void> {
    if (this.ownsPool && !this.pool.ended) {
      await this.pool.end();
    }
  }

  /** Alias for {@link end}. */
  async close(): Promise<void> {
    await this.end();
  }
}

/** Create a {@link PostgresStore} from a connection string or an injected pool. */
export function createPostgresStore(
  opts: CreatePostgresStoreOptions = {},
): PostgresStore {
  return new PostgresStore(opts);
}
