/**
 * The Next.js side of the hop to the Cloudflare Worker.
 *
 * The agents run in a Cloudflare Worker (`src/agent`, `wrangler dev` on
 * :8000), one Agents SDK agent per backend. Each route reaches its agent with
 * a plain `HttpAgent` posting to `${AGENT_URL}/agents/<agent>`; the Worker's
 * `toThreadRequest` moves the run's thread id into the path, so every thread
 * lands on its own Durable Object.
 *
 * (`CloudflareAgentsHttpAgent` from `@ag-ui/cloudflare-agents/client` would put
 * the thread id in the URL itself, but it needs `@ag-ui/client` 1.x, and this
 * app is pinned to the CopilotKit release whose runtime ships `@ag-ui/client`
 * 0.0.57.)
 *
 * Header forwarding: the probe's `x-*` headers (`x-aimock-strict`,
 * `x-test-id`, `x-aimock-context`, `x-diag-*`) must reach the model call in
 * the Worker. `HttpAgent` headers are fixed at construction, so its `fetch` is
 * the per-request seam: `withForwardedHeaders` keeps the inbound `x-*`
 * headers in an AsyncLocalStorage for the request, and `forwardingFetch` adds
 * them to the POST. Requests without `x-*` headers are sent unchanged.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { HttpAgent } from "@ag-ui/client";
import type { HttpAgentConfig } from "@ag-ui/client";

export const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

/** The Worker's agents, by the path `routeAgentRequest` serves them at. */
export type CloudflareAgentName =
  | "showcase"
  | "beautiful-chat"
  | "voice"
  | "byoc-hashbrown"
  | "byoc-json-render"
  | "a2ui-fixed-schema"
  | "declarative-gen-ui"
  | "a2ui-recovery"
  | "interrupt"
  | "reasoning"
  | "reasoning-chain";

const forwarded = new AsyncLocalStorage<Record<string, string>>();

function xHeaders(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-")) out[lower] = value;
  });
  return out;
}

/** Runs `handle` with the request's `x-*` headers in scope for `forwardingFetch`. */
export function withForwardedHeaders<T>(request: Request, handle: () => T): T {
  return forwarded.run(xHeaders(request), handle);
}

const forwardingFetch: NonNullable<HttpAgentConfig["fetch"]> = (url, init) => {
  const headers = forwarded.getStore() ?? {};
  if (Object.keys(headers).length === 0) return fetch(url, init);
  const merged = new Headers(init?.headers);
  for (const [key, value] of Object.entries(headers)) {
    if (!merged.has(key)) merged.set(key, value);
  }
  return fetch(url, { ...init, headers: merged });
};

/** An AG-UI client for one of the Worker's agents. */
export function cloudflareAgent(name: CloudflareAgentName): HttpAgent {
  return new HttpAgent({
    url: `${AGENT_URL}/agents/${name}`,
    fetch: forwardingFetch,
  });
}
