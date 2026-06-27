/**
 * LangGraph TypeScript agent for the A2UI Error Recovery demo (OSS-158 / OSS-375).
 *
 * Same dynamic-schema A2UI setup as `a2ui-dynamic.ts` (declarative-gen-ui), but
 * with the toolkit's validate->retry recovery loop made *visible*. The two
 * aimock pills drive the inner `render_a2ui` sub-agent two ways:
 *   - HEAL pill: the model emits FREE-FORM / sloppy A2UI args (components and
 *     data as JSON strings) — the toolkit heals them via parse_and_fix into a
 *     valid surface in a single pass, which paints.
 *   - EXHAUST pill: every attempt is structurally invalid (the root references a
 *     missing child), so the validate->retry loop hits the cap and the tool
 *     returns the `a2ui_recovery_exhausted` hard-fail envelope, which the
 *     renderer surfaces as a tasteful `failed` state (no broken surface).
 *
 * Backend-owned wiring: unlike the declarative-gen-ui demo (which relies on the
 * CopilotKit runtime auto-injecting `generate_a2ui`), this agent OWNS the tool
 * via `@ag-ui/langgraph` `getA2UITools`, whose body runs the `render_a2ui`
 * sub-agent + the toolkit recovery loop IN-GRAPH. The dedicated route sets
 * `injectA2UITool: false` so the runtime does not inject a second copy.
 *
 * Mirrors `showcase/integrations/langgraph-python/src/agents/recovery_agent.py`.
 * Catalog is reused from declarative-gen-ui ("declarative-gen-ui-catalog"); the
 * Vantage Threads sales dataset + composition rules arrive from the frontend via
 * App Context (declarative-gen-ui/sales-context.ts).
 */

import { createAgent } from "langchain";
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

const a2uiTool = getA2UITools({
  model: new ChatOpenAI({ model: "gpt-4.1" }),
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
  model: new ChatOpenAI({ model: "gpt-4.1" }),
  // Cast: tool typed against @ag-ui/langgraph's own @langchain/core peer.
  tools: [a2uiTool as any],
  middleware: [copilotkitMiddleware],
  systemPrompt: SYSTEM_PROMPT,
});
