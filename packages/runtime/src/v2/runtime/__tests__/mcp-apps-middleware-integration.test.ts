import { describe, it, expect, afterEach, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { LLMock, MCPMock } from "@copilotkit/aimock";
import { MCPAppsMiddleware, getServerHash } from "@ag-ui/mcp-apps-middleware";
import type * as MCPAppsMiddlewareModule from "@ag-ui/mcp-apps-middleware";
import type { McpAppsServerConfig } from "../core/runtime";
import type { CopilotRuntimeLike } from "../core/runtime";
import { CopilotRuntime } from "../core/runtime";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";
import { handleRunAgent } from "../handlers/handle-run";

const middlewareConstructor = vi.hoisted(() => vi.fn());

vi.mock("@ag-ui/mcp-apps-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof MCPAppsMiddlewareModule>();

  class TrackedMCPAppsMiddleware extends actual.MCPAppsMiddleware {
    constructor(
      ...args: ConstructorParameters<typeof actual.MCPAppsMiddleware>
    ) {
      middlewareConstructor(...args);
      super(...args);
    }
  }

  return { ...actual, MCPAppsMiddleware: TrackedMCPAppsMiddleware };
});

/**
 * A minimal next-agent that emits RUN_STARTED and RUN_FINISHED.
 * Used as the downstream agent when the middleware should NOT delegate.
 */
class MockNextAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }

  clone(): AbstractAgent {
    return new MockNextAgent();
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    throw new Error("not used");
  }
}

/** Records injected tools and emits calls for both the allowed and hidden names. */
class ToolListingAgent extends AbstractAgent {
  toolNames: string[] = [];

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.toolNames = input.tools.map((tool) => tool.name);
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      for (const name of ["generate_qr", "admin_dashboard"]) {
        const toolCallId = `call-${name}`;
        subscriber.next({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: name,
        } as BaseEvent);
        subscriber.next({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: "{}",
        } as BaseEvent);
        subscriber.next({
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } as BaseEvent);
      }
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }

  clone(): AbstractAgent {
    return new ToolListingAgent();
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    throw new Error("not used");
  }
}

function createRunInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: undefined,
    ...overrides,
  };
}

async function collectEvents(
  observable: Observable<BaseEvent>,
): Promise<BaseEvent[]> {
  const events: BaseEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    observable.subscribe({
      next: (event) => events.push(event),
      error: reject,
      complete: resolve,
    });
  });
  return events;
}

