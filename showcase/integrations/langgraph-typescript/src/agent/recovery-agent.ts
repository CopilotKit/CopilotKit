/**
 * LangGraph TypeScript agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).
 *
 * Same dynamic-schema A2UI setup as `a2ui-dynamic.ts` (declarative-gen-ui), but
 * with the toolkit's validate->retry recovery loop made *visible*. The two
 * aimock pills drive the inner `render_a2ui` sub-agent two ways:
 *   - HEAL pill: attempt 1 (aimock sequenceIndex 0) is structurally INVALID
 *     (the root references a missing child) — the validate->retry loop rejects
 *     it and retries; attempt 2 (sequenceIndex 1) is VALID and paints.
 *   - EXHAUST pill: every attempt is structurally invalid (the root references
 *     a missing child), so the validate->retry loop hits the cap and the tool
 *     returns the `a2ui_recovery_exhausted` hard-fail envelope, which the
 *     renderer surfaces as a tasteful `failed` state (no broken surface).
 *
 * Backend-owned wiring: unlike the declarative-gen-ui demo (which relies on the
 * CopilotKit runtime auto-injecting `generate_a2ui`), this agent OWNS the tool
 * via `@ag-ui/langgraph` `getA2UITools`, whose body runs the `render_a2ui`
 * sub-agent + the toolkit recovery loop IN-GRAPH. The dedicated route sets
 * `injectA2UITool: false` so the runtime does not inject a second copy.
 *
 * Header forwarding (load-bearing for aimock D6 stability — OSS-583):
 * `getA2UITools` invokes its inner `render_a2ui` sub-agent via a CONFIG-LESS
 * `model.stream(...)` call, so the config-based header-forwarding path used by
 * every other langgraph-typescript agent (`makeChatOpenAI`, which reads
 * `config.configurable.copilotkit_forwarded_headers`) can NOT reach the inner
 * render call. Without forwarding, the inner render's aimock request carries no
 * `x-test-id`, so aimock buckets its `sequenceIndex` state under the shared
 * `DEFAULT_TEST_ID` — which the harness never resets between runs. Result: the
 * heal fixture's seq0(invalid)->seq1(valid) staging works on the FIRST run but
 * the consumed valid response is never re-served on subsequent runs (the loop
 * then exhausts and reds). This mirrors the flake mastra solved at the fetch
 * layer (`_header_forwarding.ts`).
 *
 * Fix (mirrors the mastra fetch+ALS mechanism, adapted to the LangGraph server):
 * an AsyncLocalStorage store holds the inbound `x-*` headers; the models' custom
 * `fetch` merges them onto every outbound OpenAI call (including the inner
 * render). The store is bound by `wrapModelCall` / `wrapToolCall` middleware,
 * which read `copilotkit_forwarded_headers` off the per-call runtime config and
 * run the handler inside `store.run(...)` — enclosing the outer emit AND the
 * config-less inner render sub-agent stream (which executes inside the tool
 * handler). A `beforeAgent`+`enterWith` binding does NOT work here: Pregel runs
 * each node in a separate async context, so the store would not reach the tool
 * node.
 *
 * Mirrors `showcase/integrations/langgraph-python/src/agents/recovery_agent.py`.
 * Catalog is reused from declarative-gen-ui ("declarative-gen-ui-catalog"); the
 * Vantage Threads sales dataset + composition rules arrive from the frontend via
 * App Context (declarative-gen-ui/sales-context.ts).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createAgent, createMiddleware } from "langchain";
import { copilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { getA2UITools } from "@ag-ui/langgraph";
import type { A2UIAttemptRecord } from "@ag-ui/langgraph";

const SYSTEM_PROMPT =
  "You are the embedded sales analyst for Vantage Threads, the fictional B2B " +
  "apparel company described in your App Context. Answer every business " +
  "question by calling `generate_a2ui` to draw a rich visual surface, and keep " +
  "the chat reply to one short sentence. Ground every number in the sales " +
  "dataset from your App Context. `generate_a2ui` handles the rendering — and " +
  "its automatic recovery — for you.";

/**
 * ALS-bound snapshot of the inbound `x-*` headers for the current graph run.
 * Populated by `headerForwardingMiddleware.beforeAgent` (which has the config)
 * and read by `forwardingFetch` on every outbound OpenAI call — including the
 * config-less inner `render_a2ui` sub-agent stream.
 */
