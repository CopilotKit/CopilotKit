import { expect, test } from "vitest";
import { createResourceCache } from "./resource-cache";

function createTestResourceCache() {
  return createResourceCache({ maxEntries: 10, maxBytes: 1_024 });
}

async function cacheResource(
  cache: ReturnType<typeof createResourceCache>,
  url: string,
  resource: string,
) {
  await cache.getOrLoadResource(url, async () => resource);
}

function createDeferred<T>() {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) {
        throw new Error("Deferred promise is not initialized");
      }
      resolvePromise(value);
    },
    reject(reason: unknown) {
      if (!rejectPromise) {
        throw new Error("Deferred promise is not initialized");
      }
      rejectPromise(reason);
    },
  };
}

test("creates isolated resource caches", async () => {
  const firstCache = createTestResourceCache();
  const secondCache = createTestResourceCache();
  const resourceUrl = "https://example.com/isolated-resource";

  await firstCache.getOrLoadResource(resourceUrl, async () => "First cache");
  await secondCache.getOrLoadResource(resourceUrl, async () => "Second cache");

  expect(firstCache.getCachedResource(resourceUrl)).toBe("First cache");
  expect(secondCache.getCachedResource(resourceUrl)).toBe("Second cache");
});

test.each([
  ["a zero entry cap", { maxEntries: 0, maxBytes: 1 }],
  ["a negative entry cap", { maxEntries: -1, maxBytes: 1 }],
  ["a zero byte cap", { maxEntries: 1, maxBytes: 0 }],
  [
    "an infinite byte cap",
    { maxEntries: 1, maxBytes: Number.POSITIVE_INFINITY },
  ],
])("rejects %s", (_description, limits) => {
  expect(() => createResourceCache(limits)).toThrow(RangeError);
});

test("uses one cache key for URL fragment variants", async () => {
  const cache = createTestResourceCache();
  const deferred = createDeferred<string>();
  const resourceUrl = "https://example.com/fragment-resource";
  let loaderCalls = 0;
  const load = () => {
    loaderCalls += 1;
    return deferred.promise;
  };

  const first = cache.getOrLoadResource(`${resourceUrl}#introduction`, load);
  const second = cache.getOrLoadResource(`${resourceUrl}#conclusion`, load);

  expect(loaderCalls).toBe(1);
  deferred.resolve("Canonical resource");
  await expect(Promise.all([first, second])).resolves.toEqual([
    "Canonical resource",
    "Canonical resource",
  ]);
  await expect(cache.getOrLoadResource(resourceUrl, load)).resolves.toBe(
    "Canonical resource",
  );
  expect(loaderCalls).toBe(1);
});

test("evicts the least recently used resource at the entry cap", async () => {
  const cache = createResourceCache({ maxEntries: 2, maxBytes: 1_024 });
  const firstUrl = "https://example.com/entry-first";
  const secondUrl = "https://example.com/entry-second";
  const thirdUrl = "https://example.com/entry-third";

  await cacheResource(cache, firstUrl, "First resource");
  await cacheResource(cache, secondUrl, "Second resource");
  expect(cache.getCachedResource(firstUrl)).toBe("First resource");
  await cacheResource(cache, thirdUrl, "Third resource");

  expect(cache.getCachedResource(firstUrl)).toBe("First resource");
  expect(cache.getCachedResource(secondUrl)).toBeUndefined();
  expect(cache.getCachedResource(thirdUrl)).toBe("Third resource");
});

test("evicts the least recently used resource at the UTF-8 byte cap", async () => {
  const cache = createResourceCache({ maxEntries: 10, maxBytes: 5 });
  const firstUrl = "https://example.com/byte-first";
  const secondUrl = "https://example.com/byte-second";
  const thirdUrl = "https://example.com/byte-third";

  await cacheResource(cache, firstUrl, "é");
  await cacheResource(cache, secondUrl, "bb");
  expect(cache.getCachedResource(firstUrl)).toBe("é");
  await cacheResource(cache, thirdUrl, "cc");

  expect(cache.getCachedResource(firstUrl)).toBe("é");
  expect(cache.getCachedResource(secondUrl)).toBeUndefined();
  expect(cache.getCachedResource(thirdUrl)).toBe("cc");
});

test("returns an oversized resource without disturbing cached entries", async () => {
  const cache = createResourceCache({ maxEntries: 10, maxBytes: 5 });
  const retainedUrl = "https://example.com/retained-resource";
  const oversizedUrl = "https://example.com/oversized-resource";
  let oversizedLoads = 0;
  const loadOversized = async () => {
    oversizedLoads += 1;
    return "123456";
  };

  await cacheResource(cache, retainedUrl, "keep");
  await expect(
    cache.getOrLoadResource(oversizedUrl, loadOversized),
  ).resolves.toBe("123456");

  expect(cache.getCachedResource(retainedUrl)).toBe("keep");
  expect(cache.getCachedResource(oversizedUrl)).toBeUndefined();
  await expect(
    cache.getOrLoadResource(oversizedUrl, loadOversized),
  ).resolves.toBe("123456");
  expect(oversizedLoads).toBe(2);
});

test("shares one in-flight load between concurrent callers", async () => {
  const cache = createTestResourceCache();
  const resourceUrl = "https://example.com/concurrent-resource";
  const deferred = createDeferred<string>();
  let loaderCalls = 0;
  const load = () => {
    loaderCalls += 1;
    return deferred.promise;
  };

  const first = cache.getOrLoadResource(resourceUrl, load);
  const second = cache.getOrLoadResource(resourceUrl, load);

  expect(loaderCalls).toBe(1);
  deferred.resolve("Shared resource");
  await expect(Promise.all([first, second])).resolves.toEqual([
    "Shared resource",
    "Shared resource",
  ]);
});

test("clears a rejected shared load so the next caller retries", async () => {
  const cache = createTestResourceCache();
  const resourceUrl = "https://example.com/rejected-concurrent-resource";
  const deferred = createDeferred<string>();
  const failure = new Error("Temporary network failure");
  let loaderCalls = 0;
  const load = () => {
    loaderCalls += 1;
    return loaderCalls === 1
      ? deferred.promise
      : Promise.resolve("Recovered resource");
  };

  const first = cache.getOrLoadResource(resourceUrl, load);
  const second = cache.getOrLoadResource(resourceUrl, load);

  expect(loaderCalls).toBe(1);
  const currentCallers = Promise.all([
    expect(first).rejects.toBe(failure),
    expect(second).rejects.toBe(failure),
  ]);
  deferred.reject(failure);
  await currentCallers;

  await expect(cache.getOrLoadResource(resourceUrl, load)).resolves.toBe(
    "Recovered resource",
  );
  expect(loaderCalls).toBe(2);
});

test("retries a transient failure and caches the successful retry", async () => {
  const cache = createTestResourceCache();
  const resourceUrl = "https://example.com/transient-resource";
  let attempts = 0;
  const load = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("Temporary network failure");
    }
    return "Downloaded resource";
  };

  await expect(cache.getOrLoadResource(resourceUrl, load)).rejects.toThrow(
    "Temporary network failure",
  );
  await expect(cache.getOrLoadResource(resourceUrl, load)).resolves.toBe(
    "Downloaded resource",
  );
  await expect(cache.getOrLoadResource(resourceUrl, load)).resolves.toBe(
    "Downloaded resource",
  );

  expect(attempts).toBe(2);
});
