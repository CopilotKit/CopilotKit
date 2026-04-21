import type { Logger } from "../types/index.js";

export interface PbClientConfig {
  url: string;
  email?: string;
  password?: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export interface ListOpts {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  skipTotal?: boolean;
}

export interface ListResult<T> {
  page: number;
  perPage: number;
  totalPages: number;
  totalItems: number;
  items: T[];
}

export interface PbClient {
  getOne<T>(collection: string, id: string): Promise<T | null>;
  getFirst<T>(collection: string, filter: string): Promise<T | null>;
  list<T>(collection: string, opts?: ListOpts): Promise<ListResult<T>>;
  create<T>(collection: string, record: Record<string, unknown>): Promise<T>;
  update<T>(
    collection: string,
    id: string,
    record: Record<string, unknown>,
  ): Promise<T>;
  upsertByField<T>(
    collection: string,
    field: string,
    value: string,
    record: Record<string, unknown>,
  ): Promise<T>;
  delete(collection: string, id: string): Promise<void>;
  deleteByFilter(collection: string, filter: string): Promise<number>;
  health(): Promise<boolean>;
  /**
   * Trigger PocketBase's built-in backup endpoint
   * (`POST /api/backups`). PB takes a SQLite checkpoint + zips the
   * `pb_data` directory into `<pb_data>/backups/<name>`, producing a
   * consistent snapshot even while writes are in-flight. This replaces
   * reading `data.db` off the live filesystem, which risks corruption.
   */
  createBackup(name: string): Promise<void>;
  /** Fetch a previously-created backup's zip bytes. */
  downloadBackup(name: string): Promise<Uint8Array>;
  /** Delete a backup so we don't leak zips on the PB volume. */
  deleteBackup(name: string): Promise<void>;
}

// Cap deleteByFilter at 100 pages of 200 rows = 20k rows. Guards against
// unbounded loops if PB ever returns a full page indefinitely.
const DELETE_BY_FILTER_MAX_ITERATIONS = 100;

// Cap 401 re-auth retries at 1. A persistent 401 means creds are bad or
// the server will never accept us; retrying forever just pins the CPU.
const MAX_AUTH_RETRIES = 1;

// Floor for 429 Retry-After honoring — if header is absent or unparseable,
// fall back to exponential backoff.
const DEFAULT_RETRY_AFTER_MS = 500;

// PB returns a 400 with a body containing "validation_not_unique" on unique-
// index violations. Shape of the error body varies across versions, so we
// match the string fragment rather than parsing JSON.
function isUniqueConstraintError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("validation_not_unique") ||
    msg.includes("is not unique") ||
    /UNIQUE constraint failed/i.test(msg)
  );
}

