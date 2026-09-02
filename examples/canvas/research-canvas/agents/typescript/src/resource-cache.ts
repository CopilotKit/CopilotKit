const resourceCache = new Map<string, string>();
const resourceLoadsInFlight = new Map<string, Promise<string>>();

/** Returns a previously loaded resource, when present. */
export function getCachedResource(url: string): string | undefined {
  return resourceCache.get(url);
}

/** Loads a resource once and reuses the cached result. */
export async function getOrLoadResource(
  url: string,
  load: () => Promise<string>,
): Promise<string> {
  const cached = getCachedResource(url);
  if (cached !== undefined) {
    return cached;
  }

  const inFlight = resourceLoadsInFlight.get(url);
  if (inFlight !== undefined) {
    return inFlight;
  }

  const resourceLoad = load()
    .then((resource) => {
      resourceCache.set(url, resource);
      return resource;
    })
    .finally(() => {
      resourceLoadsInFlight.delete(url);
    });
  resourceLoadsInFlight.set(url, resourceLoad);
  return resourceLoad;
}
