/**
 * Pluggable persistence interface for the bot runtime.
 *
 * **JSON-serialization contract**: all values round-trip through
 * `JSON.stringify` / `JSON.parse` on remote backends (Redis, Postgres), so `T`
 * must be JSON-serializable. Non-JSON values (Date, Map, class instances) will
 * not survive on those backends. MemoryStore preserves them by reference — a
 * backend divergence to be aware of when writing tests that run against both.
 */
export interface StateStore {
  kv: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<void>;
  };
  list: {
    /**
     * Append to a capped list; returns new length.
     * When `ttlMs` is given, (re)sets the whole list's expiry; otherwise the
     * existing expiry is preserved.
     */
    append<T>(
      key: string,
      value: T,
      opts?: { maxLen?: number; ttlMs?: number },
    ): Promise<number>;
    /**
     * Oldest-first range; defaults to the whole list.
     * Indices are non-negative only; negative indices are not supported
     * (behavior is backend-specific).
     */
    range<T>(key: string, start?: number, stop?: number): Promise<T[]>;
    trim(key: string, maxLen: number): Promise<void>;
    delete(key: string): Promise<void>;
  };
  lock: {
    /**
     * Returns a release token, or null if already held.
     * When `ttlMs` is omitted, the lock auto-expires after a default window
     * (30_000 ms) so a crashed holder can't deadlock the key. All backends
     * apply the same default.
     */
    acquire(
      key: string,
      opts?: { ttlMs?: number },
    ): Promise<{ token: string } | null>;
    /** No-op if the token no longer owns the lock. */
    release(key: string, token: string): Promise<void>;
  };
  dedup: {
    /** Atomically record `key`; returns true if it was ALREADY seen within ttl. */
    seen(key: string, ttlMs: number): Promise<boolean>;
  };
  queue: {
    enqueue<T>(
      key: string,
      value: T,
      opts?: { maxSize?: number; onFull?: "drop-oldest" | "drop-newest" },
    ): Promise<number>;
    dequeue<T>(key: string): Promise<T | undefined>;
    depth(key: string): Promise<number>;
  };
}
