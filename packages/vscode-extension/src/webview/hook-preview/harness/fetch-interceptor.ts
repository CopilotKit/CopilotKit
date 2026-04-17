const INSTALLED_MARK = Symbol.for("copilotkit.fetchInterceptor.installed");

interface MarkedFetch {
  [INSTALLED_MARK]?: true;
}

/**
 * Patches globalThis.fetch so that any call to a URL starting with one of the
 * given prefixes resolves to an empty JSON 200 response instead of hitting
 * the network. All other URLs pass through to the original fetch.
 *
 * Used in the hook-preview webview to suppress hung requests to the dummy
 * CopilotKit runtime URL while still letting data hooks fetch real user APIs.
 *
 * Safe to call from a test `beforeEach` — the returned disposer restores the
 * previously-installed fetch. If the current `globalThis.fetch` was already
 * installed by a prior call, this is a no-op and the disposer is idempotent
 * (prevents stacking wrappers under React StrictMode / HMR remounts).
 */
export function installFetchInterceptor(noopUrls: string[]): () => void {
  const current = globalThis.fetch as typeof fetch & MarkedFetch;
  if (current[INSTALLED_MARK]) {
    return () => {};
  }

  const orig = current;
  const patched = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (noopUrls.some((p) => url.startsWith(p))) {
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return orig(input as Parameters<typeof orig>[0], init);
  }) as typeof fetch & MarkedFetch;
  patched[INSTALLED_MARK] = true;
  globalThis.fetch = patched;

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (globalThis.fetch === patched) globalThis.fetch = orig;
  };
}
