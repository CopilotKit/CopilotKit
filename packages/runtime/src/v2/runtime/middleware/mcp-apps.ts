import { randomUUID } from "node:crypto";
import { Middleware, EventType } from "@ag-ui/client";
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
  Tool,
  ToolCall,
  RunFinishedEvent,
} from "@ag-ui/client";
import { getServerHash } from "@ag-ui/mcp-apps-middleware";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Observable } from "rxjs";
import type { Subscriber, Subscription } from "rxjs";
import type { McpAppsServerConfig } from "../core/runtime";

type Server = Omit<McpAppsServerConfig, "agentId">;
interface UITool {
  tool: Tool;
  server: Server;
  resourceUri: string;
}
const PROXY_METHODS = new Set([
  "tools/call",
  "resources/read",
  "notifications/message",
  "ping",
]);

/** Narrow browser JSON without trusting transport fields supplied by an iframe. */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Pending calls include prior message history, matching the upstream middleware contract. */
function pendingCalls(messages: Message[]): ToolCall[] {
  const resolved = new Set(
    messages
      .filter((message) => message.role === "tool")
      .map((message) => message.toolCallId),
  );
  return messages
    .flatMap((message) =>
      message.role === "assistant" ? (message.toolCalls ?? []) : [],
    )
    .filter((call) => !resolved.has(call.id));
}

/** Return only model-visible text; the complete MCP result stays in the UI activity. */
function resultText(result: unknown): string {
  const content = record(result).content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? null);
  return (
    content
      .filter(
        (item) =>
          record(item).type === "text" && typeof record(item).text === "string",
      )
      .map((item) => record(item).text)
      .join("\n") || JSON.stringify(content)
  );
}

/**
 * Intelligence-owned MCP Apps integration. Uses the official SDK instead of
 * patching private upstream middleware methods. The existing OSS adapter still
 * uses the upstream middleware. Trusted server configuration owns credentials;
 * browser fields cannot replace URLs, headers, or selected agent scope.
 */
export class IntelligenceMCPAppsMiddleware extends Middleware {
  private readonly servers: readonly Server[];

  constructor(config: { mcpServers: readonly Server[] }) {
    super();
    this.servers = config.mcpServers.map((server) => ({
      ...server,
      ...(server.headers ? { headers: { ...server.headers } } : {}),
    }));
  }

