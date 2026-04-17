/**
 * Patches globalThis.fetch so that any call to a URL starting with one of the
 * given prefixes resolves to an empty JSON 200 response instead of hitting
 * the network. All other URLs pass through to the original fetch.
 *
 * Used in the hook-preview webview to suppress hung requests to the dummy
 * CopilotKit runtime URL while still letting data hooks fetch real user APIs.
 */
export function installFetchInterceptor(noopUrls: string[]): void {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
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
    return orig(input as any, init);
  }) as typeof fetch;
}