export function createPbClient(config: PbClientConfig): PbClient {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const baseUrl = config.url.replace(/\/$/, "");
  const logger = config.logger;
  let authToken: string | null = null;
  // Only log the "missing creds" warning once per process lifetime.
  // Without this, every request when PB creds aren't configured would
  // spam the log — a single warn is plenty to flag the gap.
  let warnedMissingCreds = false;

  async function ensureAuth(): Promise<void> {
    if (authToken) return;
    if (!config.email || !config.password) {
      if (!warnedMissingCreds) {
        warnedMissingCreds = true;
        logger.warn("pb-client.missing-credentials", {
          hint: "POCKETBASE_SUPERUSER_EMAIL / POCKETBASE_SUPERUSER_PASSWORD not set — writes will fail with 401/403",
        });
      }
      return;
    }
    const res = await fetchImpl(
      `${baseUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identity: config.email,
          password: config.password,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`pb-auth failed: ${res.status} ${text}`);
    }
    const body = (await res.json()) as { token?: unknown };
    // Validate the token shape before trusting it — PB has been observed
    // returning 200 with malformed bodies during restarts.
    if (typeof body.token !== "string" || body.token.length === 0) {
      throw new Error("pb-auth returned empty or non-string token");
    }
    authToken = body.token;
  }

  function parseRetryAfterMs(res: Response, attempt: number): number {
    const header = res.headers.get("retry-after");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 30_000);
      }
    }
    // Fall back to exponential backoff when no parseable header.
    return Math.max(DEFAULT_RETRY_AFTER_MS, 2 ** attempt * 100);
  }

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    await ensureAuth();
    const headers = new Headers(init.headers ?? {});
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (authToken && !headers.has("authorization")) {
      headers.set("authorization", authToken);
    }
    let attempts = 0;
    let authRetries = 0;
    const maxAttempts = 3;
    // Retry loop covers three transient classes: 401 (re-auth once), 5xx
    // (exponential backoff), 429 (Retry-After), and thrown network
    // errors (DNS fail, AbortError, TypeError from fetchImpl).
    while (true) {
      attempts += 1;
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
      } catch (err) {
        // Thrown network error — treat as transient and retry with the
        // same backoff envelope as 5xx.
        if (attempts < maxAttempts) {
          const waitMs = 2 ** attempts * 100;
          logger.debug("pb-client.network-retry", {
            path,
            attempt: attempts,
            err: String(err),
            waitMs,
          });
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
      if (res.status === 401 && authRetries < MAX_AUTH_RETRIES) {
        authRetries += 1;
        authToken = null;
        try {
          await ensureAuth();
        } catch (err) {
          logger.debug("pb-client.reauth-failed", {
            path,
            err: String(err),
          });
          return res;
        }
        if (authToken) headers.set("authorization", authToken);
        continue;
      }
      if (res.status === 429 && attempts < maxAttempts) {
        const waitMs = parseRetryAfterMs(res, attempts);
        logger.debug("pb-client.rate-limited", {
          path,
          attempt: attempts,
          waitMs,
        });
        // Drain the body before retrying so the underlying connection can
        // be reused by the runtime's HTTP agent — otherwise some fetch
        // implementations will leave the socket half-consumed and open a
        // fresh one on every retry.
        await res.text().catch(() => {});
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (res.status >= 500 && attempts < maxAttempts) {
        const waitMs = 2 ** attempts * 100;
        // Same reasoning as the 429 branch: drain before backing off.
        await res.text().catch(() => {});
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return res;
    }
  }

  const client: PbClient = {
    async getOne<T>(collection: string, id: string): Promise<T | null> {
      const res = await request(
        `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`pb getOne failed: ${res.status}`);
      return (await res.json()) as T;
    },

    async getFirst<T>(collection: string, filter: string): Promise<T | null> {
      const qs = new URLSearchParams({
        filter,
        perPage: "1",
        skipTotal: "true",
      });
      const res = await request(
        `/api/collections/${encodeURIComponent(collection)}/records?${qs.toString()}`,
      );
      if (!res.ok) throw new Error(`pb list failed: ${res.status}`);
      const body = (await res.json()) as { items: T[] };
      return body.items[0] ?? null;
    },

    async list<T>(
      collection: string,
      opts: ListOpts = {},
    ): Promise<ListResult<T>> {
      const qs = new URLSearchParams();
      if (opts.filter) qs.set("filter", opts.filter);
      if (opts.sort) qs.set("sort", opts.sort);
      if (opts.page) qs.set("page", String(opts.page));
      if (opts.perPage) qs.set("perPage", String(opts.perPage));
      if (opts.skipTotal) qs.set("skipTotal", "true");
      const res = await request(
        `/api/collections/${encodeURIComponent(collection)}/records?${qs.toString()}`,
      );
      if (!res.ok) throw new Error(`pb list failed: ${res.status}`);
      return (await res.json()) as ListResult<T>;
    },

    async create<T>(
      collection: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const res = await request(
        `/api/collections/${encodeURIComponent(collection)}/records`,
        {
          method: "POST",
          body: JSON.stringify(record),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`pb create failed: ${res.status} ${text}`);
      }
      return (await res.json()) as T;
    },

    async update<T>(
      collection: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const res = await request(
        `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(record) },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`pb update failed: ${res.status} ${text}`);
      }
      return (await res.json()) as T;
    },

    async upsertByField<T>(
      collection: string,
      field: string,
      value: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const existing = await client.getFirst<{ id: string }>(
        collection,
        `${field} = ${JSON.stringify(value)}`,
      );
      if (existing) {
        return client.update<T>(collection, existing.id, record);
      }
      try {
        return await client.create<T>(collection, {
          ...record,
          [field]: value,
        });
      } catch (err) {
        // TOCTOU race mirroring alert-state-store.record: two concurrent
        // upserts for the same `field = value` both saw no existing row
        // and raced to create. The second hits the unique index — re-read
        // and update rather than surfacing a constraint violation.
        if (!isUniqueConstraintError(err)) throw err;
        const racer = await client.getFirst<{ id: string }>(
          collection,
          `${field} = ${JSON.stringify(value)}`,
        );
        if (!racer?.id) throw err;
        return client.update<T>(collection, racer.id, record);
      }
    },

    async delete(collection: string, id: string): Promise<void> {
      const res = await request(
        `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (res.status === 404) {
        // Delete-of-missing is idempotent but we want to surface the gap
        // for anyone asking "why didn't my delete do anything?".
        logger.debug("pb-client.delete-missing", { collection, id });
        return;
      }
      if (!res.ok) {
        throw new Error(`pb delete failed: ${res.status}`);
      }
    },

    async deleteByFilter(collection: string, filter: string): Promise<number> {
      let deleted = 0;
      let iterations = 0;
      while (true) {
        iterations += 1;
        if (iterations > DELETE_BY_FILTER_MAX_ITERATIONS) {
          throw new Error(
            `pb deleteByFilter exceeded ${DELETE_BY_FILTER_MAX_ITERATIONS} iterations (collection=${collection}) — refusing to loop further`,
          );
        }
        const page = await client.list<{ id: string }>(collection, {
          filter,
          perPage: 200,
          skipTotal: true,
        });
        if (page.items.length === 0) break;
        for (const item of page.items) {
          await client.delete(collection, item.id);
          deleted += 1;
        }
        if (page.items.length < 200) break;
      }
      return deleted;
    },

    async createBackup(name: string): Promise<void> {
      const res = await request(`/api/backups`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`pb createBackup failed: ${res.status} ${text}`);
      }
    },

    async downloadBackup(name: string): Promise<Uint8Array> {
      // PB serves the backup file at `/api/backups/<name>` for superusers
      // (GET). The response is a binary zip. Use `request()` so the
      // auth/retry envelope applies, then buffer into a Uint8Array for
      // the S3 uploader (multi-GB PB DBs will eventually want streaming;
      // see s3-backup.ts TODO).
      const res = await request(
        `/api/backups/${encodeURIComponent(name)}`,
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`pb downloadBackup failed: ${res.status} ${text}`);
      }
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    },

    async deleteBackup(name: string): Promise<void> {
      const res = await request(
        `/api/backups/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 404) {
        const text = await res.text().catch(() => "");
        throw new Error(`pb deleteBackup failed: ${res.status} ${text}`);
      }
    },

    async health(): Promise<boolean> {
      try {
        const res = await fetchImpl(`${baseUrl}/api/health`);
        return res.ok;
      } catch (err) {
        // Elevated from debug → warn: PB outages are operationally
        // significant and were previously invisible at the default log
        // level. Health is called infrequently enough that warn-spam
        // isn't a concern.
        logger.warn("pb-client.health-error", { err: String(err) });
        return false;
      }
    },
  };
  return client;
}