  /** Stream agent events, then execute pending UI calls before the terminal event. */
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      const controller = new AbortController();
      let source: Subscription | undefined;
      const execute = async (): Promise<void> => {
        const forwarded = record(input.forwardedProps);
        if (
          Object.prototype.hasOwnProperty.call(forwarded, "__proxiedMCPRequest")
        ) {
          await this.proxy(
            input,
            record(forwarded.__proxiedMCPRequest),
            controller.signal,
            subscriber,
          );
          return;
        }
        const tools = await this.discover(controller.signal);
        const enhanced = {
          ...input,
          tools: [
            ...input.tools,
            ...[...tools.values()].map((info) => info.tool),
          ],
        };
        let terminal: RunFinishedEvent | undefined;
        let messages: Message[] = input.messages;
        await new Promise<void>((resolve, reject) => {
          const abort = (): void => reject(new Error("MCP Apps run canceled"));
          if (controller.signal.aborted) {
            abort();
            return;
          }
          controller.signal.addEventListener("abort", abort, { once: true });
          source = this.runNextWithState(enhanced, next).subscribe({
            next: ({ event, messages: current }) => {
              messages = current;
              if (terminal) {
                reject(new Error("Agent emitted events after RUN_FINISHED"));
                source?.unsubscribe();
                return;
              }
              if (event.type === EventType.RUN_FINISHED)
                terminal = event as RunFinishedEvent;
              else subscriber.next(event);
            },
            error: (error: unknown) => {
              controller.signal.removeEventListener("abort", abort);
              reject(error);
            },
            complete: () => {
              controller.signal.removeEventListener("abort", abort);
              resolve();
            },
          });
        });
        if (!terminal) return;
        for (const call of pendingCalls(messages)) {
          const info = tools.get(call.function.name);
          if (!info) continue;
          try {
            const args = JSON.parse(call.function.arguments || "{}");
            if (
              args === null ||
              typeof args !== "object" ||
              Array.isArray(args)
            )
              throw new Error("Invalid tool arguments");
            const result = await this.withClient(
              info.server,
              controller.signal,
              (client) =>
                client.callTool({ name: call.function.name, arguments: args }),
            );
            subscriber.next({
              type: EventType.TOOL_CALL_RESULT,
              toolCallId: call.id,
              messageId: randomUUID(),
              content: resultText(result),
            });
            subscriber.next({
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: randomUUID(),
              activityType: "mcp-apps",
              content: {
                result,
                resourceUri: info.resourceUri,
                serverHash: getServerHash(info.server),
                ...(info.server.serverId
                  ? { serverId: info.server.serverId }
                  : {}),
                toolInput: args,
              },
              replace: true,
            });
          } catch {
            if (controller.signal.aborted) return;
            subscriber.next({
              type: EventType.TOOL_CALL_RESULT,
              toolCallId: call.id,
              messageId: randomUUID(),
              content: JSON.stringify({ error: "MCP tool execution failed" }),
            });
          }
        }
        subscriber.next(terminal);
      };
      execute().then(
        () => subscriber.complete(),
        () => subscriber.error(new Error("MCP Apps execution failed")),
      );
      return () => {
        controller.abort();
        source?.unsubscribe();
      };
    });
  }

  /** Resolve authorization and method allowlists before creating any transport. */
  private async proxy(
    input: RunAgentInput,
    request: Record<string, unknown>,
    signal: AbortSignal,
    subscriber: Subscriber<BaseEvent>,
  ): Promise<void> {
    subscriber.next({
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    });
    const server =
      this.servers.find(
        (candidate) =>
          typeof request.serverId === "string" &&
          candidate.serverId === request.serverId,
      ) ??
      this.servers.find(
        (candidate) => getServerHash(candidate) === request.serverHash,
      );
    const finish = (result: unknown): void =>
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        result,
      });
    if (!server) {
      finish({ error: "Unknown MCP server" });
      return;
    }
    const method = typeof request.method === "string" ? request.method : "";
    if (!PROXY_METHODS.has(method)) {
      finish({ error: "MCP method not allowed for UI proxy" });
      return;
    }
    const params = record(request.params);
    if (
      (method === "tools/call" && typeof params.name !== "string") ||
      (method === "resources/read" && typeof params.uri !== "string")
    ) {
      finish({ error: "Invalid MCP request parameters" });
      return;
    }
    try {
      finish(
        await this.withClient(server, signal, async (client) => {
          switch (method) {
            case "tools/call":
              return client.callTool({
                name: params.name as string,
                ...(params.arguments !== undefined
                  ? { arguments: record(params.arguments) }
                  : {}),
              });
            case "resources/read":
              return client.readResource({ uri: params.uri as string });
            case "notifications/message":
              await client.notification({ method, params });
              return { success: true };
            default:
              return client.ping();
          }
        }),
      );
    } catch {
      finish({ error: "MCP request failed" });
    }
  }

  /** Discover only tools advertising an MCP Apps UI resource, including all pages. */
  private async discover(signal: AbortSignal): Promise<Map<string, UITool>> {
    const found = new Map<string, UITool>();
    for (const server of this.servers) {
      await this.withClient(server, signal, async (client) => {
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < 100; page++) {
          const result = await client.listTools(cursor ? { cursor } : {});
          for (const tool of result.tools) {
            const resourceUri = tool._meta?.["ui/resourceUri"];
            if (typeof resourceUri !== "string") continue;
            if (found.has(tool.name))
              throw new Error("Duplicate MCP UI tool name");
            found.set(tool.name, {
              server,
              resourceUri,
              tool: {
                name: tool.name,
                description: `${tool.description ?? ""}\n[UI Resource: ${resourceUri}]`,
                parameters: tool.inputSchema,
              },
            });
          }
          cursor = result.nextCursor;
          if (!cursor) return;
          if (cursors.has(cursor)) throw new Error("MCP tool cursor repeated");
          cursors.add(cursor);
        }
        throw new Error("MCP tool pagination exceeded limit");
      });
    }
    return found;
  }

  /** Own a short-lived authenticated SDK session and explicitly release it. */
  private async withClient<T>(
    server: Server,
    signal: AbortSignal,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const url = new URL(server.url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid MCP server URL");
    let closing = false;
    const boundedFetch = (
      target: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestURL = new URL(
        target instanceof Request ? target.url : String(target),
      );
      if (requestURL.origin !== url.origin)
        return Promise.reject(new Error("MCP transport changed origin"));
      const signals = [closing ? AbortSignal.timeout(3_000) : signal];
      if (init?.signal) signals.push(init.signal);
      return fetch(target, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any(signals),
      });
    };
    const options = {
      requestInit: { headers: server.headers, redirect: "error" as const },
      fetch: boundedFetch,
    };
    const transport =
      server.type === "sse"
        ? new SSEClientTransport(url, options)
        : new StreamableHTTPClientTransport(url, options);
    const client = new Client(
      { name: "copilotkit-runtime-mcp-apps", version: "1.0.0" },
      {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": { mimeTypes: ["text/html+mcp"] },
          },
        },
      },
    );
    try {
      await client.connect(transport, { timeout: 30_000 });
      return await operation(client);
    } finally {
      closing = true;
      try {
        if (
          transport instanceof StreamableHTTPClientTransport &&
          transport.sessionId
        )
          await transport.terminateSession();
      } catch {
        /* Cleanup failure must not replace a completed tool result. */
      }
      await client.close().catch(() => undefined);
    }
  }
}
