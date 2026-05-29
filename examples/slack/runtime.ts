/**
 * Standalone CopilotKit Runtime for the Slack bridge.
 *
 * Replaces the earlier `serve_agui.py` thin AG-UI wrapper. The runtime
 * is the canonical adapter between the LangGraph agents and an AG-UI
 * client (the Slack bridge's HttpAgent). Critically, it auto-applies
 * the middleware stack the showcase agents expect — `A2UIMiddleware`
 * in particular, configured with `injectA2UITool: false` so the
 * dynamic-schema agent's own `generate_a2ui` tool stays in scope.
 *
 * Going via `LangGraphAgent` (which proxies to the local `langgraph
 * dev` server on 8123) keeps the agents as published in the showcase —
 * we do NOT import the Python graphs directly. This mirrors the
 * production Next.js routes under `agent/src/app/api/copilotkit-*`.
 *
 * Exposed routes (multi-route mode under `basePath = "/api/copilotkit"`):
 *   - POST /api/copilotkit/agent/:agentId/run     — what the bridge POSTs to
 *   - GET  /api/copilotkit/info
 *   - …others (connect, stop, threads — unused by the bridge today)
 *
 * Set the bridge's `AGENT_URL` to e.g.
 *   http://localhost:8200/api/copilotkit/agent/a2ui_dynamic/run
 */
import "dotenv/config";
import { createServer } from "node:http";
import { CopilotSseRuntime } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env["LANGGRAPH_DEPLOYMENT_URL"] ?? "http://localhost:8123";

function makeLgAgent(graphId: string) {
  return new LangGraphAgent({
    deploymentUrl: LANGGRAPH_URL,
    graphId,
    langsmithApiKey: process.env["LANGSMITH_API_KEY"] ?? "",
    assistantConfig: { recursion_limit: 100 },
  });
}

// One CopilotRuntime serves every agent the bridge might want — the
// path discriminator (`/agent/:agentId/run`) selects which one runs.
//
// `a2ui.injectA2UITool: false` matches the showcase config: the
// dynamic agent ships its OWN `generate_a2ui` tool; auto-injecting a
// runtime `render_a2ui` on top would duplicate the slot and confuse
// the LLM (this is what the showcase routes call out explicitly).
const runtime = new CopilotSseRuntime({
  agents: {
    a2ui_dynamic: makeLgAgent("a2ui_dynamic"),
    a2ui_fixed: makeLgAgent("a2ui_fixed"),
    beautiful_chat: makeLgAgent("beautiful_chat"),
    interrupt_agent: makeLgAgent("interrupt_agent"),
  },
  a2ui: {
    // The showcase `a2ui_dynamic` agent exposes a custom outer tool
    // named `generate_a2ui` (it doesn't use the canonical `render_a2ui`
    // tool name the middleware defaults to). Pass that name explicitly
    // so the middleware tracks the streaming args and synthesizes
    // ACTIVITY_SNAPSHOT events from them. The middleware ALSO has a
    // tool-result fallback that detects `{a2ui_operations: [...]}` in
    // any tool result content, but the fast path is more reliable for
    // the secondary-LLM-emitted designs.
    injectA2UITool: false,
    a2uiToolNames: ["generate_a2ui"],
  },
});

const listener = createCopilotNodeListener({
  runtime,
  basePath: "/api/copilotkit",
  cors: true,
});

const port = Number(process.env["PORT"] ?? 8200);
createServer(listener).listen(port, () => {
  console.log(
    `[slack-runtime] CopilotKit runtime listening on http://localhost:${port}/api/copilotkit/agent/<agentId>/run`,
  );
  console.log(
    "[slack-runtime] registered agents: a2ui_dynamic, a2ui_fixed, beautiful_chat, interrupt_agent",
  );
});
