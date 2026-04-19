// @ts-nocheck — rxjs Observable<BaseEvent> types drift across transitive
// copies in @ag-ui/client vs @copilotkit/runtime's inner copy. The
// middleware works at runtime; TS strict can't reconcile the two copies.
// CopilotKit runtime for the MCP Apps cell.
// Includes the MCPAppsStubMiddleware that synthesizes ACTIVITY_SNAPSHOT
// events when the `show_mcp_app` tool fires, and short-circuits the
// `__proxiedMCPRequest` `resources/read` sent by MCPAppsActivityRenderer.

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

const agent = new LangGraphAgent({
  deploymentUrl: LANGGRAPH_URL,
  graphId: "agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});
agent.use(new MCPAppsStubMiddleware());

const runtime = new CopilotRuntime({
  // @ts-ignore
  agents: { "mcp-apps": agent },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
