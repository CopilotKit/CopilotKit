import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import type { RedisClientType } from "redis";
import type { StateStore } from "@copilotkit/bot";

/** Options for {@link createRedisStore}. */
export interface CreateRedisStoreOptions {
  /** Connection URL, e.g. `redis://localhost:6379`. Ignored when `client` is supplied. */
  url?: string;
  /** Pre-configured node-redis client to use instead of creating one from `url`. */
  client?: RedisClientType;
  /** Prefix prepended to every key. Defaults to `cpk:`. */
  keyPrefix?: string;
}

const DEFAULT_LOCK_TTL_MS = 30_000;

// Atomic compare-and-delete: only release the lock if the caller still owns the token.
const RELEASE_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

// Bounded enqueue honoring maxSize/onFull, evaluated atomically.
// KEYS[1] = list key, ARGV[1] = JSON value, ARGV[2] = maxSize (0 = unbounded), ARGV[3] = onFull
// Returns the resulting list length.
const ENQUEUE_LUA = `
local maxSize = tonumber(ARGV[2])
if maxSize > 0 then
  local len = redis.call('llen', KEYS[1])
  if len >= maxSize then
    if ARGV[3] == 'drop-newest' then
      return len
    end
    redis.call('lpop', KEYS[1])
  end
end
return redis.call('rpush', KEYS[1], ARGV[1])
`;

/**
 * Redis-backed {@link StateStore}. Durable across restarts and shareable across
 * processes/instances. Backs the `kv`/`list`/`lock`/`dedup`/`queue` primitives
 * on standard Redis commands; lock-release and bounded-enqueue use Lua for
 * atomicity. All values are JSON-encoded.
 */
export class RedisStore implements StateStore {
  private readonly client: RedisClientType;
  private readonly prefix: string;
  private readonly ownsClient: boolean;
  private connecting?: Promise<void>;

  constructor(opts: CreateRedisStoreOptions = {}) {
    if (opts.client) {
      this.client = opts.client;
      this.ownsClient = false;
    } else {
      this.client = createClient(
        opts.url ? { url: opts.url } : {},
      ) as RedisClientType;
      this.ownsClient = true;
    }
    this.prefix = opts.keyPrefix ?? "cpk:";
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  /** Lazily ensure the client is connected before the first command. */
  private async ready(): Promise<RedisClientType> {
    if (!this.client.isOpen) {
      this.connecting ??= this.client.connect().then(() => undefined);
      await this.connecting;
    }
    return this.client;
  }

  kv = {
    get: async <T>(key: string): Promise<T | undefined> => {
      const c = await this.ready();
      const raw = await c.get(this.key(key));
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch (cause) {
        throw new Error(
          `bot-store-redis: failed to parse stored value for key "${key}"`,
          { cause },
        );
      }
    },
    set: async <T>(key: string, value: T, ttlMs?: number): Promise<void> => {
      const c = await this.ready();
      const payload = JSON.stringify(value);
      if (ttlMs) await c.set(this.key(key), payload, { PX: ttlMs });
      else await c.set(this.key(key), payload);
    },
    delete: async (key: string): Promise<void> => {
      const c = await this.ready();
      await c.del(this.key(key));
    },
  };

  list = {
    append: async <T>(
      key: string,
      value: T,
      opts?: { maxLen?: number; ttlMs?: number },
    ): Promise<number> => {
      const c = await this.ready();
      const k = this.key(key);
      let len = await c.rPush(k, JSON.stringify(value));
      if (opts?.maxLen && len > opts.maxLen) {
        await c.lTrim(k, -opts.maxLen, -1);
        len = opts.maxLen;
      }
      if (opts?.ttlMs) await c.pExpire(k, opts.ttlMs);
      return len;
    },
    range: async <T>(key: string, start = 0, stop?: number): Promise<T[]> => {
      const c = await this.ready();
      const raw = await c.lRange(this.key(key), start, stop ?? -1);
      return raw.map((r) => {
        try {
          return JSON.parse(r) as T;
        } catch (cause) {
          throw new Error(
            `bot-store-redis: failed to parse stored value for key "${key}"`,
            { cause },
          );
        }
      });
    },
    trim: async (key: string, maxLen: number): Promise<void> => {
      const c = await this.ready();
      await c.lTrim(this.key(key), -maxLen, -1);
    },
    delete: async (key: string): Promise<void> => {
      const c = await this.ready();
      await c.del(this.key(key));
    },
  };

  lock = {
    acquire: async (
      key: string,
      opts?: { ttlMs?: number },
    ): Promise<{ token: string } | null> => {
      const c = await this.ready();
      const token = randomUUID();
      const reply = await c.set(this.key(`lock:${key}`), token, {
        NX: true,
        PX: opts?.ttlMs ?? DEFAULT_LOCK_TTL_MS,
      });
      return reply === "OK" ? { token } : null;
    },
    release: async (key: string, token: string): Promise<void> => {
      const c = await this.ready();
      await c.eval(RELEASE_LOCK_LUA, {
        keys: [this.key(`lock:${key}`)],
        arguments: [token],
      });
    },
  };

  dedup = {
    seen: async (key: string, ttlMs: number): Promise<boolean> => {
      const c = await this.ready();
      const reply = await c.set(this.key(`dedup:${key}`), "1", {
        NX: true,
        PX: ttlMs,
      });
      // SET NX returns null when the key already existed → already seen.
      return reply === null;
    },
  };

  queue = {
    enqueue: async <T>(
      key: string,
      value: T,
      opts?: { maxSize?: number; onFull?: "drop-oldest" | "drop-newest" },
    ): Promise<number> => {
      const c = await this.ready();
      const result = await c.eval(ENQUEUE_LUA, {
        keys: [this.key(key)],
        arguments: [
          JSON.stringify(value),
          String(opts?.maxSize ?? 0),
          opts?.onFull ?? "drop-oldest",
        ],
      });
      return Number(result);
    },
    dequeue: async <T>(key: string): Promise<T | undefined> => {
      const c = await this.ready();
      const raw = await c.lPop(this.key(key));
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch (cause) {
        throw new Error(
          `bot-store-redis: failed to parse stored value for key "${key}"`,
          { cause },
        );
      }
    },
    depth: async (key: string): Promise<number> => {
      const c = await this.ready();
      return c.lLen(this.key(key));
    },
  };

  /** Close the underlying connection. No-op for an injected client. */
  async quit(): Promise<void> {
    if (this.ownsClient && this.client.isOpen) {
      await this.client.quit();
    }
  }
}

/** Create a {@link RedisStore} from a URL or an injected node-redis client. */
export function createRedisStore(
  opts: CreateRedisStoreOptions = {},
): RedisStore {
  return new RedisStore(opts);
}
