/**
 * The OpenAI provider of the Mastra agents, and the fetch that every one of
 * their LLM calls goes through.
 *
 * @ag-ui/mastra's adapter does NOT forward inbound HTTP headers (e.g.
 * `x-aimock-context`) to the underlying Vercel AI SDK model provider. Without
 * them, aimock cannot scope fixture matches by integration and every
 * /v1/responses call returns 404. The runtime route runs each request inside
 * `withForwardedHeaders`, so this fetch reads the request's `x-*` headers with
 * `forwardedHeaders()` and adds them to every outbound LLM request.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { forwardedHeaders } from "@/lib/agents";

/**
 * OpenAI's Responses API validates `input[].id` and REJECTS any id containing
 * a dash. (Its 400 message misleadingly lists dashes as allowed — empirically
 * only `[A-Za-z0-9_]` is accepted; an id like `msg-92Y7BhMpWBhXt7dm` 400s while
 * `msg_92Y7BhMpWBhXt7dm` succeeds.) CopilotKit mints message ids like `msg-…`,
 * and @ag-ui/mastra + the AI SDK forward them straight into `input[].id`, so
 * every multi-turn run fails with
 *   AI_APICallError: Invalid 'input[N].id': 'msg-…'
 * (OSS-381). Fix at the HTTP boundary: rewrite dashes (and any other
 * non-`[A-Za-z0-9_]` char) in each outbound `input[].id` to `_`.
 *
 * Why here and not in the bridge's message conversion: this touches ONLY the
 * bytes sent to OpenAI. Mastra's in-memory `CoreMessage.id` — which drives its
 * upsert-by-id history dedup — is left untouched, so dedup is unaffected.
 * OpenAI-issued ids (`msg_…`, `rs_…`) contain no dashes and pass through
 * unchanged, preserving server-side conversation-state references.
 */
export function toOpenAiResponsesSafeId(id: string): string {
  return /^[A-Za-z0-9_]+$/.test(id) ? id : id.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Rewrite out-of-charset `input[].id`s in an outbound OpenAI Responses request
 * body. Returns the body unchanged when it isn't a JSON string, has no `input`
 * array, or needs no rewrite (the common case — a no-op).
 */
export function sanitizeOutboundResponsesIds(
  body: BodyInit | null | undefined,
): BodyInit | null | undefined {
  if (typeof body !== "string") return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const input = (parsed as { input?: unknown } | null)?.input;
  if (!Array.isArray(input)) return body;
  let changed = false;
  for (const item of input) {
    const withId = item as { id?: unknown } | null;
    if (withId && typeof withId.id === "string") {
      const safe = toOpenAiResponsesSafeId(withId.id);
      if (safe !== withId.id) {
        withId.id = safe;
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(parsed) : body;
}

/**
 * `fetch` that adds the `x-*` headers of the request being handled and makes
 * the message ids in the body legal for the OpenAI Responses API.
 */
export const forwardingFetch: typeof fetch = (input, init) => {
  const merged = new Headers(init?.headers);
  // Make client-minted message ids (e.g. `msg-…`) legal for the OpenAI
  // Responses API. No-op for valid ids; never touches Mastra's dedup state.
  const body = sanitizeOutboundResponsesIds(init?.body);
  for (const [k, v] of Object.entries(forwardedHeaders())) {
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
  return fetch(input, { ...init, headers: merged, body });
};

/**
 * Drop-in replacement for `import { openai } from "@ai-sdk/openai"`.
 * Same call signature: `openai("gpt-6-luna")` returns a model that uses the
 * forwarding fetch on every outbound LLM call.
 */
export const openai = createOpenAI({
  fetch: forwardingFetch,
});
