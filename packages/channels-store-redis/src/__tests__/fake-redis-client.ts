import RedisMock from "ioredis-mock";
import type { RedisClientType } from "redis";

let nextPort = 30_000;

/**
 * A node-redis-shaped client over `ioredis-mock`, for hermetic tests.
 *
 * `ioredis-mock` keeps real Redis semantics in memory: TTLs, `SET NX PX`,
 * `GETDEL`, list commands, and Lua `EVAL` (run by fengari). This wrapper only
 * maps the node-redis method names and argument shapes that `RedisStore` uses
 * onto it, so the store's own code and Lua scripts run unchanged.
 *
 * ioredis-mock shares data between instances with the same host and port, so
 * each fake gets its own port and starts empty.
 */
export function createFakeRedisClient(): {
  client: RedisClientType;
  raw: InstanceType<typeof RedisMock>;
  quitCalls: () => number;
} {
  const raw = new RedisMock({ port: nextPort++ });
  let quits = 0;
  const client = {
    isOpen: true,
    connect: async () => undefined,
    quit: async () => {
      quits++;
      return "OK";
    },
    on: () => client,
    get: (key: string) => raw.get(key),
    set: (
      key: string,
      value: string,
      opts?: { NX?: boolean; PX?: number },
    ): Promise<string | null> => {
      const args: (string | number)[] = [];
      if (opts?.PX !== undefined) args.push("PX", opts.PX);
      if (opts?.NX) args.push("NX");
      return (
        raw.set as unknown as (...a: unknown[]) => Promise<string | null>
      )(key, value, ...args);
    },
    del: (key: string) => raw.del(key),
    getDel: (key: string) => raw.getdel(key),
    rPush: (key: string, value: string) => raw.rpush(key, value),
    lTrim: (key: string, start: number, stop: number) =>
      raw.ltrim(key, start, stop),
    pExpire: (key: string, ms: number) => raw.pexpire(key, ms),
    lRange: (key: string, start: number, stop: number) =>
      raw.lrange(key, start, stop),
    lPop: (key: string) => raw.lpop(key),
    lLen: (key: string) => raw.llen(key),
    eval: (script: string, opts: { keys: string[]; arguments: string[] }) =>
      raw.eval(script, opts.keys.length, ...opts.keys, ...opts.arguments),
  };
  return {
    client: client as unknown as RedisClientType,
    raw,
    quitCalls: () => quits,
  };
}
