/** Returns the original pathname. Capture no longer masks or categorizes routes. */
export function toRoute(pathname: string, _templates: string[] = []) {
  return pathname;
}

/** Resolves a URL without removing path segments, query parameters, or fragments. */
export function toOriginAndRoute(
  url: string,
  _templates: string[] = [],
  base: string = globalThis.location?.href ?? "http://localhost/",
) {
  const parsed = new URL(url, base);
  return { url: parsed.href, origin: parsed.origin, route: parsed.pathname };
}
