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
  // CVDIAG (als-snapshot): record whether the inbound x-aimock-context
  // discriminator was present at the moment we capture the header
  // snapshot into ALS. Never log the full value — prefix only.
  const slug = headers["x-aimock-context"];
  const runId = headers["x-diag-run-id"];
  const hops = headers["x-diag-hops"];
  const hopCount = hops ? hops.split(",").filter(Boolean).length : 0;
  console.log(
    `CVDIAG component=route-built-in-agent boundary=als-snapshot ` +
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
  const nextHops = priorHops
    ? `${priorHops},backend-built-in-agent`
    : "backend-built-in-agent";
  merged.set("x-diag-hops", nextHops);
  const hopCount = nextHops.split(",").filter(Boolean).length;
  console.log(
    `CVDIAG component=backend-built-in-agent boundary=outbound-llm ` +
      `run_id=${runId ?? "none"} slug=${slug ?? "MISSING"} ` +
      `header_present=${slug != null} ` +
      `header_value_prefix=${slug ? slug.slice(0, 12) : ""} ` +
      `hop=${hopCount} status=${slug ? "ok" : "miss"} ` +
      `test_id=${forwarded["x-test-id"] ?? "none"} error=`,
  );
  return fetch(input, { ...init, headers: merged });
};