describe("MCPAppsMiddleware integration", () => {
  let llm: LLMock;
  let mcpMock: MCPMock;

  afterEach(async () => {
    if (llm) {
      await llm.stop().catch(() => {});
    }
    middlewareConstructor.mockClear();
  });

  async function startMcpServer(): Promise<string> {
    mcpMock = new MCPMock();
    mcpMock.addTool({
      name: "get_weather",
      description: "Get the weather",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
      },
    });
    mcpMock.onToolCall("get_weather", (args: unknown) => {
      const parsed = args as { city?: string };
      return `Weather in ${parsed.city || "unknown"}: sunny`;
    });
    mcpMock.addResource(
      {
        uri: "app://dashboard",
        name: "Dashboard",
        mimeType: "text/plain",
      },
      { text: "Dashboard content here" },
    );

    llm = new LLMock({ port: 0 });
    llm.mount("/mcp", mcpMock);
    await llm.start();
    return `${llm.url}/mcp`;
  }

  it("can be created with mcpServers config pointing at MCPMock URL", async () => {
    const mcpUrl = await startMcpServer();

    const middleware = new MCPAppsMiddleware({
      mcpServers: [{ type: "http", url: mcpUrl }],
    });

    expect(middleware).toBeInstanceOf(MCPAppsMiddleware);
  });

  it("rejects a malformed tool policy before the runtime constructs middleware", async () => {
    const server = {
      type: "http" as const,
      url: "https://mcp.example.com/mcp",
      serverId: "weather",
      excludeTools: "delete_account",
    } as unknown as McpAppsServerConfig;
    const runtime = new CopilotRuntime({
      agents: { default: new MockNextAgent() },
      mcpApps: { servers: [server] },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await handleRunAgent({
        runtime,
        agentId: "default",
        request: new Request("https://example.com/agent/default/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createRunInput()),
        }),
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: "Failed to run agent",
        message: expect.stringContaining(
          "excludeTools at server[0] (weather) must be an array of non-empty tool names",
        ),
      });
      expect(middlewareConstructor).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("exposes only tools selected by includeTools and excludeTools", async () => {
    const calls: string[] = [];
    mcpMock = new MCPMock();
    for (const name of ["generate_qr", "admin_dashboard"]) {
      const tool = {
        name,
        description: name,
        inputSchema: { type: "object" as const, properties: {} },
        _meta: { "ui/resourceUri": `ui://${name}` },
      };
      mcpMock.addTool(tool);
      mcpMock.onToolCall(name, () => {
        calls.push(name);
        return name;
      });
    }
    mcpMock.addResource(
      { uri: "ui://generate_qr", name: "QR", mimeType: "text/plain" },
      { text: "qr-widget" },
    );
    llm = new LLMock({ port: 0 });
    llm.mount("/mcp", mcpMock);
    await llm.start();
    const url = `${llm.url}/mcp`;

    const cases: Array<{
      includeTools?: string[];
      excludeTools?: string[];
      expected: string[];
    }> = [
      { includeTools: ["generate_qr"], expected: ["generate_qr"] },
      { excludeTools: ["admin_dashboard"], expected: ["generate_qr"] },
      {
        includeTools: ["generate_qr", "admin_dashboard"],
        excludeTools: ["admin_dashboard"],
        expected: ["generate_qr"],
      },
      { includeTools: [], expected: [] },
      { expected: ["generate_qr", "admin_dashboard"] },
    ];

    for (const { expected, ...policy } of cases) {
      calls.length = 0;
      middlewareConstructor.mockClear();
      const host = new MockNextAgent();
      const use = vi.spyOn(host, "use");
      configureAgentForRequest({
        runtime: {
          mcpApps: {
            servers: [{ type: "http", url, serverId: "crm", ...policy }],
          },
        } as unknown as CopilotRuntimeLike,
        request: new Request("https://example.com/run"),
        agentId: "default",
        agent: host,
      });

      expect(use).toHaveBeenCalledOnce();
      const [created] = middlewareConstructor.mock.calls.at(-1) as [
        { mcpServers: Record<string, unknown>[] },
      ];
      expect(created.mcpServers[0]).not.toHaveProperty("includeTools");
      expect(created.mcpServers[0]).not.toHaveProperty("excludeTools");

      const middleware = use.mock.calls[0][0] as MCPAppsMiddleware;
      const listing = new ToolListingAgent();
      const events = await collectEvents(
        middleware.run(createRunInput(), listing),
      );
      expect(listing.toolNames).toEqual(expected);
      expect(calls).toEqual(expected);
      if (
        !expected.includes("admin_dashboard") &&
        policy.includeTools?.length !== 0
      ) {
        const rejectedAt = events.findIndex(
          (event) =>
            event.type === EventType.TOOL_CALL_RESULT &&
            "toolCallId" in event &&
            event.toolCallId === "call-admin_dashboard",
        );
        const finishedAt = events.findIndex(
          (event) => event.type === EventType.RUN_FINISHED,
        );
        expect(rejectedAt).toBeGreaterThanOrEqual(0);
        expect(rejectedAt).toBeLessThan(finishedAt);
        expect(events[rejectedAt]).toMatchObject({
          content: "MCP tool is not allowed: admin_dashboard",
        });
      }
    }

    calls.length = 0;
    const host = new MockNextAgent();
    const use = vi.spyOn(host, "use");
    configureAgentForRequest({
      runtime: {
        mcpApps: {
          servers: [
            {
              type: "http" as const,
              url,
              serverId: "crm",
              includeTools: ["generate_qr", "admin_dashboard"],
              excludeTools: ["admin_dashboard"],
            },
          ],
        },
      } as unknown as CopilotRuntimeLike,
      request: new Request("https://example.com/run"),
      agentId: "default",
      agent: host,
    });
    const middleware = use.mock.calls[0][0] as MCPAppsMiddleware;

    const denied = await collectEvents(
      middleware.run(
        createRunInput({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "crm",
              method: "tools/call",
              params: { name: "admin_dashboard", arguments: {} },
            },
          },
        }),
        new MockNextAgent(),
      ),
    );
    const deniedResult = denied.find(
      (event) => event.type === EventType.RUN_FINISHED,
    ) as BaseEvent & {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(deniedResult.result?.isError).toBe(true);
    expect(deniedResult.result?.content?.[0]?.text).toContain(
      "admin_dashboard",
    );
    expect(calls).not.toContain("admin_dashboard");

    const allowed = await collectEvents(
      middleware.run(
        createRunInput({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "crm",
              method: "tools/call",
              params: { name: "generate_qr", arguments: {} },
            },
          },
        }),
        new MockNextAgent(),
      ),
    );
    const allowedResult = allowed.find(
      (event) => event.type === EventType.RUN_FINISHED,
    ) as BaseEvent & { result?: { content?: Array<{ text?: string }> } };
    expect(
      allowedResult.result?.content?.some(
        (item) => item.text === "generate_qr",
      ),
    ).toBe(true);
    expect(calls).toEqual(["generate_qr"]);

    const resource = await collectEvents(
      middleware.run(
        createRunInput({
          forwardedProps: {
            __proxiedMCPRequest: {
              serverId: "crm",
              method: "resources/read",
              params: { uri: "ui://generate_qr" },
            },
          },
        }),
        new MockNextAgent(),
      ),
    );
    const resourceResult = resource.find(
      (event) => event.type === EventType.RUN_FINISHED,
    ) as BaseEvent & { result?: { contents?: Array<{ text?: string }> } };
    expect(resourceResult.result?.contents?.[0]?.text).toBe("qr-widget");
  });

  it("attaches valid MCP Apps servers through the production adapter", () => {
    const agent = new MockNextAgent();
    const runtime = {
      mcpApps: {
        servers: [
          {
            type: "http" as const,
            url: "https://mcp.example.com/mcp",
            serverId: "weather",
            agentId: "default",
          },
        ],
      },
    } as unknown as CopilotRuntimeLike;

    configureAgentForRequest({
      runtime,
      request: new Request("https://example.com/run"),
      agentId: "default",
      agent,
    });

    expect(middlewareConstructor).toHaveBeenCalledOnce();
    const [config] = middlewareConstructor.mock.calls[0] as [
      { mcpServers: Record<string, unknown>[] },
    ];
    expect(config.mcpServers).toEqual([
      {
        type: "http",
        url: "https://mcp.example.com/mcp",
        serverId: "weather",
      },
    ]);
    expect(config.mcpServers[0]).not.toHaveProperty("agentId");
  });

  it("does not attach MCP Apps when no server matches the agent", () => {
    const agent = new MockNextAgent();
    const runtime = {
      mcpApps: {
        servers: [
          {
            type: "http" as const,
            url: "https://mcp.example.com/mcp",
            agentId: "other",
          },
        ],
      },
    } as unknown as CopilotRuntimeLike;

    configureAgentForRequest({
      runtime,
      request: new Request("https://example.com/run"),
      agentId: "default",
      agent,
    });

    expect(middlewareConstructor).not.toHaveBeenCalled();
  });

  it("does not attach MCP Apps for an empty server list", () => {
    const agent = new MockNextAgent();
    const runtime = {
      mcpApps: { servers: [] },
    } as unknown as CopilotRuntimeLike;

    configureAgentForRequest({
      runtime,
      request: new Request("https://example.com/run"),
      agentId: "default",
      agent,
    });

    expect(middlewareConstructor).not.toHaveBeenCalled();
  });

  it("does not attach MCP Apps when the agent has no use method", () => {
    const agent = { headers: {} } as unknown as AbstractAgent;
    const runtime = {
      mcpApps: {
        servers: [
          {
            type: "http" as const,
            url: "https://mcp.example.com/mcp",
          },
        ],
      },
    } as unknown as CopilotRuntimeLike;

    configureAgentForRequest({
      runtime,
      request: new Request("https://example.com/run"),
      agentId: "default",
      agent,
    });

    expect(middlewareConstructor).not.toHaveBeenCalled();
  });

  it("proxies tools/call through to MCPMock and returns results", async () => {
    const mcpUrl = await startMcpServer();

    const serverConfig = { type: "http" as const, url: mcpUrl };
    const serverHash = getServerHash(serverConfig);

    const middleware = new MCPAppsMiddleware({
      mcpServers: [serverConfig],
    });

    const input = createRunInput({
      forwardedProps: {
        __proxiedMCPRequest: {
          serverHash,
          method: "tools/call",
          params: {
            name: "get_weather",
            arguments: { city: "NYC" },
          },
        },
      },
    });

    const mockAgent = new MockNextAgent();
    const events = await collectEvents(middleware.run(input, mockAgent));

    // Should have RUN_STARTED and RUN_FINISHED
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_FINISHED);

    // RUN_FINISHED should contain the MCP tool result
    const runFinished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as BaseEvent & { result?: unknown };
    expect(runFinished).toBeDefined();
    expect(runFinished.result).toBeDefined();

    // The result should contain the tool's text content
    const result = runFinished.result as { content?: unknown[] };
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    const textContent = (
      result.content as Array<{ type: string; text?: string }>
    ).find((c) => c.type === "text");
    expect(textContent).toBeDefined();
    expect(textContent!.text).toContain("sunny");
  });

  it("non-proxied request delegates to next agent", async () => {
    const mcpUrl = await startMcpServer();

    const middleware = new MCPAppsMiddleware({
      mcpServers: [{ type: "http", url: mcpUrl }],
    });

    // Input WITHOUT __proxiedMCPRequest — should delegate to MockNextAgent
    const input = createRunInput();

    const mockAgent = new MockNextAgent();

    const events = await collectEvents(middleware.run(input, mockAgent));

    // MockNextAgent's run should have been called (delegation happened)
    // The middleware calls runNextWithState which internally calls next.run,
    // but since processStream wraps it, we check the output events instead
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_FINISHED);
  });

  it("wrong serverHash returns error in RUN_FINISHED result", async () => {
    const mcpUrl = await startMcpServer();

    const middleware = new MCPAppsMiddleware({
      mcpServers: [{ type: "http", url: mcpUrl }],
    });

    const input = createRunInput({
      forwardedProps: {
        __proxiedMCPRequest: {
          serverHash: "nonexistent-hash-value",
          method: "tools/call",
          params: {
            name: "get_weather",
            arguments: { city: "NYC" },
          },
        },
      },
    });

    const mockAgent = new MockNextAgent();
    const events = await collectEvents(middleware.run(input, mockAgent));

    // Should still get RUN_STARTED and RUN_FINISHED
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_FINISHED);

    // RUN_FINISHED should contain an error about unknown server
    const runFinished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as BaseEvent & { result?: unknown };
    expect(runFinished).toBeDefined();
    const result = runFinished.result as { error?: string };
    expect(result.error).toBeDefined();
    expect(result.error).toContain("nonexistent-hash-value");
  });

  it("proxies resources/read through to MCPMock and returns results", async () => {
    const mcpUrl = await startMcpServer();

    const serverConfig = { type: "http" as const, url: mcpUrl };
    const serverHash = getServerHash(serverConfig);

    const middleware = new MCPAppsMiddleware({
      mcpServers: [serverConfig],
    });

    const input = createRunInput({
      forwardedProps: {
        __proxiedMCPRequest: {
          serverHash,
          method: "resources/read",
          params: { uri: "app://dashboard" },
        },
      },
    });

    const mockAgent = new MockNextAgent();
    const modelRun = vi.spyOn(mockAgent, "run");
    const events = await collectEvents(middleware.run(input, mockAgent));
    expect(modelRun).not.toHaveBeenCalled();

    // Should have RUN_STARTED and RUN_FINISHED
    const types = events.map((e) => e.type);
    expect(types).toContain(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_FINISHED);

    // RUN_FINISHED should contain the resource content
    const runFinished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as BaseEvent & { result?: unknown };
    expect(runFinished).toBeDefined();
    expect(runFinished.result).toBeDefined();

    // The result should contain resource contents
    const result = runFinished.result as { contents?: unknown[] };
    expect(result.contents).toBeDefined();
    expect(Array.isArray(result.contents)).toBe(true);

    const resource = (
      result.contents as Array<{ uri: string; text?: string }>
    )[0];
    expect(resource).toBeDefined();
    expect(resource.uri).toBe("app://dashboard");
    expect(resource.text).toContain("Dashboard content here");
  });
});
