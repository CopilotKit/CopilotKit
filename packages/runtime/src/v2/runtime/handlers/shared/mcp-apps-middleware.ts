import { EventType, Middleware } from "@ag-ui/client";
import type {
  AbstractAgent,
  ActivitySnapshotEvent,
  BaseEvent,
  Message,
  RunAgentInput,
  RunFinishedEvent,
  RunStartedEvent,
  Tool,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Observable } from "rxjs";
import type { Subscriber } from "rxjs";

export const MCPAppsActivityType = "mcp-apps";

export interface ProxiedMCPRequest {
  serverHash: string;
  serverId?: string;
  method: string;
  params?: Record<string, unknown>;
}

type ExtractObservableType<T> = T extends Observable<infer U> ? U : never;
type RunNextWithStateReturn = ReturnType<Middleware["runNextWithState"]>;
type EventWithState = ExtractObservableType<RunNextWithStateReturn>;

export interface MCPClientConfigHTTP {
  type: "http";
  url: string;
  serverId?: string;
}

export interface MCPClientConfigSSE {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  serverId?: string;
}

export type MCPClientConfig = MCPClientConfigHTTP | MCPClientConfigSSE;

export function getServerHash(config: MCPClientConfig): string {
  const raw = JSON.stringify({
    type: config.type,
    url: config.url,
    headers: config.type === "sse" ? config.headers : undefined,
  });
  return createHash("md5").update(raw).digest("hex");
}

export interface MCPAppsMiddlewareConfig {
  mcpServers?: MCPClientConfig[];
}

export interface MCPAppTool extends Tool {
  uiResourceUri?: string;
}

interface UIToolInfo {
  resourceUri: string;
  serverConfig: MCPClientConfig;
  serverHash: string;
  tool: MCPAppTool;
}

type PendingToolCall = NonNullable<
  Extract<Message, { role: "assistant" }>["toolCalls"]
>[number];

function getUIResourceUri(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }

  const metaRecord = meta as Record<string, unknown>;
  const nestedMeta = metaRecord.ui;
  if (
    nestedMeta &&
    typeof nestedMeta === "object" &&
    typeof (nestedMeta as Record<string, unknown>).resourceUri === "string"
  ) {
    return (nestedMeta as Record<string, string>).resourceUri;
  }

  const flatResourceUri = metaRecord["ui/resourceUri"];
  return typeof flatResourceUri === "string" ? flatResourceUri : undefined;
}

export class MCPAppsMiddleware extends Middleware {
  private readonly config: MCPAppsMiddlewareConfig;
  private readonly serverConfigMapByHash = new Map<string, MCPClientConfig>();
  private readonly serverConfigMapById = new Map<string, MCPClientConfig>();

  constructor(config: MCPAppsMiddlewareConfig = {}) {
    super();
    this.config = config;

    for (const serverConfig of config.mcpServers ?? []) {
      this.serverConfigMapByHash.set(getServerHash(serverConfig), serverConfig);
      if (serverConfig.serverId) {
        this.serverConfigMapById.set(serverConfig.serverId, serverConfig);
      }
    }
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    const proxiedRequest = input.forwardedProps?.__proxiedMCPRequest as
      | ProxiedMCPRequest
      | undefined;

    if (proxiedRequest) {
      return this.handleProxiedMCPRequest(input, proxiedRequest);
    }

    return new Observable<BaseEvent>((subscriber) => {
      let innerSubscription:
        | ReturnType<Observable<BaseEvent>["subscribe"]>
        | undefined;
      let cancelled = false;

      void (async () => {
        try {
          const { nextInput, uiToolsByName } = await this.prepareInput(input);
          if (cancelled) {
            return;
          }

          innerSubscription = this.processStream(
            this.runNextWithState(nextInput, next),
            uiToolsByName,
          ).subscribe(subscriber);
        } catch (error) {
          subscriber.error(error);
        }
      })();

      return () => {
        cancelled = true;
        innerSubscription?.unsubscribe();
      };
    });
  }

