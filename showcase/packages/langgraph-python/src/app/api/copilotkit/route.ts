import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import {
  Middleware,
  RunAgentInput,
  AbstractAgent,
  BaseEvent,
  EventType,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { randomUUID } from "crypto";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] LANGGRAPH_URL: ${LANGGRAPH_URL}`);
console.log(
  `[copilotkit/route] LANGSMITH_API_KEY: ${process.env.LANGSMITH_API_KEY ? "set" : "not set"}`,
);

function createAgent(graphId: string = "sample_agent") {
  return new LangGraphAgent({
    deploymentUrl: LANGGRAPH_URL,
    graphId,
    langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  });
}

// Register the same agent under all names used by demo pages.
// Each demo specifies an agent ID; they all route to the same LangGraph graph.
const agentNames = [
  "agentic_chat",
  "frontend_tools",
  "human_in_the_loop",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "headless-simple",
  "headless-complete",
  "hitl-in-chat",
  "declarative-gen-ui",
  "a2ui-fixed-schema",
  "open-gen-ui",
];

const agents: Record<string, LangGraphAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
// Tool Rendering demo uses its own graph with a backend `get_weather` tool.
agents["tool-rendering"] = createAgent("tool_rendering");
// Declarative Generative UI (A2UI — Dynamic Schema) demo uses its own graph
// that emits `a2ui_operations` via the `generate_a2ui` tool.
agents["declarative-gen-ui"] = createAgent("a2ui_dynamic");
// Declarative Generative UI (A2UI — Fixed Schema) demo uses its own graph
// that emits `a2ui_operations` against a client-side fixed schema.
agents["a2ui-fixed-schema"] = createAgent("a2ui_fixed");
// Agentic Chat (Reasoning) demo uses its own graph that explicitly streams a
// reasoning chunk ahead of the final answer, so the amber "Reasoning" slot
// on the frontend is reliably populated with the base (non-reasoning) model.
agents["agentic-chat-reasoning"] = createAgent("reasoning_agent");
// Generative UI (Interrupt-based) demo uses its own graph with an
// `ask_confirmation` tool that calls langgraph's `interrupt()` to pause
// and surface a confirmation payload to the frontend.
agents["gen-ui-interrupt"] = createAgent("interrupt_agent");
// Open-Ended Generative UI demo uses its own graph that streams ONE
// `generateSandboxedUi` tool call; the OpenGenerativeUIMiddleware in the
// runtime converts it into `open-generative-ui` activity events.
agents["open-gen-ui"] = createAgent("open_gen_ui");

// MCP Apps demo: dedicated graph with a `show_mcp_app` tool. The TS
// MCPAppsStubMiddleware wraps the agent and (a) synthesizes an
// ACTIVITY_SNAPSHOT event when it sees the tool call complete, and
// (b) intercepts the follow-up `__proxiedMCPRequest` `resources/read`
// issued by `MCPAppsActivityRenderer` on mount, returning a pre-baked
// HTML resource so the sandboxed iframe has content to render.
const MCP_APPS_SERVER_ID = "mcp-apps-stub";
const MCP_APPS_RESOURCE_URI = "ui://mcp-apps-stub/demo";
const MCP_APPS_RESOURCE_HTML = `<!doctype html>
<html>
<head>
<style>
:root { color-scheme: light; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 24px;
  background: linear-gradient(135deg, #10b981, #059669);
  color: #fff;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(16, 185, 129, 0.3);
}
.card h1 { margin: 0; font-size: 20px; font-weight: 700; }
.card p { margin: 0; font-size: 14px; opacity: 0.95; line-height: 1.5; }
.badge {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  font-size: 12px;
  width: fit-content;
}
</style>
</head>
<body>
<div class="card">
  <h1>MCP App Loaded</h1>
  <p>This UI was rendered from a stub MCP resource via <code>MCPAppsActivityRenderer</code>.</p>
  <span class="badge">sandboxed &middot; stub server</span>
</div>
<script>
(function () {
  // Announce inner iframe is ready to host; report size up the postMessage chain.
  function send(msg) { window.parent.postMessage(msg, '*'); }
  function sendSize() {
    const w = document.documentElement.scrollWidth;
    const h = document.documentElement.scrollHeight;
    send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: w, height: h } });
  }
  send({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
  requestAnimationFrame(sendSize);
  window.addEventListener('resize', sendSize);
})();
</script>
</body>
</html>`;

class MCPAppsStubMiddleware extends Middleware {
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    // Frontend's MCPAppsActivityRenderer sends a `__proxiedMCPRequest` to
    // fetch the sandboxed resource. Short-circuit the agent run and respond
    // directly without invoking the LangGraph backend.
    const proxied = (
      input.forwardedProps as Record<string, unknown> | undefined
    )?.__proxiedMCPRequest as
      | { method?: string; params?: Record<string, unknown> }
      | undefined;
    if (proxied) {
      return new Observable<BaseEvent>((subscriber) => {
        subscriber.next({
          type: EventType.RUN_STARTED,
          runId: input.runId,
          threadId: input.threadId,
        } as BaseEvent);

        let result: unknown = {
          error: `Unsupported MCP method: ${proxied.method}`,
        };
        if (proxied.method === "resources/read") {
          const uri =
            (proxied.params as { uri?: string } | undefined)?.uri ??
            MCP_APPS_RESOURCE_URI;
          result = {
            contents: [
              {
                uri,
                mimeType: "text/html",
                text: MCP_APPS_RESOURCE_HTML,
                _meta: { ui: { prefersBorder: false } },
              },
            ],
          };
        }

        subscriber.next({
          type: EventType.RUN_FINISHED,
          runId: input.runId,
          threadId: input.threadId,
          result,
        } as BaseEvent);
        subscriber.complete();
      });
    }

    // Normal run: let the agent stream through, and when we see the
    // `show_mcp_app` tool call finish, inject an ACTIVITY_SNAPSHOT so
    // `MCPAppsActivityRenderer` mounts with our stub content.
    return new Observable<BaseEvent>((subscriber) => {
      const pendingCalls = new Map<string, { name?: string; args: string }>();
      const emittedActivity = new Set<string>();

      const sub = this.runNextWithState(input, next).subscribe({
        next: ({ event }) => {
          subscriber.next(event);

          if (event.type === EventType.TOOL_CALL_START) {
            const e = event as unknown as {
              toolCallId: string;
              toolCallName?: string;
            };
            pendingCalls.set(e.toolCallId, {
              name: e.toolCallName,
              args: "",
            });
          } else if (event.type === EventType.TOOL_CALL_ARGS) {
            const e = event as unknown as {
              toolCallId: string;
              delta?: string;
            };
            const entry = pendingCalls.get(e.toolCallId);
            if (entry) entry.args += e.delta ?? "";
          } else if (event.type === EventType.TOOL_CALL_END) {
            const e = event as unknown as { toolCallId: string };
            const entry = pendingCalls.get(e.toolCallId);
            if (
              entry &&
              entry.name === "show_mcp_app" &&
              !emittedActivity.has(e.toolCallId)
            ) {
              emittedActivity.add(e.toolCallId);
              let toolInput: Record<string, unknown> = {};
              try {
                toolInput = entry.args ? JSON.parse(entry.args) : {};
              } catch {
                toolInput = {};
              }

              subscriber.next({
                type: EventType.ACTIVITY_SNAPSHOT,
                messageId: randomUUID(),
                activityType: "mcp-apps",
                content: {
                  result: {
                    content: [
                      {
                        type: "text",
                        text: `Showing MCP app: ${toolInput.title ?? "Demo"}`,
                      },
                    ],
                    isError: false,
                  },
                  resourceUri: MCP_APPS_RESOURCE_URI,
                  serverHash: "stub",
                  serverId: MCP_APPS_SERVER_ID,
                  toolInput,
                },
                replace: true,
              } as BaseEvent);
            }
          }
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

      return () => sub.unsubscribe();
    });
  }
}

const mcpAppsAgent = createAgent("mcp_apps");
mcpAppsAgent.use(new MCPAppsStubMiddleware());
agents["mcp-apps"] = mcpAppsAgent;

// Also register a default
agents["default"] = createAgent();

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) => {
  const url = req.url;
  const contentType = req.headers.get("content-type");
  console.log(`[copilotkit/route] POST ${url} (content-type: ${contentType})`);

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
        // A2UI middleware — scoped to only the A2UI demos so non-A2UI agents
        // (e.g. gen-ui-tool-based) don't get the A2UI tool injected, which
        // would otherwise compete with their `useComponent` renderers.
        a2ui: {
          injectA2UITool: true,
          agents: ["declarative-gen-ui", "a2ui-fixed-schema"],
        },
        // NOTE: OpenGenerativeUI is intentionally NOT enabled here. Turning
        // it on advertises `openGenerativeUIEnabled: true` globally via the
        // runtime probe, which makes the CopilotKit client provider wipe
        // per-demo `useFrontendTool` / `useComponent` registrations on the
        // setTools effect, breaking demos like gen-ui-tool-based. The
        // open-gen-ui demo uses a separate endpoint at /api/copilotkit-ogui.
      }),
    });

    const response = await handleRequest(req);
    console.log(`[copilotkit/route] Response status: ${response.status}`);
    return response;
  } catch (error: any) {
    console.error(`[copilotkit/route] ERROR: ${error.message}`);
    console.error(`[copilotkit/route] Stack: ${error.stack}`);
    return NextResponse.json(
      { error: error.message, stack: error.stack },
      { status: 500 },
    );
  }
};

export const GET = async () => {
  console.log("[copilotkit/route] GET /api/copilotkit (health probe)");

  // Check if LangGraph server is reachable
  let langGraphStatus = "unknown";
  try {
    const res = await fetch(`${LANGGRAPH_URL}/ok`, {
      signal: AbortSignal.timeout(3000),
    });
    langGraphStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: any) {
    langGraphStatus = `unreachable (${e.message})`;
  }

  return NextResponse.json({
    status: "ok",
    langgraph_url: LANGGRAPH_URL,
    langgraph_status: langGraphStatus,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
