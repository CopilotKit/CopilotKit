import { AsyncLocalStorage } from "node:async_hooks";

type HeaderMap = Record<string, string>;

const headerStorage = new AsyncLocalStorage<HeaderMap>();

/**
 * Filter incoming headers to only x-aimock-* prefixed ones.
 */
function filterAimockHeaders(headers: HeaderMap): HeaderMap {
  const filtered: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase().startsWith("x-aimock-")) {
      filtered[key.toLowerCase()] = value;
    }
  }
  return filtered;
}

/**
 * Run a callback with forwarded headers available via getForwardedHeaders().
 * Call this at the AG-UI request entry point.
 */
export function withForwardedHeaders<T>(headers: HeaderMap, fn: () => T): T {
  return headerStorage.run(filterAimockHeaders(headers), fn);
}

/**
 * Get x-aimock-* headers that should be forwarded to outgoing LLM calls.
 * Returns empty object when called outside a withForwardedHeaders() scope
 * (demo traffic).
 */
export function getForwardedHeaders(): HeaderMap {
  return headerStorage.getStore() ?? {};
}