  private handleProxiedMCPRequest(
    input: RunAgentInput,
    proxiedRequest: ProxiedMCPRequest,
  ): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const started: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      };
      subscriber.next(started);

      const serverConfig =
        (proxiedRequest.serverId
          ? this.serverConfigMapById.get(proxiedRequest.serverId)
          : undefined) ??
        this.serverConfigMapByHash.get(proxiedRequest.serverHash);

      if (!serverConfig) {
        const finished: RunFinishedEvent = {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
          result: {
            error: `Unknown MCP server: ${proxiedRequest.serverId || proxiedRequest.serverHash}`,
          },
        };
        subscriber.next(finished);
        subscriber.complete();
        return;
      }

      void this.executeMCPRequest(
        serverConfig,
        proxiedRequest.method,
        proxiedRequest.params,
      )
        .then((result) => {
          const finished: RunFinishedEvent = {
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
            result,
          };
          subscriber.next(finished);
          subscriber.complete();
        })
        .catch((error) => {
          const finished: RunFinishedEvent = {
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
            result: {
              error: error instanceof Error ? error.message : String(error),
            },
          };
          subscriber.next(finished);
          subscriber.complete();
        });
    });
  }

  private async executeMCPRequest(
    serverConfig: MCPClientConfig,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const transport = this.createTransport(serverConfig);

    const client = new Client(
      { name: "mcp-apps-middleware", version: "1.0.0" },
      {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html+mcp"],
            },
          },
        },
      },
    );

    try {
      await client.connect(transport);

      switch (method) {
        case "tools/call":
          return await client.callTool(
            params as { name: string; arguments?: Record<string, unknown> },
          );
        case "resources/read":
          return await client.readResource(params as { uri: string });
        case "notifications/message":
          await client.notification({
            method: "notifications/message",
            params,
          });
          return { success: true };
        case "ping":
          return await client.ping();
        default:
          throw new Error(`MCP method not allowed for UI proxy: ${method}`);
      }
    } finally {
      await client.close();
    }
  }

  private processStream(
    source: Observable<EventWithState>,
    uiToolsByName: Map<string, UIToolInfo>,
  ): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let heldRunFinished: EventWithState | null = null;

      const subscription = source.subscribe({
        next: (eventWithState) => {
          const event = eventWithState.event;

          if (heldRunFinished) {
            subscriber.next(heldRunFinished.event);
            heldRunFinished = null;
          }

          if (event.type === EventType.RUN_FINISHED) {
            heldRunFinished = eventWithState;
            return;
          }

          subscriber.next(event);
        },
        error: (error) => {
          if (heldRunFinished) {
            subscriber.next(heldRunFinished.event);
            heldRunFinished = null;
          }
          subscriber.error(error);
        },
        complete: () => {
          void (async () => {
            try {
              if (heldRunFinished) {
                await this.executePendingUIToolCalls(
                  heldRunFinished.messages,
                  uiToolsByName,
                  subscriber,
                );
                subscriber.next(heldRunFinished.event);
                heldRunFinished = null;
              }
              subscriber.complete();
            } catch (error) {
              subscriber.error(error);
            }
          })();
        },
      });

      return () => subscription.unsubscribe();
    });
  }

  private async executePendingUIToolCalls(
    messages: Message[],
    uiToolsByName: Map<string, UIToolInfo>,
    subscriber: Subscriber<BaseEvent>,
  ): Promise<void> {
    const pendingToolCalls = this.findPendingToolCalls(messages);

    for (const pendingToolCall of pendingToolCalls) {
      const uiTool = uiToolsByName.get(pendingToolCall.function.name);
      if (!uiTool) {
        continue;
      }

      try {
        const toolInput = this.parseToolInput(
          pendingToolCall.function.arguments,
        );
        const result = await this.executeToolCall(
          uiTool.serverConfig,
          pendingToolCall.function.name,
          toolInput,
        );

        const toolCallResult: ToolCallResultEvent = {
          type: EventType.TOOL_CALL_RESULT,
          messageId: randomUUID(),
          toolCallId: pendingToolCall.id,
          content: this.extractTextContent(
            (result as { content?: unknown }).content,
          ),
        };
        subscriber.next(toolCallResult);

        const activitySnapshot: ActivitySnapshotEvent = {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: randomUUID(),
          activityType: MCPAppsActivityType,
          content: {
            result,
            resourceUri: uiTool.resourceUri,
            serverHash: uiTool.serverHash,
            serverId: uiTool.serverConfig.serverId,
            toolInput,
          },
          replace: true,
        };
        subscriber.next(activitySnapshot);
      } catch (error) {
        console.error(
          `Failed to execute UI tool call ${pendingToolCall.function.name}:`,
          error,
        );
        const toolCallResult: ToolCallResultEvent = {
          type: EventType.TOOL_CALL_RESULT,
          messageId: randomUUID(),
          toolCallId: pendingToolCall.id,
          content: JSON.stringify({ error: String(error) }),
        };
        subscriber.next(toolCallResult);
      }
    }
  }

  private async executeToolCall(
    serverConfig: MCPClientConfig,
    name: string,
    toolInput: Record<string, unknown>,
  ): Promise<unknown> {
    return await this.executeMCPRequest(serverConfig, "tools/call", {
      name,
      arguments: toolInput,
    });
  }

  private parseToolInput(toolArgs?: string): Record<string, unknown> {
    if (!toolArgs) {
      return {};
    }

    try {
      const parsed = JSON.parse(toolArgs);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private extractTextContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      const textParts = content
        .map((part) => {
          if (
            part &&
            typeof part === "object" &&
            (part as Record<string, unknown>).type === "text" &&
            typeof (part as Record<string, unknown>).text === "string"
          ) {
            return (part as Record<string, string>).text;
          }
          return undefined;
        })
        .filter((part): part is string => Boolean(part));

      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }

    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  private findPendingToolCalls(messages: Message[]) {
    const pendingToolCalls = new Map<string, PendingToolCall>();
    const completedToolCallIds = new Set<string>();

    for (const message of messages) {
      if (message.role === "assistant" && message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          pendingToolCalls.set(toolCall.id, toolCall);
        }
      }

      if (message.role === "tool" && message.toolCallId) {
        completedToolCallIds.add(message.toolCallId);
      }
    }

    for (const toolCallId of completedToolCallIds) {
      pendingToolCalls.delete(toolCallId);
    }

    return Array.from(pendingToolCalls.values());
  }

  private async prepareInput(input: RunAgentInput) {
    const uiTools = await this.fetchUITools();
    const uiToolsByName = new Map<string, UIToolInfo>();
    for (const uiTool of uiTools) {
      uiToolsByName.set(uiTool.tool.name, uiTool);
    }

    return {
      nextInput: {
        ...input,
        tools: [...input.tools, ...uiTools.map((uiTool) => uiTool.tool)],
      },
      uiToolsByName,
    };
  }

  private async fetchUITools(): Promise<UIToolInfo[]> {
    const uiTools: UIToolInfo[] = [];

    for (const serverConfig of this.config.mcpServers ?? []) {
      try {
        const tools = await this.fetchToolsFromServer(serverConfig);
        uiTools.push(...tools);
      } catch (error) {
        console.error(
          `Failed to fetch tools from MCP server ${serverConfig.url}:`,
          error,
        );
      }
    }

    return uiTools;
  }

  private async fetchToolsFromServer(
    serverConfig: MCPClientConfig,
  ): Promise<UIToolInfo[]> {
    const transport = this.createTransport(serverConfig);

    const client = new Client(
      { name: "mcp-apps-middleware", version: "1.0.0" },
      {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html+mcp"],
            },
          },
        },
      },
    );

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();

      return tools
        .map((tool) => {
          const resourceUri = getUIResourceUri(tool._meta);
          if (!resourceUri) {
            return undefined;
          }

          const toolDefinition: MCPAppTool = {
            name: tool.name,
            description: tool.description ?? "",
            parameters: tool.inputSchema ?? {
              type: "object",
              properties: {},
            },
            uiResourceUri: resourceUri,
          };

          return {
            tool: toolDefinition,
            serverConfig,
            resourceUri,
            serverHash: getServerHash(serverConfig),
          };
        })
        .filter((tool): tool is UIToolInfo => Boolean(tool));
    } finally {
      await client.close();
    }
  }

  private createTransport(serverConfig: MCPClientConfig) {
    if (serverConfig.type === "sse") {
      const init = serverConfig.headers
        ? { headers: serverConfig.headers }
        : undefined;

      return new SSEClientTransport(new URL(serverConfig.url), {
        eventSourceInit: init,
        requestInit: init,
      });
    }

    return new StreamableHTTPClientTransport(new URL(serverConfig.url));
  }
}
