/**
 * Header-forwarding helpers for ADK's CopilotKit routes.
 *
 * The ADK Next.js runtime fronts a separate Python agent_server which talks
 * to Gemini. To make `x-aimock-context` (and any other `x-*` request-scope
 * headers) reach aimock, we have to convey the headers across two hops:
 *
 *   1. Browser  →  Next.js /api/copilotkit*  (extraHTTPHeaders in Playwright)
 *   2. Next.js  →  Python agent_server  (THIS layer)
 *   3. Python   →  Gemini (httpx + aiohttp event hooks in _header_forwarding.py)
 *
 * Hop 2 is the conveyance the `HttpAgent` instances need: their static
 * `headers` config is the only thing `requestInit` sends on the outbound
 * fetch. We build a fresh HttpAgent per request inside the POST handler
 * with `headers` populated from the inbound `req.headers` (filtered to
 * `x-*`), so the Python middleware on the other end sees the header and
 * the per-request ContextVar fires correctly.
 */

import { HttpAgent } from "@ag-ui/client";
import type { NextRequest } from "next/server";

/**
 * Extract inbound `x-*` headers from a Next.js request into a flat
 * `Record<string, string>` suitable for the `HttpAgent` `headers` option.
 *
 * Only `x-*` is forwarded; everything else (authorization, content-type,
 * cookies, etc.) is intentionally dropped — those are connection-scoped
 * to this hop, not the LLM call.
 */
export function extractForwardedHeaders(
  req: NextRequest,
): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value: string, key: string) => {
    if (key.toLowerCase().startsWith("x-")) {
      out[key] = value;
    }
  });

  // CVDIAG instrumentation: light up the Node inbound hop. Every ADK
  // copilotkit-* route funnels through this helper before building its
  // HttpAgent, so this is the single Node-side observation point for the
  // x-aimock-context conveyance. We log presence (never the full value)
  // and append this layer's breadcrumb tag to x-diag-hops on the OUTBOUND
  // header set so the Python middleware / httpx hook can extend the chain.
  const slug = out["x-aimock-context"];
  const runId = out["x-diag-run-id"];
  const testId = out["x-test-id"];
  const present = typeof slug === "string" && slug.length > 0;
  // Gate the breadcrumb append on diagnostic-header presence: only extend
  // x-diag-hops when a diagnostic header (x-diag-run-id OR x-aimock-context)
  // is present. When NEITHER is present the outbound header set is left
  // byte-identical to pre-instrumentation behavior.
  const hasDiagHeader = typeof runId === "string" || typeof slug === "string";
  if (hasDiagHeader) {
    const HOP_TAG = "route-google-adk";
    const prevHops = out["x-diag-hops"] ?? "";
    out["x-diag-hops"] = prevHops ? `${prevHops},${HOP_TAG}` : HOP_TAG;
  }
  // eslint-disable-next-line no-console
  console.log(
    `CVDIAG component=route-google-adk boundary=inbound ` +
      `run_id=${runId ?? "none"} slug=${present ? slug : "MISSING"} ` +
      `header_present=${present} ` +
      `header_value_prefix=${present ? slug.slice(0, 12) : ""} ` +
      `hop=- status=${present ? "ok" : "miss"} ` +
      `test_id=${testId ?? "none"} error=`,
  );

  return out;
}

/**
 * Construct an `HttpAgent` whose outbound fetch will include the inbound
 * `x-*` headers from `req`. Use this from inside a POST handler when you
 * need a single-agent runtime (e.g. dedicated demo routes like
 * `copilotkit-multimodal`); for the multi-agent main route, call
 * `extractForwardedHeaders` and pass the result into each `HttpAgent`
 * constructor directly.
 */
export function createForwardingHttpAgent(
  url: string,
  req: NextRequest,
): HttpAgent {
  return new HttpAgent({
    url,
    headers: extractForwardedHeaders(req),
  });
}
