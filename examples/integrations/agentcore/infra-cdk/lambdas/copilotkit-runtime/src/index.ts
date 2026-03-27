import { EventType, HttpAgent, type BaseEvent } from "@ag-ui/client"
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware"
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from "@copilotkit/runtime/v2"
import { streamHandle } from "hono/aws-lambda"
import { concatMap, of } from "rxjs"
import { randomUUID } from "node:crypto"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }
  return value
}

function getConfiguredAgents(): Record<string, HttpAgent> {
  const configuredAgents: Record<string, HttpAgent> = {}

  const agentUrls = {
    "langgraph-single-agent": process.env.LANGGRAPH_AGENTCORE_AG_UI_URL,
    "strands-single-agent": process.env.STRANDS_AGENTCORE_AG_UI_URL,
  }

  const mcpServerUrl = process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com"

  for (const [name, url] of Object.entries(agentUrls)) {
    if (url) {
      const agent = new HttpAgent({ url, headers: {} })
      agent.use(
        new MCPAppsMiddleware({
          mcpServers: [
            {
              type: "http",
              url: mcpServerUrl,
              serverId: "example_mcp_app",
            },
          ],
        })
      )
      configuredAgents[name] = agent
    }
  }

  if (Object.keys(configuredAgents).length === 0) {
    configuredAgents.default = new HttpAgent({
      url: requireEnv("AGENTCORE_AG_UI_URL"),
      headers: {},
    })
  }

  return configuredAgents
}

const agentName = process.env.COPILOTKIT_AGENT_NAME ?? "default"
const agents = getConfiguredAgents()
const defaultAgent = agents[agentName] ?? agents.default ?? Object.values(agents)[0]

if (!defaultAgent) {
  throw new Error("At least one CopilotKit agent URL must be configured")
}

class CopilotKitRunner extends InMemoryAgentRunner {
  private readonly knownThreadIds = new Set<string>()

  override run(request: Parameters<InMemoryAgentRunner["run"]>[0]): ReturnType<InMemoryAgentRunner["run"]> {
    if (request.threadId) {
      this.knownThreadIds.add(request.threadId)
    }

    return super.run(request)
  }

  override connect(
    request: Parameters<InMemoryAgentRunner["connect"]>[0]
  ): ReturnType<InMemoryAgentRunner["connect"]> {
    if (!request.threadId || !this.knownThreadIds.has(request.threadId)) {
      const runId =
        typeof (request as { runId?: unknown }).runId === "string"
          ? ((request as { runId?: string }).runId ?? randomUUID())
          : randomUUID()

      const emptySnapshot = of(
        {
          type: EventType.RUN_STARTED,
          threadId: request.threadId ?? randomUUID(),
          runId,
        } as BaseEvent,
        {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [],
        } as BaseEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId: request.threadId ?? randomUUID(),
          runId,
        } as BaseEvent
      )

      return emptySnapshot as unknown as ReturnType<InMemoryAgentRunner["connect"]>
    }

    const connect$ = super.connect(request) as any

    return connect$.pipe(
      concatMap((event: any) => {
        if (event.type !== EventType.MESSAGES_SNAPSHOT || !("messages" in event)) {
          return of(event)
        }

        const replayedResults = event.messages.flatMap((message: any) => {
          if (message.role !== "assistant" || !message.toolCalls?.length) {
            return []
          }

          return message.toolCalls.map((toolCall: any) => ({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: toolCall.id,
            messageId: `${toolCall.id}-result`,
            content: "",
            role: "tool",
          } satisfies BaseEvent))
        })

        return of(...replayedResults, event)
      })
    ) as ReturnType<InMemoryAgentRunner["connect"]>
  }
}

const runtime = new CopilotRuntime({
  agents: {
    ...agents,
    default: defaultAgent,
  },
  runner: new CopilotKitRunner(),
})

const app = createCopilotEndpoint({
  runtime,
  basePath: "/copilotkit",
})


export const handler: (...args: unknown[]) => unknown = streamHandle(app) as (
  ...args: unknown[]
) => unknown
