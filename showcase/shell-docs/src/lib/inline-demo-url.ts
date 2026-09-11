/**
 * Resolve the base URL for an InlineDemo iframe.
 *
 * `NEXT_PUBLIC_LOCAL_BACKENDS` is baked at local build time from
 * showcase/shared/local-ports.json by the shared shell helper. It is empty in
 * normal builds, so the generated registry backend URL remains canonical for
 * production and every environment that has not explicitly opted into local
 * demos.
 */
export function resolveInlineDemoBackendUrl(
  slug: string,
  registryBackendUrl: string,
  rawLocalBackends = process.env.NEXT_PUBLIC_LOCAL_BACKENDS,
): string {
  if (!rawLocalBackends) return registryBackendUrl;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLocalBackends);
  } catch {
    return registryBackendUrl;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return registryBackendUrl;
  }

  const candidate = (parsed as Record<string, unknown>)[slug];
  if (typeof candidate !== "string") return registryBackendUrl;

  try {
    const url = new URL(candidate);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return registryBackendUrl;
    }
    return url.origin;
  } catch {
    return registryBackendUrl;
  }
}
