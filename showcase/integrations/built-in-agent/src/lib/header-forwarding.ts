/**
 * Header-forwarding shim for the built-in-agent integration.
 *
 * Why this exists: `@tanstack/ai-openai`'s `openaiText()` adapter
 * constructs its own OpenAI client and exposes no built-in hook for
 * per-request HTTP headers. The CopilotKit runtime does not thread
 * inbound headers down to the model adapter either. Without this shim,
 * outbound calls to aimock's `/v1/responses` endpoint carry no
 * `x-aimock-context` header, every fixture match returns 404, and the
 * D6 subset goes 0/6.
 *
 * The fix mirrors the Mastra precedent in
 * `integrations/mastra/src/mastra/_header_forwarding.ts`:
 *   - `withForwardedHeaders(req, fn)` snapshots inbound `x-*` headers off
 *     the incoming Request into an AsyncLocalStorage scope.
 *   - `forwardingFetch` reads the ALS-bound headers at outbound-call time
 *     and merges them into every request the OpenAI SDK makes.
 *
 * The route handler wraps each request in `withForwardedHeaders`; the
 * tanstack-factory constructs `openaiText("gpt-4o", { fetch: forwardingFetch })`
 * once at module-scope and the custom fetch reads ALS dynamically per
 * outbound call.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const headersStorage = new AsyncLocalStorage<Record<string, string>>();

/** Extract the x-* headers off a Web Request / NextRequest. */
function extractXHeaders(req: { headers: Headers }): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-")) {
      out[lower] = value;
    }
  });
  return out;
}

/**
 * Run `fn` with an ALS-bound snapshot of inbound x-* headers. Any
 * outbound fetch made by the OpenAI client during `fn` execution will
 * see these headers and merge them into the request.
 */
export function withForwardedHeaders<T>(
  req: { headers: Headers },
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const headers = extractXHeaders(req);
  return headersStorage.run(headers, fn);
}

/** Return the ALS-bound headers (or an empty map if not in scope). */
function getForwardedHeaders(): Record<string, string> {
  return headersStorage.getStore() ?? {};
}

/**
 * fetch wrapper that injects ALS-bound x-* headers into every outbound
 * call. Pass as the `fetch` option to the OpenAI client config.
 */
export const forwardingFetch: typeof fetch = (input, init) => {
  const forwarded = getForwardedHeaders();
  if (Object.keys(forwarded).length === 0) {
    return fetch(input, init);
  }
  const merged = new Headers(init?.headers);
  for (const [k, v] of Object.entries(forwarded)) {
    // Don't clobber an explicit per-call header.
    if (!merged.has(k)) merged.set(k, v);
  }
  return fetch(input, { ...init, headers: merged });
};
