const resourceCache = new Map<string, string>();

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

  const resource = await load();
  resourceCache.set(url, resource);
  return resource;
}
