/**
 * Shared CopilotKit runtime — the single source of truth.
 * Imported by index.ts (Lambda) and server.ts (local dev).
 */
import { EventType, HttpAgent, type BaseEvent } from "@ag-ui/client";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { concatMap, of } from "rxjs";
import { randomUUID } from "node:crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

export function buildAgents(): Record<string, HttpAgent> {
  const agents: Record<string, HttpAgent> = {};

  const agentUrls = {
    "langgraph-single-agent": process.env.LANGGRAPH_AGENTCORE_AG_UI_URL,
    "strands-single-agent": process.env.STRANDS_AGENTCORE_AG_UI_URL,
  };

  const mcpServerUrl =
    process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com";

  for (const [name, url] of Object.entries(agentUrls)) {
    if (url) {
      const agent = new HttpAgent({ url, headers: {} });
      agent.use(
        new MCPAppsMiddleware({
          mcpServers: [
            { type: "http", url: mcpServerUrl, serverId: "example_mcp_app" },
          ],
        }),
      );
      agents[name] = agent;
    }
  }

  if (Object.keys(agents).length === 0) {
    agents.default = new HttpAgent({
      url: requireEnv("AGENTCORE_AG_UI_URL"),
      headers: {},
    });
  }

  return agents;
}

/**
 * AgentCore stores conversation history in its own memory layer (AgentCoreMemorySaver /
 * AgentCoreMemorySessionManager). When CopilotKit reconnects to an existing thread
 * (e.g. page refresh), it calls `connect()` which replays that stored history as a
 * MESSAGES_SNAPSHOT event. Two issues arise from this that this runner fixes:
 *
 * 1. Unknown threads — CopilotKit may call `connect()` for a thread it has never
 *    `run()` against (e.g. on first load). The base runner would error; instead we
 *    return an empty snapshot so the UI initialises cleanly.
 *
 * 2. Missing tool-call results — AgentCore's snapshot includes assistant messages
 *    with tool calls, but the corresponding TOOL_CALL_RESULT events are absent.
 *    CopilotKit needs those results to reconcile its internal message state. We
 *    synthesise empty results for every past tool call before emitting the snapshot.
 */
export class AgentCoreRunner extends InMemoryAgentRunner {
  private readonly knownThreadIds = new Set<string>();

  override run(
    request: Parameters<InMemoryAgentRunner["run"]>[0],
  ): ReturnType<InMemoryAgentRunner["run"]> {
    if (request.threadId) this.knownThreadIds.add(request.threadId);
    return super.run(request);
  }

  override connect(
    request: Parameters<InMemoryAgentRunner["connect"]>[0],
  ): ReturnType<InMemoryAgentRunner["connect"]> {
    if (!request.threadId || !this.knownThreadIds.has(request.threadId)) {
      // Unknown thread — return an empty snapshot instead of erroring.
      const runId =
        typeof (request as { runId?: unknown }).runId === "string"
          ? ((request as { runId?: string }).runId ?? randomUUID())
          : randomUUID();

      return of(
        {
          type: EventType.RUN_STARTED,
          threadId: request.threadId ?? randomUUID(),
          runId,
        } as BaseEvent,
        { type: EventType.MESSAGES_SNAPSHOT, messages: [] } as BaseEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId: request.threadId ?? randomUUID(),
          runId,
        } as BaseEvent,
      ) as unknown as ReturnType<InMemoryAgentRunner["connect"]>;
    }

    // Known thread — replay synthetic tool-call results before the snapshot so
    // CopilotKit can reconcile its message state correctly.
    return (super.connect(request) as any).pipe(
      concatMap((event: any) => {
        if (
          event.type !== EventType.MESSAGES_SNAPSHOT ||
          !("messages" in event)
        )
          return of(event);
        const replayedResults = event.messages.flatMap((message: any) => {
          if (message.role !== "assistant" || !message.toolCalls?.length)
            return [];
          return message.toolCalls.map(
            (toolCall: any) =>
              ({
                type: EventType.TOOL_CALL_RESULT,
                toolCallId: toolCall.id,
                messageId: `${toolCall.id}-result`,
                content: "",
                role: "tool",
              }) satisfies BaseEvent,
          );
        });
        return of(...replayedResults, event);
      }),
    ) as ReturnType<InMemoryAgentRunner["connect"]>;
  }
}

export function buildApp() {
  const agents = buildAgents();
  const agentName = process.env.COPILOTKIT_AGENT_NAME ?? "default";
  const defaultAgent =
    agents[agentName] ?? agents.default ?? Object.values(agents)[0];

  if (!defaultAgent)
    throw new Error("At least one CopilotKit agent URL must be configured");

  const runtime = new CopilotRuntime({
    agents: { ...agents, default: defaultAgent },
    runner: new AgentCoreRunner(),
  });

  return createCopilotEndpoint({ runtime, basePath: "/copilotkit" });
}