const forwardedHeadersStore = new AsyncLocalStorage<Record<string, string>>();

/** Merge the ALS-bound `x-*` headers onto every outbound OpenAI request so the
 *  inner render sub-agent's aimock call carries `x-test-id` / `x-aimock-context`. */
const forwardingFetch: typeof fetch = (input, init) => {
  const forwarded = forwardedHeadersStore.getStore() ?? {};
  const merged = new Headers(init?.headers);
  for (const [k, v] of Object.entries(forwarded)) {
    // Don't clobber an explicit per-call header.
    if (!merged.has(k)) merged.set(k, v);
  }
  return fetch(input, { ...init, headers: merged });
};

/** Read the `copilotkit_forwarded_headers` map (set by @ag-ui/langgraph) off a
 *  configurable object, keeping only string `x-*` entries. */
function extractXHeaders(
  configurable: Record<string, unknown> | undefined,
): Record<string, string> {
  const raw = configurable?.copilotkit_forwarded_headers;
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && k.toLowerCase().startsWith("x-")) {
        out[k.toLowerCase()] = v;
      }
    }
  }
  return out;
}

/**
 * Bind the inbound `x-*` headers into ALS around the model call AND the tool
 * call, so every outbound OpenAI request inside either — including the
 * config-less inner `render_a2ui` sub-agent stream that runs inside the tool
 * handler — sees them via `forwardingFetch`.
 *
 * Why `wrapModelCall`/`wrapToolCall` and NOT `beforeAgent`+`enterWith`: the
 * LangGraph Pregel executor dispatches each node (beforeAgent, model, tool) in
 * a SEPARATE async context, so a store set with `enterWith` in `beforeAgent`
 * does not propagate into the later tool node. `wrapToolCall` instead runs the
 * tool `handler` INSIDE this hook's async scope, so `forwardedHeadersStore.run`
 * correctly encloses the inner render sub-agent's fetch.
 */
const headerForwardingMiddleware = createMiddleware({
  name: "a2ui-recovery-header-forwarding",
  wrapModelCall: (
    request: { runtime?: { configurable?: Record<string, unknown> } },
    handler: (req: any) => any,
  ) => {
    const headers = extractXHeaders(request?.runtime?.configurable);
    return forwardedHeadersStore.run(headers, () => handler(request));
  },
  wrapToolCall: (
    request: { runtime?: { configurable?: Record<string, unknown> } },
    handler: (req: any) => any,
  ) => {
    const headers = extractXHeaders(request?.runtime?.configurable);
    return forwardedHeadersStore.run(headers, () => handler(request));
  },
});

const a2uiTool = getA2UITools({
  model: new ChatOpenAI({
    model: "gpt-4.1",
    configuration: { fetch: forwardingFetch },
  }),
  defaultCatalogId: "declarative-gen-ui-catalog",
  // Recovery loop runs by default; pinned here so the renderer's "Retrying…
  // (N/M)" label matches the adapter's cap.
  recovery: { maxAttempts: 3 },
  onA2UIAttempt: (rec: A2UIAttemptRecord) => {
    // Dev observability: each attempt (incl. rejected ones) is logged.
    // eslint-disable-next-line no-console
    console.log(
      `[a2ui recovery] attempt ${rec.attempt}: ${rec.ok ? "valid" : "invalid"}`,
      rec.errors,
    );
  },
});

export const graph = createAgent({
  model: new ChatOpenAI({
    model: "gpt-4.1",
    configuration: { fetch: forwardingFetch },
  }),
  // Cast: tool typed against @ag-ui/langgraph's own @langchain/core peer.
  tools: [a2uiTool as any],
  middleware: [headerForwardingMiddleware, copilotkitMiddleware],
  systemPrompt: SYSTEM_PROMPT,
});
