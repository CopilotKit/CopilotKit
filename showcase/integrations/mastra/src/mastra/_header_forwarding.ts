/**
 * Header-forwarding shim for the Mastra integration.
 *
 * Why this exists: @ag-ui/mastra's adapter does NOT forward inbound HTTP
 * headers (e.g. `x-aimock-context`) to the underlying Vercel AI SDK model
 * provider. Without forwarding, aimock cannot scope fixture matches by
 * integration and every /v1/responses call returns 404.
 *
 * This file provides the SINGLE choke-point that fixes the gap:
 *   - `withForwardedHeaders(req, fn)` captures inbound `x-*` headers off the
 *     incoming NextRequest and runs `fn` inside an AsyncLocalStorage scope.
 *   - `openai` is a drop-in replacement for `@ai-sdk/openai`'s default
 *     provider. It is built via `createOpenAI({ fetch })` where the custom
 *     fetch reads the ALS-bound headers and merges them into every outbound
 *     LLM request.
 *
 * Apples-to-apples note: this only touches mastra-internal files (route +
 * agent model construction). The shared harness/probe/conversation-runner
 * and shared frontend are untouched. This mirrors the LGT precedent in
 * `integrations/langgraph-typescript/src/agent/openai-headers.ts`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createOpenAI } from "@ai-sdk/openai";

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
 * Run `fn` with an ALS-bound snapshot of inbound x-* headers. Any outbound
 * fetch made by the wrapped OpenAI provider during `fn` execution will see
 * these headers and merge them into the request.
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

/** fetch wrapper that injects ALS-bound x-* headers into every outbound call. */
const forwardingFetch: typeof fetch = (input, init) => {
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

/**
 * Drop-in replacement for `import { openai } from "@ai-sdk/openai"`.
 * Same call signature: `openai("gpt-4o")` returns a model that uses the
 * forwarding fetch on every outbound LLM call.
 */
export const openai = createOpenAI({
  fetch: forwardingFetch,
});
