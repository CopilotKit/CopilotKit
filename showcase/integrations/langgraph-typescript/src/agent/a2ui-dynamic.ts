/**
 * LangGraph TypeScript agent for the Declarative Generative UI (A2UI — Dynamic Schema) demo.
 */

import { ChatOpenAI } from "@langchain/openai";
import { createAgent, createMiddleware } from "langchain";
import { copilotkitMiddleware } from "@copilotkit/sdk-js/langgraph";

const SYSTEM_PROMPT =
  "You are a demo assistant for Declarative Generative UI (A2UI — Dynamic " +
  "Schema). Whenever a response would benefit from a rich visual — a " +
  "dashboard, status report, KPI summary, card layout, info grid, a " +
  "pie/donut chart of part-of-whole breakdowns, or a bar chart comparing " +
  "values across categories — call `generate_a2ui` to draw it. Keep chat " +
  "replies to one short sentence and let the UI do the talking.";

export const graph = createAgent({
  model: new ChatOpenAI({ model: "gpt-5-mini" }),
  tools: [],
  middleware: [copilotkitMiddleware],
  systemPrompt: SYSTEM_PROMPT,
});

// Showcase-only variant, registered in langgraph.json and server.mjs: the
// public `graph` above stays copy-pasteable. `createAgent` builds its model
// once, so `makeChatOpenAI(config, ...)` cannot be used here; instead this
// middleware copies the inbound `x-*` headers that @ag-ui/langgraph puts on
// `configurable.copilotkit_forwarded_headers` (x-aimock-context, x-test-id,
// ...) onto each model call's request headers, as copilotkitMiddleware does
// with its own forwarded headers. Since CopilotKit 1.77.0 the agent sees the
// runtime-injected `generate_a2ui` tool, so this call must carry them.
const forwardHeaders = createMiddleware({
  name: "showcase-header-forwarding",
  wrapModelCall: (
    request: {
      runtime?: { configurable?: Record<string, unknown> };
      modelSettings?: Record<string, unknown> & {
        headers?: Record<string, string>;
      };
    },
    handler: (req: any) => any,
  ) => {
    const raw = request.runtime?.configurable?.copilotkit_forwarded_headers;
    const headers: Record<string, string> = {};
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "string" && k.toLowerCase().startsWith("x-")) {
          headers[k.toLowerCase()] = v;
        }
      }
    }
    if (Object.keys(headers).length === 0) return handler(request);
    const settings = request.modelSettings ?? {};
    return handler({
      ...request,
      modelSettings: {
        ...settings,
        headers: { ...settings.headers, ...headers },
      },
    });
  },
});

export const showcaseGraph = createAgent({
  model: new ChatOpenAI({ model: "gpt-5-mini" }),
  tools: [],
  middleware: [forwardHeaders, copilotkitMiddleware],
  systemPrompt: SYSTEM_PROMPT,
});
