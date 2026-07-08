import { randomUUID } from "node:crypto";
import type { StateStore } from "./state-store.js";

const DEFAULT_LOCK_TTL_MS = 30_000;

type Expiring<V> = { value: V; expiresAt?: number };
const live = <V>(e: Expiring<V> | undefined): e is Expiring<V> =>
  !!e && (e.expiresAt === undefined || Date.now() <= e.expiresAt);

export class MemoryStore implements StateStore {
  private kvMap = new Map<string, Expiring<unknown>>();
  private lists = new Map<string, Expiring<unknown[]>>();
  private locks = new Map<string, { token: string; expiresAt?: number }>();
  private queues = new Map<string, unknown[]>();

  kv = {
    get: async <T>(key: string): Promise<T | undefined> => {
      const e = this.kvMap.get(key);
      if (!live(e)) {
        this.kvMap.delete(key);
        return undefined;
      }
      return e.value as T;
    },
    set: async <T>(key: string, value: T, ttlMs?: number): Promise<void> => {
      this.kvMap.set(key, {
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
      });
    },
    delete: async (key: string): Promise<void> => {
      this.kvMap.delete(key);
    },
  };

  list = {
    append: async <T>(
      key: string,
      value: T,
      opts?: { maxLen?: number; ttlMs?: number },
    ): Promise<number> => {
      const e = this.lists.get(key);
      const arr = live(e) ? (e!.value as T[]) : [];
      arr.push(value);
      if (opts?.maxLen && arr.length > opts.maxLen)
        arr.splice(0, arr.length - opts.maxLen);
      this.lists.set(key, {
        value: arr,
        expiresAt: opts?.ttlMs ? Date.now() + opts.ttlMs : e?.expiresAt,
      });
      return arr.length;
    },
    range: async <T>(key: string, start = 0, stop?: number): Promise<T[]> => {
      const e = this.lists.get(key);
      if (!live(e)) {
        this.lists.delete(key);
        return [];
      }
      const arr = e!.value as T[];
      return arr.slice(start, stop === undefined ? undefined : stop + 1);
    },
    trim: async (key: string, maxLen: number): Promise<void> => {
      const e = this.lists.get(key);
      if (!live(e)) return;
      const arr = e!.value;
      if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
    },
    delete: async (key: string): Promise<void> => {
      this.lists.delete(key);
    },
  };

  lock = {
    acquire: async (
      key: string,
      opts?: { ttlMs?: number },
    ): Promise<{ token: string } | null> => {
      const cur = this.locks.get(key);
      if (cur && (cur.expiresAt === undefined || Date.now() <= cur.expiresAt))
        return null;
      const token = randomUUID();
      this.locks.set(key, {
        token,
        expiresAt: Date.now() + (opts?.ttlMs ?? DEFAULT_LOCK_TTL_MS),
      });
      return { token };
    },
    release: async (key: string, token: string): Promise<void> => {
      const cur = this.locks.get(key);
      if (cur?.token === token) this.locks.delete(key);
    },
  };

  dedup = {
    seen: async (key: string, ttlMs: number): Promise<boolean> => {
      const k = `dedup:${key}`;
      const e = this.kvMap.get(k);
      if (live(e)) return true;
      this.kvMap.set(k, { value: 1, expiresAt: Date.now() + ttlMs });
      return false;
    },
  };

  queue = {
    enqueue: async <T>(
      key: string,
      value: T,
      opts?: { maxSize?: number; onFull?: "drop-oldest" | "drop-newest" },
    ): Promise<number> => {
      const arr = this.queues.get(key) ?? [];
      if (opts?.maxSize && arr.length >= opts.maxSize) {
        if ((opts.onFull ?? "drop-oldest") === "drop-newest") {
          this.queues.set(key, arr);
          return arr.length;
        }
        arr.shift();
      }
      arr.push(value);
      this.queues.set(key, arr);
      return arr.length;
    },
    dequeue: async <T>(key: string): Promise<T | undefined> => {
      const arr = this.queues.get(key);
      return arr && arr.length ? (arr.shift() as T) : undefined;
    },
    depth: async (key: string): Promise<number> =>
      this.queues.get(key)?.length ?? 0,
  };
}
