/**
 * header-forwarding.ts — per-request inbound x-* header forwarding for the
 * strands-typescript Express AGENT process.
 *
 * Why this exists: strands-typescript is a TWO-process integration. The Next
 * route is a bare HttpAgent proxy; the model call to aimock originates in THIS
 * Express agent process. `@ag-ui/aws-strands@0.2.3`'s express handler reads only
 * `req.body` + the `accept` header and calls `agent.run()` with NO inbound
 * headers, so `X-AIMock-Strict` / `x-test-id` / `x-aimock-context` / `x-diag-*`
 * are dropped before the model is invoked. Without this shim the outbound
 * OpenAI call to aimock carries only the STATIC `x-aimock-context` slug
 * (model-factory.ts) and never the inbound `X-AIMock-Strict`, so a probe's
 * strict verification silently falls through on a fixture miss.
 *
 * The fix mirrors the in-process precedent
 * (`integrations/built-in-agent/src/lib/header-forwarding.ts`), adapted for an
 * Express `Request` (whose `.headers` is a plain object, not a `Headers`):
 *   - `withForwardedHeaders(req, fn)` snapshots inbound `x-*` headers into an
 *     AsyncLocalStorage scope and runs `fn` (the rest of the request) inside it.
 *     The strands cvdiag middleware (cvdiag-backend-strands.ts) calls this
 *     BEFORE falling through to the aws-strands handler, so `agent.run()` and
 *     the outbound `OpenAIModel.stream()` execute within the ALS scope.
 *   - `forwardingFetch` reads the ALS-bound headers at outbound-call time and
 *     merges them onto every request the OpenAI SDK makes. It is passed as
 *     `clientConfig.fetch` to the strands `OpenAIModel` (model-factory.ts).
 *
 * NEVER hardcodes strict on: only headers PRESENT on the inbound request are
 * forwarded. When no x-* are in scope, `forwardingFetch` is byte-identical to a
 * plain `fetch`, so ordinary demo traffic (no `X-AIMock-Strict`) proxies
 * unchanged.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";

const headersStorage = new AsyncLocalStorage<Record<string, string>>();

/** Extract the x-* headers off an Express request's plain header object. */
function extractXHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (!lower.startsWith("x-")) continue;
    if (value === undefined) continue;
    out[lower] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return out;
}

/**
 * Run `fn` with an ALS-bound snapshot of inbound x-* headers. Any outbound
 * fetch made by the OpenAI client during `fn` (which includes the whole
 * downstream aws-strands handler + `agent.run()` + the streamed response)
 * sees these headers and merges them into the request.
 */
export function withForwardedHeaders<T>(req: Request, fn: () => T): T {
  return headersStorage.run(extractXHeaders(req), fn);
}

/** Return the ALS-bound headers (or an empty map when not in scope). */
function getForwardedHeaders(): Record<string, string> {
  return headersStorage.getStore() ?? {};
}

/**
 * `clientConfig.fetch` for the strands `OpenAIModel`. Injects the ALS-bound
 * inbound x-* headers (incl. `X-AIMock-Strict`, `x-test-id`, `x-aimock-context`,
 * `x-diag-*`) onto every outbound OpenAI call. Byte-identical to a plain
 * `fetch` when no x-* are in scope, so demo traffic is unaffected.
 *
 * Precedence: uses `if (!merged.has(k)) merged.set(k, v)` so it never clobbers a
 * header the OpenAI SDK already set from `clientConfig.defaultHeaders` (the
 * static `x-aimock-context` slug stays authoritative); inbound `X-AIMock-Strict`
 * / `x-test-id` / `x-diag-*` are ADDED.
 */
export const forwardingFetch: typeof fetch = (input, init) => {
  const forwarded = getForwardedHeaders();
  if (Object.keys(forwarded).length === 0) {
    return fetch(input, init);
  }
  const merged = new Headers(init?.headers);
  for (const [k, v] of Object.entries(forwarded)) {
    if (!merged.has(k)) merged.set(k, v);
  }
  return fetch(input, { ...init, headers: merged });
};
