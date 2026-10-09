/** Retains enough resolved documents for several sessions while capping key overhead. */
const DEFAULT_RESOURCE_CACHE_MAX_ENTRIES = 64;

/** Caps retained UTF-8 document content at 16 MiB for the shared agent process. */
const DEFAULT_RESOURCE_CACHE_MAX_BYTES = 16 * 1024 * 1024;

interface ResourceCache {
  readonly getCachedResource: (url: string) => string | undefined;
  readonly getOrLoadResource: (
    url: string,
    load: () => Promise<string>,
  ) => Promise<string>;
}

/** Removes the client-only fragment from a resource cache key. */
function getResourceCacheKey(url: string): string {
  const fragmentIndex = url.indexOf("#");
  return fragmentIndex === -1 ? url : url.slice(0, fragmentIndex);
}

/** Rejects a cache limit that is non-positive, fractional, or unbounded. */
function assertCacheLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

/** Creates an isolated resource cache with explicit entry and UTF-8 byte caps. */
export function createResourceCache({
  maxEntries,
  maxBytes,
}: {
  maxEntries: number;
  maxBytes: number;
}): ResourceCache {
  assertCacheLimit("maxEntries", maxEntries);
  assertCacheLimit("maxBytes", maxBytes);

  const resolvedResources = new Map<
    string,
    { resource: string; byteLength: number }
  >();
  const resourceLoadsInFlight = new Map<string, Promise<string>>();
  let cachedBytes = 0;

  /** Reads and promotes a cached resource to most recently used. */
  function readCachedResource(cacheKey: string): string | undefined {
    const entry = resolvedResources.get(cacheKey);
    if (entry === undefined) {
      return undefined;
    }

    resolvedResources.delete(cacheKey);
    resolvedResources.set(cacheKey, entry);
    return entry.resource;
  }

  /** Removes oldest resources until both configured caps are met. */
  function evictToLimits(): void {
    while (resolvedResources.size > maxEntries || cachedBytes > maxBytes) {
      const oldest = resolvedResources.keys().next();
      if (oldest.done) {
        return;
      }
      const entry = resolvedResources.get(oldest.value);
      resolvedResources.delete(oldest.value);
      if (entry !== undefined) {
        cachedBytes -= entry.byteLength;
      }
    }
  }

  /** Returns a previously loaded resource, when present. */
  function getCachedResourceFromCache(url: string): string | undefined {
    return readCachedResource(getResourceCacheKey(url));
  }

  /** Loads a resource once and reuses the cached result. */
  async function getOrLoadResourceFromCache(
    url: string,
    load: () => Promise<string>,
  ): Promise<string> {
    const cacheKey = getResourceCacheKey(url);
    const cached = readCachedResource(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const inFlight = resourceLoadsInFlight.get(cacheKey);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const resourceLoad = load()
      .then((resource) => {
        const byteLength = Buffer.byteLength(resource, "utf8");
        if (byteLength <= maxBytes) {
          resolvedResources.set(cacheKey, { resource, byteLength });
          cachedBytes += byteLength;
          evictToLimits();
        }
        return resource;
      })
      .finally(() => {
        resourceLoadsInFlight.delete(cacheKey);
      });
    resourceLoadsInFlight.set(cacheKey, resourceLoad);
    return resourceLoad;
  }

  return {
    getCachedResource: getCachedResourceFromCache,
    getOrLoadResource: getOrLoadResourceFromCache,
  };
}

const defaultResourceCache = createResourceCache({
  maxEntries: DEFAULT_RESOURCE_CACHE_MAX_ENTRIES,
  maxBytes: DEFAULT_RESOURCE_CACHE_MAX_BYTES,
});

/** Returns a previously loaded resource, when present. */
export function getCachedResource(url: string): string | undefined {
  return defaultResourceCache.getCachedResource(url);
}

/** Loads a resource once and reuses the cached result. */
export async function getOrLoadResource(
  url: string,
  load: () => Promise<string>,
): Promise<string> {
  return defaultResourceCache.getOrLoadResource(url, load);
}
