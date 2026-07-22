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
  // CVDIAG (als-snapshot): record whether the inbound x-aimock-context
  // discriminator was present at the moment we capture the header
  // snapshot into ALS. Never log the full value — prefix only.
  const slug = headers["x-aimock-context"];
  const runId = headers["x-diag-run-id"];
  const hops = headers["x-diag-hops"];
  const hopCount = hops ? hops.split(",").filter(Boolean).length : 0;
  console.log(
    `CVDIAG component=route-mastra boundary=als-snapshot ` +
      `run_id=${runId ?? "none"} slug=${slug ?? "MISSING"} ` +
      `header_present=${slug != null} ` +
      `header_value_prefix=${slug ? slug.slice(0, 12) : ""} ` +
      `hop=${hops ? hopCount : "-"} status=${slug ? "ok" : "miss"} ` +
      `test_id=${headers["x-test-id"] ?? "none"} error=`,
  );
  return headersStorage.run(headers, fn);
}

/** Return the ALS-bound headers (or an empty map if not in scope). */
function getForwardedHeaders(): Record<string, string> {
  return headersStorage.getStore() ?? {};
}

/** fetch wrapper that injects ALS-bound x-* headers into every outbound call. */
const forwardingFetch: typeof fetch = (input, init) => {
  const forwarded = getForwardedHeaders();
  const merged = new Headers(init?.headers);
  for (const [k, v] of Object.entries(forwarded)) {
    // Don't clobber an explicit per-call header.
    if (!merged.has(k)) merged.set(k, v);
  }
  // Local aimock testing: a real browser does NOT send x-aimock-context, but
  // every mastra d6 fixture is context-scoped ("mastra"), so aimock returns
  // "No fixture matched" for browser-driven demos. Default the context to this
  // integration's slug when absent so the demos replay against aimock in a
  // plain browser. Harmless in production (real LLM providers ignore the
  // header); the harness still sends its own x-aimock-context, which wins.
  if (!merged.has("x-aimock-context")) {
    merged.set("x-aimock-context", "mastra");
  }
  // GATING RULE: only deviate from the original control flow (append the
  // x-diag-hops breadcrumb, emit the per-outbound CVDIAG log) when a
  // diagnostic header is present (x-diag-run-id OR x-aimock-context). On
  // non-diagnostic traffic the outbound headers stay byte-identical and we
  // skip the noisy per-outbound log.
  const slug = forwarded["x-aimock-context"];
  const runId = forwarded["x-diag-run-id"];
  const diagnosticPresent = runId != null || slug != null;
  if (!diagnosticPresent) {
    return fetch(input, { ...init, headers: merged });
  }
  // CVDIAG (outbound-llm): append this layer's hop tag to the breadcrumb
  // and log header presence at the moment the outbound LLM request is
  // built. x-diag-run-id / x-diag-hops ride the same x-* forwarding path
  // as x-aimock-context above; we only mutate the hops breadcrumb here.
  const priorHops = merged.get("x-diag-hops") ?? forwarded["x-diag-hops"] ?? "";
  const nextHops = priorHops ? `${priorHops},backend-mastra` : "backend-mastra";
  merged.set("x-diag-hops", nextHops);
  const hopCount = nextHops.split(",").filter(Boolean).length;
  console.log(
    `CVDIAG component=backend-mastra boundary=outbound-llm ` +
      `run_id=${runId ?? "none"} slug=${slug ?? "MISSING"} ` +
      `header_present=${slug != null} ` +
      `header_value_prefix=${slug ? slug.slice(0, 12) : ""} ` +
      `hop=${hopCount} status=${slug ? "ok" : "miss"} ` +
      `test_id=${forwarded["x-test-id"] ?? "none"} error=`,
  );
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
